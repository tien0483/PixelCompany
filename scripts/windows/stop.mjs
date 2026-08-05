/**
 * Stop PixelOffice listeners on ports 3484 and 8321 (Windows).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function installDir() {
	return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "PixelOffice");
}

function readConfig() {
	const path = join(installDir(), "config.json");
	if (!existsSync(path)) {
		throw new Error(`PixelOffice config not found: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

function pidsOnPorts(ports) {
	const pids = new Set();
	const netstat = spawnSync("netstat", ["-ano", "-p", "tcp"], {
		encoding: "utf8",
		windowsHide: true,
	});
	const lines = String(netstat.stdout || "").split(/\r?\n/);
	for (const line of lines) {
		if (!/LISTENING/i.test(line)) continue;
		for (const port of ports) {
			const re = new RegExp(`:${port}\\s+`);
			if (!re.test(line)) continue;
			const m = line.match(/LISTENING\s+(\d+)\s*$/i);
			if (m) pids.add(Number(m[1]));
		}
	}
	return [...pids];
}

function main() {
	const config = readConfig();
	const runtime = String(config.Runtime || "windows");
	console.log(`Stopping PixelOffice (${runtime})...`);
	if (runtime !== "windows") {
		console.warn("This Node stop helper only clears Windows listeners (3484/8321).");
	}
	const pids = pidsOnPorts([3484, 8321]);
	if (pids.length === 0) {
		console.log("No listeners found on ports 3484, 8321.");
		return;
	}
	for (const pid of pids) {
		if (pid <= 4) continue;
		const r = spawnSync("taskkill", ["/PID", String(pid), "/F"], {
			encoding: "utf8",
			windowsHide: true,
		});
		if (r.status === 0) console.log(`Stopped PID ${pid}`);
		else console.warn(`Could not stop PID ${pid}`);
	}
	console.log("Done.");
}

try {
	main();
} catch (err) {
	console.error(err?.message ?? err);
	process.exit(1);
}
