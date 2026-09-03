/**
 * Start PixelOffice (Windows) if needed, then open an app window.
 * Reads %LOCALAPPDATA%\PixelOffice\config.json
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

function installDir() {
	return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "PixelOffice");
}

function readConfig() {
	const path = join(installDir(), "config.json");
	if (!existsSync(path)) {
		throw new Error(`PIXTiel config not found: ${path}\nRun install.mjs first.`);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

function portOpen(host, port, timeoutMs = 800) {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const done = (ok) => {
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.on("connect", () => done(true));
		socket.on("timeout", () => done(false));
		socket.on("error", () => done(false));
	});
}

async function waitReady(url, timeoutSec = 120) {
	const u = new URL(url);
	const host = u.hostname || "127.0.0.1";
	const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
	const deadline = Date.now() + timeoutSec * 1000;
	while (Date.now() < deadline) {
		if (await portOpen(host, port)) return true;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

function startSolo(windowsRepoPath) {
	const logPath = join(installDir(), "solo.log");
	const cmd = `set npm_config_yes=true&& npm start >> "${logPath}" 2>&1`;
	spawn("cmd.exe", ["/c", cmd], {
		cwd: windowsRepoPath,
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	}).unref();
}

function findBrowser(prefer = "auto") {
	const local = process.env.LOCALAPPDATA || "";
	const pf = process.env.ProgramFiles || "C:\\Program Files";
	const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
	const edge = [
		join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
		join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
		join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
	];
	const chrome = [
		join(pf, "Google", "Chrome", "Application", "chrome.exe"),
		join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
		join(local, "Google", "Chrome", "Application", "chrome.exe"),
	];
	const order =
		prefer === "chrome"
			? [...chrome, ...edge]
			: prefer === "edge"
				? [...edge, ...chrome]
				: [...edge, ...chrome];
	return order.find((p) => existsSync(p)) || null;
}

function openUi(url, browser) {
	const exe = findBrowser(browser);
	if (exe) {
		spawn(exe, [`--app=${url}`], { detached: true, stdio: "ignore" }).unref();
		return;
	}
	spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
	const noUi = process.argv.includes("--no-ui");
	const config = readConfig();
	const url = String(config.Url || "http://127.0.0.1:3484");
	const u = new URL(url);
	const host = u.hostname || "127.0.0.1";
	const port = u.port ? Number(u.port) : 80;

	const up = await portOpen(host, port);
	if (!up) {
		const repo = String(config.WindowsRepoPath || "");
		if (!repo || !existsSync(join(repo, "package.json"))) {
			throw new Error(`WindowsRepoPath missing or invalid: ${repo}`);
		}
		console.log(`PIXTiel not running on ${host}:${port} — starting (windows)...`);
		startSolo(repo);
		const ready = await waitReady(url, 120);
		if (!ready) {
			throw new Error(
				`Timed out waiting for ${url}\nCheck ${join(installDir(), "solo.log")} and that Node >= 22 is on PATH.`,
			);
		}
	} else {
		console.log(`PIXTiel already listening on ${host}:${port}`);
	}

	if (!noUi) {
		openUi(url, String(config.Browser || "auto"));
	}
}

main().catch((err) => {
	console.error(err?.message ?? err);
	spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(String(err?.message ?? err))}, 'PIXTiel')`,
		],
		{ windowsHide: true },
	);
	process.exit(1);
});
