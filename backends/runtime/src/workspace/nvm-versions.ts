import { existsSync, readdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface NvmNodeVersionEntry {
	version: string;
	path: string;
	nodeBinaryPath: string;
}

export function listNvmNodeVersionDirs(home: string = homedir()): NvmNodeVersionEntry[] {
	const versionsDir = join(home, ".nvm", "versions", "node");
	let entries: string[];
	try {
		entries = readdirSync(versionsDir);
	} catch {
		return [];
	}
	const results: NvmNodeVersionEntry[] = [];
	for (const entry of entries) {
		const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(entry);
		if (match === null) {
			continue;
		}
		const nodeBinaryPath = join(versionsDir, entry, "bin", "node");
		if (!existsSync(nodeBinaryPath)) {
			continue;
		}
		results.push({
			version: entry,
			path: join(versionsDir, entry),
			nodeBinaryPath,
		});
	}
	results.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
	return results;
}

export async function resolveInUseNvmNodeVersion(home: string = homedir()): Promise<string | null> {
	let runtimeNodePath: string;
	try {
		runtimeNodePath = await realpath(process.execPath);
	} catch {
		return null;
	}
	for (const entry of listNvmNodeVersionDirs(home)) {
		let resolvedBinary: string;
		try {
			resolvedBinary = await realpath(entry.nodeBinaryPath);
		} catch {
			continue;
		}
		if (resolvedBinary === runtimeNodePath) {
			return entry.version;
		}
	}
	return null;
}
