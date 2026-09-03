#!/usr/bin/env node
/**
 * Deprecated-script shim.
 *
 *   node scripts/run-alias.mjs <old-name> <new-name> [args...]
 *
 * The run scripts were renamed to npm conventions (`start` serves, `dev` is the
 * HMR stack, `setup` installs, `upgrade` updates). The old names stay as thin
 * aliases so existing docs, CI jobs and muscle memory keep working — they print
 * one line and hand over to the new script.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [oldName, newName, ...forwarded] = process.argv.slice(2);

if (!oldName || !newName) {
	console.error("usage: node scripts/run-alias.mjs <old-name> <new-name> [args...]");
	process.exit(2);
}

const runner = process.env.npm_config_user_agent?.startsWith("pnpm") ? "pnpm" : "npm";
console.warn(`\x1b[33m[PIXTiel] "${oldName}" is now "${newName}". Use: ${runner} run ${newName}\x1b[0m`);

const pm = join(dirname(fileURLToPath(import.meta.url)), "pm.mjs");
const result = spawnSync(process.execPath, [pm, "run", newName, ...forwarded], {
	stdio: "inherit",
	windowsHide: true,
});
process.exit(result.status ?? 1);
