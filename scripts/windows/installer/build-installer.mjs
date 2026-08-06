/**
 * Build scripts/windows/dist/PixelOffice-Setup.exe end-to-end: stage the app
 * tree, stage the bundled Node/Python runtime, copy the install-root files
 * (stop.mjs), compile Launcher.cs, then run ISCC.exe. Requires Inno Setup 6
 * (winget install -e --id JRSoftware.InnoSetup) and the in-box .NET Framework
 * C# compiler.
 *
 * StageDir is passed to ISCC as /DStageDir=... so source paths stay under
 * Windows MAX_PATH even when the repo lives in a long worktree path. The
 * default stage lives next to this script (installer/stage); override with
 * --stage-dir for a short path (e.g. C:\po-stage) if needed.
 *
 *   node scripts/windows/installer/build-installer.mjs [--skip-stage] [--stage-dir path]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function run(cmd, args, cwd) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true });
	if (r.error) throw new Error(`${cmd} ${args.join(" ")} failed to start: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

function resolveIscc() {
	const fromPath = spawnSync("where.exe", ["ISCC.exe"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (fromPath.status === 0) {
		const first = (fromPath.stdout || "")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.find((s) => s.length > 0);
		if (first && existsSync(first)) return first;
	}
	const candidates = [
		join(process.env.LOCALAPPDATA || "", "Programs", "Inno Setup 6", "ISCC.exe"),
		"C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
		"C:\\Program Files\\Inno Setup 6\\ISCC.exe",
	];
	for (const c of candidates) {
		if (c && existsSync(c)) return c;
	}
	throw new Error(
		"ISCC.exe not found. Install Inno Setup 6 (winget install -e --id JRSoftware.InnoSetup) " +
			"or add it to PATH.",
	);
}

function parseArgs(argv) {
	const opts = { skipStage: false, stageDir: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--skip-stage") opts.skipStage = true;
		else if (a === "--stage-dir") opts.stageDir = argv[++i] ?? "";
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	return opts;
}

function main() {
	if (process.platform !== "win32") {
		throw new Error("The installer can only be built on Windows.");
	}
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(
			"Usage: node scripts/windows/installer/build-installer.mjs [--skip-stage] [--stage-dir path]",
		);
		process.exit(0);
	}

	const stageDir = opts.stageDir ? opts.stageDir : join(__dirname, "stage");
	const stageApp = join(stageDir, "app");
	const stageRuntime = join(stageDir, "runtime");

	if (!opts.skipStage) {
		run(process.execPath, [join(__dirname, "stage-app.mjs"), "--stage-dir", stageApp], undefined);
		run(
			process.execPath,
			[join(__dirname, "stage-runtime.mjs"), "--stage-dir", stageRuntime],
			undefined,
		);
	} else {
		console.log("Skipping stage-app/stage-runtime (--skip-stage).");
	}

	if (!existsSync(join(stageApp, "package.json"))) {
		throw new Error(`Missing staged app tree: ${stageApp}. Run without --skip-stage first.`);
	}
	if (!existsSync(join(stageRuntime, "node", "node.exe"))) {
		throw new Error(`Missing staged Node runtime: ${join(stageRuntime, "node")}.`);
	}

	console.log("Copying install-root files into stage...");
	mkdirSync(stageDir, { recursive: true });
	copyFileSync(join(__dirname, "..", "stop.mjs"), join(stageDir, "stop.mjs"));

	console.log("Compiling Launcher.cs...");
	if (!existsSync(CSC)) {
		throw new Error(`In-box C# compiler not found: ${CSC}`);
	}
	run(
		CSC,
		[
			"/nologo",
			"/target:winexe",
			`/out:${join(stageDir, "PixelOffice.exe")}`,
			`/win32icon:${join(__dirname, "..", "PixelOffice.ico")}`,
			"/reference:System.Windows.Forms.dll",
			"/reference:System.Drawing.dll",
			join(__dirname, "Launcher.cs"),
		],
		undefined,
	);

	console.log("Compiling installer (ISCC.exe)...");
	mkdirSync(join(__dirname, "..", "dist"), { recursive: true });
	const iscc = resolveIscc();
	run(iscc, [`/DStageDir=${stageDir}`, join(__dirname, "PixelOffice.iss")], undefined);

	const exePath = join(__dirname, "..", "dist", "PixelOffice-Setup.exe");
	if (!existsSync(exePath)) {
		throw new Error(`Expected ${exePath} after ISCC.exe run.`);
	}
	console.log(`Built ${exePath}`);
}

try {
	main();
} catch (err) {
	console.error(err?.message ?? err);
	process.exit(1);
}
