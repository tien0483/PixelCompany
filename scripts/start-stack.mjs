/**
 * Start the Pixel Office dev stack: runtime (Node) + Vite UI.
 *
 * The runtime supervises Manager itself (`backends/runtime/src/manager/manager-process.ts`),
 * so this script no longer spawns Python — it only frees Manager's port on --restart
 * so a stale service does not shadow the one the runtime would start.
 *
 * For a single-URL launch with no Vite, use `pnpm start`.
 * Windows-safe — avoids spawn EINVAL from spawning .cmd shims without a shell.
 *
 * Usage (from repo root):
 *   node scripts/start-stack.mjs
 *   node scripts/start-stack.mjs --restart
 *   pnpm dev
 */
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { readBrandEnv } from "./lib/brand-env.mjs";
import { ensureNode22 } from "./lib/ensure-node22.mjs";

ensureNode22();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWindows = process.platform === "win32";
const repoRoot = join(__dirname, "..");
const runtimeRoot = join(repoRoot, "backends", "runtime");
const webUiRoot = join(repoRoot, "frontends", "pixel_office");

/**
 * Resolves a dependency entrypoint from either the package's own node_modules or
 * the hoisted root one — a workspace install puts shared deps at the root.
 */
function resolveDependencyEntry(packageRoot, ...segments) {
	for (const base of [packageRoot, repoRoot]) {
		const candidate = join(base, "node_modules", ...segments);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

const tsxCli = resolveDependencyEntry(runtimeRoot, "tsx", "dist", "cli.mjs");
const viteCli = resolveDependencyEntry(webUiRoot, "vite", "bin", "vite.js");

const RUNTIME_PORT = 3484;
const WEB_UI_PORT = 5173;
const MANAGER_PORT = Number(process.env.MANAGER_PORT ?? process.env.JACKED_PORT ?? 8321);
const HTML_PORT = Number(readBrandEnv("HTML_PORT") ?? 8322);
const OMNIROUTE_PORT = Number(process.env.OMNIROUTE_PORT ?? 8400);
const DOC_SKILL_PORT = Number(readBrandEnv("DOCSKILL_PORT") ?? 8323);
const FLOWISE_PORT = Number(readBrandEnv("FLOWISE_PORT") ?? 3010);
/** Freed by --restart: a stale Manager/HTML/OmniRoute/Doc-Skill/Flowise sidecar would stop the runtime from starting its own. */
const RESTART_PORTS = [
	RUNTIME_PORT,
	WEB_UI_PORT,
	MANAGER_PORT,
	HTML_PORT,
	OMNIROUTE_PORT,
	DOC_SKILL_PORT,
	FLOWISE_PORT,
];
/** Must be free to start: an already-running Manager/HTML sidecar is reused, not an error. */
const REQUIRED_FREE_PORTS = [RUNTIME_PORT, WEB_UI_PORT];

const restart = process.argv.includes("--restart");

function freePort(port) {
	if (isWindows) {
		const script = [
			`$conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
			"if ($conns) {",
			"  $conns | ForEach-Object {",
			"    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue",
			"  }",
			"}",
		].join("; ");
		spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
			stdio: "ignore",
			windowsHide: true,
		});
		return;
	}

	const lsof = spawnSync("sh", ["-c", `lsof -tiTCP:${port} -sTCP:LISTEN`], {
		encoding: "utf8",
	});
	const pids = (lsof.stdout || "")
		.split(/\s+/)
		.map((s) => s.trim())
		.filter((s) => /^\d+$/.test(s));
	for (const pid of pids) {
		try {
			process.kill(Number(pid), "SIGKILL");
		} catch {
			// already gone
		}
	}
}

function freeStackPorts() {
	console.log(`Freeing ports ${RESTART_PORTS.join(", ")}...`);
	for (const port of RESTART_PORTS) {
		freePort(port);
	}
}

function portIsListening(port) {
	return new Promise((resolve) => {
		const sock = connect(port, "127.0.0.1");
		sock.on("connect", () => {
			sock.destroy();
			resolve(true);
		});
		sock.on("error", () => {
			sock.destroy();
			resolve(false);
		});
	});
}

async function assertPortsFree() {
	const busy = [];
	for (const port of REQUIRED_FREE_PORTS) {
		if (await portIsListening(port)) {
			busy.push(port);
		}
	}
	if (busy.length > 0) {
		console.error(`Ports already in use: ${busy.join(", ")}`);
		console.error("Run: pnpm run restart");
		process.exit(1);
	}
}

function waitForPort(port, timeoutMs = 20000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const sock = connect(port, "127.0.0.1");
			sock.on("connect", () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				sock.destroy();
				if (Date.now() - started > timeoutMs) {
					reject(new Error(`Port ${port} did not open within ${timeoutMs}ms`));
				} else {
					setTimeout(attempt, 250);
				}
			});
		};
		attempt();
	});
}

function spawnNode(jsEntry, args, options) {
	return spawn(process.execPath, [jsEntry, ...args], {
		stdio: "inherit",
		...options,
		shell: false,
	});
}

async function main() {
	if (restart) {
		freeStackPorts();
		await new Promise((r) => setTimeout(r, 500));
	} else {
		await assertPortsFree();
	}

	if (!tsxCli) {
		console.error("tsx not found (backends/runtime or repo root). Run: pnpm install");
		process.exit(1);
	}
	if (!viteCli) {
		console.error("vite not found (frontends/pixel_office or repo root). Run: pnpm install");
		process.exit(1);
	}

	const children = [];
	let exiting = false;

	const cleanup = async (code = 0) => {
		if (exiting) return;
		exiting = true;
		for (const child of children) {
			if (!child.pid) continue;
			try {
				if (isWindows) {
					spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
						stdio: "ignore",
						windowsHide: true,
					});
				} else {
					try {
						process.kill(-child.pid, "SIGTERM");
					} catch {
						child.kill("SIGTERM");
					}
				}
			} catch {
				// ignore
			}
		}
		process.exit(code);
	};

	process.on("SIGINT", () => cleanup(0));
	process.on("SIGTERM", () => cleanup(0));

	const runtimeEnv = {
		...process.env,
		NODE_ENV: "development",
		KANBAN_RUNTIME_PORT: String(RUNTIME_PORT),
		KANBAN_WEB_UI_PORT: String(WEB_UI_PORT),
	};

	console.log("");
	console.log("  Starting PIXTiel stack...");
	console.log(`  UI:       http://127.0.0.1:${WEB_UI_PORT}`);
	console.log(`  Runtime:  http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`  Manager:   http://127.0.0.1:${MANAGER_PORT} (started by the runtime)`);
	console.log("");

	const runtime = spawnNode(
		tsxCli,
		["src/cli.ts", "--port", String(RUNTIME_PORT), "--no-open", "--skip-shutdown-cleanup"],
		{ cwd: runtimeRoot, env: runtimeEnv },
	);
	children.push(runtime);
	runtime.on("exit", (code) => {
		if (!exiting) {
			console.error(`Runtime exited (code ${code ?? "?"})`);
			cleanup(code ?? 1);
		}
	});

	try {
		await waitForPort(RUNTIME_PORT, 90000);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		await cleanup(1);
		return;
	}

	const vite = spawnNode(
		viteCli,
		["--host", "127.0.0.1", "--port", String(WEB_UI_PORT)],
		{ cwd: webUiRoot, env: runtimeEnv },
	);
	children.push(vite);
	vite.on("exit", (code) => {
		if (!exiting) {
			console.error(`Vite exited (code ${code ?? "?"})`);
			cleanup(code ?? 1);
		}
	});

	// Manager is started and stopped by the runtime process itself; nothing to do here.

	try {
		await waitForPort(WEB_UI_PORT, 30000);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		await cleanup(1);
		return;
	}

	console.log("");
	console.log("  Stack is up:");
	console.log(`    UI       http://127.0.0.1:${WEB_UI_PORT}`);
	console.log(`    Runtime  http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`    Manager   http://127.0.0.1:${MANAGER_PORT} (runtime-supervised, headless)`);
	console.log("  Ctrl+C to stop.");
	console.log("");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
