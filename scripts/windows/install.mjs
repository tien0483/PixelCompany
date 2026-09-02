/**
 * PixelOffice Windows full setup (Node).
 * Expects PixelOffice-windows.zip beside this script (private bundled source).
 *
 *   node install.mjs [--skip-winget] [--skip-deps] [--launch] [--zip path]
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractZip } from "./zip-stdlib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIN_NODE_MAJOR = 22;
const DEFAULT_URL = "http://127.0.0.1:3484";

function parseArgs(argv) {
	const opts = {
		skipWinget: false,
		skipDeps: false,
		launch: false,
		zip: "",
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--skip-winget") opts.skipWinget = true;
		else if (a === "--skip-deps") opts.skipDeps = true;
		else if (a === "--launch") opts.launch = true;
		else if (a === "--zip") opts.zip = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	return opts;
}

function installDir() {
	return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "PixelOffice");
}

function appDir(base = installDir()) {
	return join(base, "app");
}

function configPath(base = installDir()) {
	return join(base, "config.json");
}

function nodeMajor(version = process.version) {
	return Number(version.slice(1).split(".")[0]);
}

function commandExists(name) {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
		encoding: "utf8",
		windowsHide: true,
	});
	return r.status === 0;
}

function refreshPathFromMachine() {
	if (process.platform !== "win32") return;
	const r = spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			"[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
		],
		{ encoding: "utf8", windowsHide: true },
	);
	if (r.status === 0 && r.stdout?.trim()) {
		process.env.PATH = r.stdout.trim();
	}
}

function wingetInstall(id, displayName) {
	console.log(`Installing ${displayName} via winget (${id})...`);
	const r = spawnSync(
		"winget",
		["install", "-e", "--id", id, "--accept-package-agreements", "--accept-source-agreements"],
		{ stdio: "inherit", windowsHide: true },
	);
	if (r.status !== 0) {
		throw new Error(`winget install failed for ${id} (exit ${r.status})`);
	}
	refreshPathFromMachine();
}

function ensureNode(skipWinget) {
	if (nodeMajor() >= MIN_NODE_MAJOR && commandExists("node")) {
		console.log(`Node OK (${process.version}).`);
		return;
	}
	if (skipWinget) {
		throw new Error(`Node.js >= ${MIN_NODE_MAJOR} required. Omit --skip-winget or install Node.`);
	}
	if (!commandExists("winget")) {
		throw new Error("winget not found. Install App Installer, or install Node >= 22 manually.");
	}
	wingetInstall("OpenJS.NodeJS.LTS", "Node.js LTS");
	refreshPathFromMachine();
	const check = spawnSync("node", ["-p", "process.versions.node"], {
		encoding: "utf8",
		windowsHide: true,
	});
	const ver = String(check.stdout ?? "").trim();
	if (!ver || Number(ver.split(".")[0]) < MIN_NODE_MAJOR) {
		throw new Error(
			`Node >= ${MIN_NODE_MAJOR} still not on PATH after winget. Restart the shell and re-run Setup.`,
		);
	}
	console.log(`Node OK (v${ver}).`);
}

function ensureUv(skipWinget) {
	refreshPathFromMachine();
	if (commandExists("uv")) {
		const v = spawnSync("uv", ["--version"], { encoding: "utf8", windowsHide: true });
		console.log(`uv OK (${String(v.stdout ?? "").trim() || "installed"}).`);
		return;
	}
	if (skipWinget) {
		throw new Error("uv not found on PATH. Omit --skip-winget or install uv.");
	}
	wingetInstall("astral-sh.uv", "uv");
	if (!commandExists("uv")) {
		throw new Error("uv not found on PATH after winget. Restart the shell and re-run Setup.");
	}
	console.log("uv OK.");
}

function resolveZipPath(here, explicit) {
	if (explicit) {
		const p = resolve(explicit);
		if (!existsSync(p)) throw new Error(`Zip not found: ${p}`);
		return p;
	}
	const sibling = join(here, "PixelOffice-windows.zip");
	if (existsSync(sibling)) return sibling;
	throw new Error(
		`Missing PixelOffice-windows.zip next to Setup.\nExpected: ${sibling}\nRebuild with: node scripts/windows/build-setup.mjs`,
	);
}

function findRepoRoot(extractDir) {
	const pkg = join(extractDir, "package.json");
	if (existsSync(pkg)) return extractDir;
	const kids = readdirSync(extractDir, { withFileTypes: true }).filter((d) => d.isDirectory());
	if (kids.length === 1) {
		const nested = join(extractDir, kids[0].name);
		if (existsSync(join(nested, "package.json"))) return nested;
	}
	throw new Error("Extracted archive is not a PIXTiel repo root (missing package.json).");
}

function copyTree(src, dest) {
	mkdirSync(dest, { recursive: true });
	for (const ent of readdirSync(src, { withFileTypes: true })) {
		const from = join(src, ent.name);
		const to = join(dest, ent.name);
		if (ent.isDirectory()) copyTree(from, to);
		else if (ent.isFile()) copyFileSync(from, to);
	}
}

function expandReleaseZip(zipPath, destinationAppDir) {
	const tempRoot = join(tmpdir(), `PixelOffice-setup-${process.pid}`);
	if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
	const extractDir = join(tempRoot, "extract");
	mkdirSync(extractDir, { recursive: true });
	console.log(`Using local zip: ${zipPath}`);
	console.log("Extracting...");
	extractZip(zipPath, extractDir);
	const root = findRepoRoot(extractDir);
	if (existsSync(destinationAppDir)) {
		rmSync(destinationAppDir, { recursive: true, force: true });
	}
	mkdirSync(dirname(destinationAppDir), { recursive: true });
	copyTree(root, destinationAppDir);
	rmSync(tempRoot, { recursive: true, force: true });
	console.log(`App installed to: ${destinationAppDir}`);
}

function packageManagerSpec(appRoot) {
	const raw = readFileSync(join(appRoot, "package.json"), "utf8");
	const pkg = JSON.parse(raw);
	return String(pkg.packageManager || "pnpm@11.18.0").split("+")[0];
}

function run(cmd, args, cwd) {
	// On Windows, corepack/pnpm/npm are .cmd shims; spawn without shell yields status null (ENOENT).
	const r = spawnSync(cmd, args, {
		cwd,
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
		env: process.env,
	});
	if (r.error) {
		throw new Error(`${cmd} ${args.join(" ")} failed to start: ${r.error.message}`);
	}
	if (r.status !== 0) {
		throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
	}
}

function ensurePnpm(pnpmSpec) {
	if (commandExists("pnpm")) {
		const ver = spawnSync("pnpm", ["--version"], {
			encoding: "utf8",
			windowsHide: true,
			shell: process.platform === "win32",
		});
		console.log(`pnpm OK (${String(ver.stdout ?? "").trim() || "on PATH"}); skipping corepack.`);
		return;
	}

	console.log(`Enabling Corepack / pnpm (${pnpmSpec})...`);
	const enable = spawnSync("corepack", ["enable"], {
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
		env: process.env,
	});
	if (enable.error) {
		console.warn(`corepack enable: ${enable.error.message}`);
	}
	// corepack prepare often needs to write under Program Files (EPERM without admin).
	const prepare = spawnSync("corepack", ["prepare", pnpmSpec, "--activate"], {
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
		env: process.env,
	});
	refreshPathFromMachine();
	if (commandExists("pnpm") && !prepare.error && prepare.status === 0) {
		return;
	}
	const prepareErr = prepare.error?.message || `exit ${prepare.status}`;
	console.warn(`corepack prepare failed (${prepareErr}); falling back to npm install -g ${pnpmSpec}...`);
	run("npm", ["install", "-g", pnpmSpec], undefined);
	refreshPathFromMachine();
	if (!commandExists("pnpm")) {
		throw new Error(
			`pnpm still not on PATH after corepack/npm fallback. Close this window, open a new terminal, and re-run Setup.`,
		);
	}
}

function installNodeDeps(appRoot) {
	const pnpmSpec = packageManagerSpec(appRoot);
	ensurePnpm(pnpmSpec);
	// Packaged app has no .git; root prepare uses `git … || true` which breaks on cmd.exe
	// (`true` is not a command) and husky prepare is irrelevant for end-user installs.
	// Install packages without lifecycle scripts, then rebuild native bindings.
	console.log(`Running pnpm install --ignore-scripts in ${appRoot} ...`);
	run("pnpm", ["install", "--ignore-scripts"], appRoot);
	console.log("Rebuilding native / allowlisted packages...");
	const rebuild = spawnSync("pnpm", ["rebuild"], {
		cwd: appRoot,
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
		env: process.env,
	});
	if (rebuild.error) {
		console.warn(`pnpm rebuild: ${rebuild.error.message}`);
	} else if (rebuild.status !== 0) {
		console.warn(`pnpm rebuild exited ${rebuild.status} (continuing; solo may still build as needed).`);
	}
}

function installManagerDeps(appRoot) {
	const managerDir = join(appRoot, "backends", "manager");
	if (!existsSync(managerDir)) {
		console.warn(`Manager directory not found (${managerDir}); skipping uv sync.`);
		return;
	}
	console.log(`Running uv sync in ${managerDir} ...`);
	run("uv", ["sync"], managerDir);
}

function writeConfig(base, windowsRepoPath) {
	const cfg = {
		Runtime: "windows",
		Url: DEFAULT_URL,
		Browser: "auto",
		WslDistro: "",
		WslRepoPath: "",
		WindowsRepoPath: windowsRepoPath,
	};
	writeFileSync(configPath(base), JSON.stringify(cfg, null, 2), "utf8");
}

function createShortcut({ shortcutPath, targetPath, arguments: args, workingDirectory, description }) {
	const ps = `
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut(${JSON.stringify(shortcutPath)})
$sc.TargetPath = ${JSON.stringify(targetPath)}
$sc.Arguments = ${JSON.stringify(args || "")}
$sc.WorkingDirectory = ${JSON.stringify(workingDirectory || "")}
$sc.Description = ${JSON.stringify(description || "PIXTiel")}
$sc.WindowStyle = 7
$sc.Save()
`;
	const r = spawnSync(
		"powershell.exe",
		["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
		{ encoding: "utf8", windowsHide: true },
	);
	if (r.status !== 0) {
		throw new Error(`Failed to create shortcut ${shortcutPath}: ${r.stderr || r.stdout}`);
	}
}

function installShortcuts(base) {
	const launchCmd = join(base, "PixelOffice-Launch.cmd");
	const stopCmd = join(base, "PixelOffice-Stop.cmd");
	if (!existsSync(launchCmd) || !existsSync(stopCmd)) {
		throw new Error("Launch/Stop .cmd missing in install dir. Re-run build-setup.mjs and copy dist\\.");
	}
	const desktop = join(homedir(), "Desktop");
	const startMenu = join(
		process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
		"Microsoft",
		"Windows",
		"Start Menu",
		"Programs",
	);
	mkdirSync(startMenu, { recursive: true });
	const targets = [
		{ dir: desktop, name: "PIXTiel.lnk", cmd: launchCmd, desc: "Launch PIXTiel" },
		{ dir: desktop, name: "PIXTiel Stop.lnk", cmd: stopCmd, desc: "Stop PIXTiel stack" },
		{ dir: startMenu, name: "PIXTiel.lnk", cmd: launchCmd, desc: "Launch PIXTiel" },
		{ dir: startMenu, name: "PIXTiel Stop.lnk", cmd: stopCmd, desc: "Stop PIXTiel stack" },
	];
	for (const t of targets) {
		if (!existsSync(t.dir)) continue;
		createShortcut({
			shortcutPath: join(t.dir, t.name),
			targetPath: t.cmd,
			arguments: "",
			workingDirectory: base,
			description: t.desc,
		});
	}
	console.log("Desktop / Start Menu shortcuts created.");
}

function writeCmd(path, body) {
	writeFileSync(path, body.replace(/\n/g, "\r\n"), "utf8");
}

function copyInstallerAssets(here, base) {
	const names = ["install.mjs", "launch.mjs", "stop.mjs", "zip-stdlib.mjs", "uninstall.mjs"];
	for (const name of names) {
		const src = join(here, name);
		if (!existsSync(src)) {
			throw new Error(`Missing installer asset: ${src}`);
		}
		copyFileSync(src, join(base, name));
	}
	writeCmd(
		join(base, "PixelOffice-Launch.cmd"),
		`@echo off\r\ncd /d "%~dp0"\r\nnode "%~dp0launch.mjs" %*\r\n`,
	);
	writeCmd(
		join(base, "PixelOffice-Stop.cmd"),
		`@echo off\r\ncd /d "%~dp0"\r\nnode "%~dp0stop.mjs" %*\r\n`,
	);
	writeCmd(
		join(base, "PixelOffice-Uninstall.cmd"),
		`@echo off\r\ncd /d "%~dp0"\r\nnode "%~dp0uninstall.mjs" %*\r\npause\r\n`,
	);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(
			"Usage: node install.mjs [--skip-winget] [--skip-deps] [--launch] [--zip path]",
		);
		process.exit(0);
	}
	if (process.platform !== "win32") {
		throw new Error("This installer is for Windows only.");
	}

	console.log("");
	console.log("PIXTiel full setup (Windows-native, user-scope)");
	console.log("");

	const here = __dirname;
	const base = installDir();
	const destApp = appDir(base);
	mkdirSync(base, { recursive: true });

	if (!opts.skipWinget) {
		ensureNode(false);
		ensureUv(false);
	} else {
		console.log("Skipping winget (--skip-winget).");
		if (nodeMajor() < MIN_NODE_MAJOR) {
			throw new Error(`Node.js >= ${MIN_NODE_MAJOR} required (found ${process.version}).`);
		}
		if (!commandExists("uv")) {
			throw new Error("uv not found on PATH.");
		}
	}

	const zipPath = resolveZipPath(here, opts.zip);
	expandReleaseZip(zipPath, destApp);

	if (!opts.skipDeps) {
		installNodeDeps(destApp);
		installManagerDeps(destApp);
	} else {
		console.log("Skipping deps (--skip-deps).");
	}

	writeConfig(base, destApp);
	copyInstallerAssets(here, base);
	installShortcuts(base);

	console.log("");
	console.log("Setup complete.");
	console.log(`  App:       ${destApp}`);
	console.log(`  Config:    ${configPath(base)}`);
	console.log("  Shortcuts: Desktop / Start Menu — PIXTiel, PIXTiel Stop");
	console.log("");
	console.log("Uninstall:");
	console.log(`  ${join(base, "PixelOffice-Uninstall.cmd")}`);
	console.log("");

	if (opts.launch) {
		const launch = join(base, "launch.mjs");
		console.log("Launching PIXTiel...");
		run(process.execPath, [launch], base);
	}
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});
