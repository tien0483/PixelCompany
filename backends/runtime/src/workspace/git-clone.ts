import { access, mkdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { runGit } from "./git-utils.js";
import { isPathWithinRoot } from "./path-sandbox.js";

export interface GitCloneResult {
	ok: boolean;
	clonedPath: string;
	error?: string;
}

/**
 * Derive a repository name from a Git URL.
 *
 * Handles HTTPS URLs (e.g. `https://github.com/user/repo.git`),
 * SSH URLs (e.g. `git@github.com:user/repo.git`), and bare names.
 * Strips a trailing `.git` suffix if present.
 */
export function deriveRepoNameFromUrl(gitUrl: string): string | null {
	const trimmed = gitUrl.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return null;
	}

	// Handle SSH-style URLs: git@host:user/repo.git
	const sshMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
	const pathPart = sshMatch?.[1] ?? trimmed;

	// Take the last path segment.
	const lastSegment = basename(pathPart);
	if (!lastSegment) {
		return null;
	}

	// Strip trailing .git
	const name = lastSegment.endsWith(".git") ? lastSegment.slice(0, -4) : lastSegment;
	return name || null;
}

/** Transports a clone URL may name. Everything else is refused. */
const ALLOWED_CLONE_SCHEMES = new Set(["https", "http", "ssh", "git", "file"]);
/** `git@host:user/repo.git` — scp-style, no scheme at all. */
const SCP_STYLE_URL = /^[^@\s:/]+@[^@\s:/]+:[^\s]+$/;

/**
 * True when a clone URL names a transport we are willing to hand to git.
 *
 * `git clone -- <url>` blocks *option* injection but says nothing about the URL,
 * and git's `ext::` transport runs a shell command by design
 * (`git clone 'ext::sh -c …'`), as does a `--upload-pack` smuggled through some
 * remote helpers. A clone URL is exactly the sort of value that arrives pasted
 * from a chat or supplied by an agent, so the scheme is worth pinning even
 * though the caller here is already trusted.
 *
 * A bare local path (`/srv/repo`, `./repo`) is accepted: it has no scheme, is
 * indistinguishable from `file:`, and cannot carry a helper name.
 */
export function isAllowedCloneUrl(gitUrl: string): boolean {
	const trimmed = gitUrl.trim();
	if (!trimmed) {
		return false;
	}
	const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*)::?/.exec(trimmed);
	if (schemeMatch) {
		// `ext::`, `transport::address` and friends use a double colon; a normal URL
		// uses `scheme://`. Either way the name before the colon must be allow-listed.
		return ALLOWED_CLONE_SCHEMES.has(schemeMatch[1]!.toLowerCase()) && !trimmed.startsWith(`${schemeMatch[1]}::`);
	}
	if (SCP_STYLE_URL.test(trimmed)) {
		return true;
	}
	// No scheme and no `user@host:` — a local path.
	return !trimmed.includes("::");
}

/**
 * Validate that a resolved destination path is within the server CWD sandbox.
 * Returns the resolved absolute path if valid, or throws an error.
 */
export function validateCloneDestination(destination: string, serverCwd: string): string {
	const resolved = resolve(destination);
	if (!isPathWithinRoot(serverCwd, resolved)) {
		throw new Error(
			`Clone destination is outside the server working directory. Destination "${resolved}" must be within "${serverCwd}".`,
		);
	}
	return resolved;
}

/**
 * Clone a Git repository to a destination directory within the server CWD.
 *
 * @param gitUrl - The Git repository URL to clone.
 * @param serverCwd - The server's current working directory (sandbox root).
 * @param destinationPath - Optional custom destination path. If omitted, the
 *   clone is placed at `<serverCwd>/<repo-name>`.
 * @param allowedRootPath - Optional root boundary for destination validation.
 *   Defaults to `serverCwd`.
 */
export async function cloneGitRepository(
	gitUrl: string,
	serverCwd: string,
	destinationPath?: string,
	allowedRootPath: string = serverCwd,
): Promise<GitCloneResult> {
	// Only judges the transport. A blank URL falls through to the name-derivation
	// check below, which already has a more specific message for it.
	if (gitUrl.trim() && !isAllowedCloneUrl(gitUrl)) {
		return {
			ok: false,
			clonedPath: "",
			error:
				"Unsupported repository URL. Use an https, ssh, git or file URL, " +
				"a git@host:path address, or a local path.",
		};
	}
	const repoName = deriveRepoNameFromUrl(gitUrl);
	if (!repoName && !destinationPath) {
		return {
			ok: false,
			clonedPath: "",
			error: "Could not derive repository name from URL and no destination path was provided.",
		};
	}

	// At this point either repoName or destinationPath is truthy (guarded above).
	const rawDestination = destinationPath ?? resolve(serverCwd, repoName as string);

	let clonePath: string;
	try {
		clonePath = validateCloneDestination(rawDestination, allowedRootPath);
	} catch (error) {
		return {
			ok: false,
			clonedPath: rawDestination,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// If the destination already exists and is a directory, append the repo name
	// so the behavior matches native `git clone <url> <existing-dir>` — the repo
	// is cloned *into* the directory rather than rejected outright.
	try {
		await access(clonePath);
		const destStat = await stat(clonePath);
		if (destStat.isDirectory() && repoName) {
			const nestedPath = resolve(clonePath, repoName);
			try {
				clonePath = validateCloneDestination(nestedPath, allowedRootPath);
			} catch (error) {
				return {
					ok: false,
					clonedPath: nestedPath,
					error: error instanceof Error ? error.message : String(error),
				};
			}
			// Verify the nested destination doesn't already exist.
			try {
				await access(clonePath);
				return {
					ok: false,
					clonedPath: clonePath,
					error: `Destination already exists: "${clonePath}".`,
				};
			} catch {
				// Good — the nested path does not exist yet.
			}
		} else {
			return {
				ok: false,
				clonedPath: clonePath,
				error: `Destination already exists: "${clonePath}".`,
			};
		}
	} catch {
		// Expected: destination does not exist yet.
	}

	// Ensure the parent directory exists.
	const parentDir = dirname(clonePath);
	try {
		await mkdir(parentDir, { recursive: true });
	} catch (error) {
		return {
			ok: false,
			clonedPath: clonePath,
			error: `Failed to create parent directory "${parentDir}": ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	// Run `git clone <url> <destination>`.
	// The cwd for the git process should be the parent directory of the destination.
	const result = await runGit(parentDir, ["clone", "--", gitUrl, clonePath]);
	if (!result.ok) {
		return {
			ok: false,
			clonedPath: clonePath,
			error: result.error ?? `Git clone failed: ${result.stderr || result.output}`,
		};
	}

	return {
		ok: true,
		clonedPath: clonePath,
	};
}
