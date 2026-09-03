#!/usr/bin/env node
/**
 * Stable `bin` target for the `kanban` package.
 *
 * The real entry point is the bundled `dist/cli.js`, which only exists after
 * `pnpm --filter kanban build`. Pointing `bin` straight at it made a cold
 * `pnpm install` fail: pnpm links workspace bins during install, and pnpm 11
 * turns the resulting `ENOENT … dist/cli.js` bin-link warning into a non-zero
 * exit — so the installer's `kanban` feature could never finish on a fresh
 * clone (X0 finding I6). This file is committed, so the link always resolves
 * and a missing build fails at run time with an instruction instead.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");

if (!existsSync(cli)) {
	console.error("kanban: the CLI is not built yet.");
	console.error("Build it from the repo root:  pnpm --filter kanban build");
	console.error("Or start everything in dev mode:  pnpm start");
	process.exit(1);
}

await import(`file://${cli}`);
