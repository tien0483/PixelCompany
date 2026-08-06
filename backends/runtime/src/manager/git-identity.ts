/**
 * The local git identity, used as the usage form's `receiver` — whoever is
 * borrowing the shared usage. Reference-only on the form; never scored.
 */

import { getGitStdout } from "../workspace/git-utils.js";

export interface GitIdentity {
	name: string | null;
	email: string | null;
	/** `Name <email>` when both are configured, otherwise whichever exists. */
	label: string | null;
}

const EMPTY_IDENTITY: GitIdentity = { name: null, email: null, label: null };

async function readGitConfig(
	key: string,
	cwd: string,
	scope: "--global" | null,
): Promise<string | null> {
	try {
		const args = scope === null ? ["config", "--get", key] : ["config", scope, "--get", key];
		const value = (await getGitStdout(args, cwd)).trim();
		return value.length > 0 ? value : null;
	} catch {
		// Unset keys exit non-zero, as does running outside a repo with no config.
		// Either way there is simply no identity to report at this scope.
		return null;
	}
}

/**
 * Global config wins: a repo may carry a per-project committer identity (a
 * GitHub-only account, a bot), but the machine's owner is the one actually
 * borrowing the usage. Falls back to the resolved value when nothing is set
 * globally, so a repo-local-only setup still reports someone.
 */
async function readIdentityField(key: string, cwd: string): Promise<string | null> {
	return (
		(await readGitConfig(key, cwd, "--global")) ?? (await readGitConfig(key, cwd, null))
	);
}

export async function resolveGitIdentity(
	cwd: string = process.cwd(),
): Promise<GitIdentity> {
	const [name, email] = await Promise.all([
		readIdentityField("user.name", cwd),
		readIdentityField("user.email", cwd),
	]);
	if (name === null && email === null) {
		return EMPTY_IDENTITY;
	}
	return {
		name,
		email,
		label: name !== null && email !== null ? `${name} <${email}>` : (email ?? name),
	};
}
