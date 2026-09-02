/**
 * Build private Windows dist\: allowlisted source zip + Node installer assets.
 *
 *   node scripts/windows/build-setup.mjs [--skip-bundle] [--out-dir path]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const opts = { skipBundle: false, outDir: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--skip-bundle") opts.skipBundle = true;
		else if (a === "--out-dir") opts.outDir = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	return opts;
}

const SETUP_CMD = `@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo Install Node.js 22+ from https://nodejs.org/ then re-run this Setup.
    pause
    exit /b 1
  )
  echo Installing Node.js LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo winget install failed. Install Node manually and re-run.
    pause
    exit /b 1
  )
)

node "%~dp0install.mjs" %*
set ERR=%ERRORLEVEL%
if not %ERR%==0 (
  echo.
  echo Setup failed with exit code %ERR%.
  pause
)
exit /b %ERR%
`;

const LAUNCH_CMD = `@echo off
cd /d "%~dp0"
node "%~dp0launch.mjs" %*
`;

const STOP_CMD = `@echo off
cd /d "%~dp0"
node "%~dp0stop.mjs" %*
`;

const UNINSTALL_CMD = `@echo off
cd /d "%~dp0"
node "%~dp0uninstall.mjs" %*
pause
`;

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log("Usage: node scripts/windows/build-setup.mjs [--skip-bundle] [--out-dir path]");
		process.exit(0);
	}

	const outDir = resolve(opts.outDir || join(__dirname, "dist"));
	console.log("Building PIXTiel Windows dist...");
	console.log(`  Output: ${outDir}`);
	mkdirSync(outDir, { recursive: true });

	if (!opts.skipBundle) {
		const zipOut = join(outDir, "PixelOffice-windows.zip");
		if (existsSync(zipOut)) rmSync(zipOut, { force: true });
		const bundle = join(__dirname, "bundle-source.mjs");
		const r = spawnSync(process.execPath, [bundle, "--out", zipOut], {
			stdio: "inherit",
			windowsHide: true,
		});
		if (r.status !== 0) {
			throw new Error(`bundle-source.mjs failed (exit ${r.status})`);
		}
	} else {
		console.log("  Skipping source bundle (--skip-bundle).");
	}

	const copyNames = [
		"install.mjs",
		"launch.mjs",
		"stop.mjs",
		"uninstall.mjs",
		"zip-stdlib.mjs",
	];
	for (const name of copyNames) {
		const src = join(__dirname, name);
		if (!existsSync(src)) throw new Error(`Missing ${src}`);
		copyFileSync(src, join(outDir, name));
	}

	writeFileSync(join(outDir, "PixelOffice-Setup.cmd"), SETUP_CMD.replace(/\n/g, "\r\n"), "utf8");
	writeFileSync(join(outDir, "PixelOffice-Launch.cmd"), LAUNCH_CMD.replace(/\n/g, "\r\n"), "utf8");
	writeFileSync(join(outDir, "PixelOffice-Stop.cmd"), STOP_CMD.replace(/\n/g, "\r\n"), "utf8");
	writeFileSync(
		join(outDir, "PixelOffice-Uninstall.cmd"),
		UNINSTALL_CMD.replace(/\n/g, "\r\n"),
		"utf8",
	);

	const readmeSrc = join(__dirname, "README.md");
	if (existsSync(readmeSrc)) {
		copyFileSync(readmeSrc, join(outDir, "README.md"));
	}

	const zipPath = join(outDir, "PixelOffice-windows.zip");
	if (!opts.skipBundle) {
		if (!existsSync(zipPath)) {
			throw new Error(`Expected zip missing: ${zipPath}`);
		}
		const kb = Math.round(statSync(zipPath).size / 1024);
		console.log(`  Zip: ${zipPath} (${kb} KiB)`);
	}

	console.log("");
	console.log("Built dist folder. Ship the ENTIRE dist\\ directory:");
	console.log(`  ${outDir}`);
	console.log("  (PixelOffice-Setup.cmd + PixelOffice-windows.zip + *.mjs)");
	console.log("");
	console.log("End users: double-click PixelOffice-Setup.cmd");
}

try {
	main();
} catch (err) {
	console.error(err?.message ?? err);
	process.exit(1);
}
