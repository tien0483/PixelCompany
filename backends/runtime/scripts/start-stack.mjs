/**
 * Thin wrapper — prefer `npm start` from the PixelOffice repo root.
 * Kept so `npm --prefix backends/runtime run start` still works.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootScript = join(__dirname, "..", "..", "..", "scripts", "start-stack.mjs");
const child = spawn(process.execPath, [rootScript, ...process.argv.slice(2)], {
	stdio: "inherit",
	shell: false,
});
child.on("exit", (code) => process.exit(code ?? 0));
