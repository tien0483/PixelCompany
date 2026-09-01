#!/usr/bin/env node
/**
 * Agent Client Protocol (ACP) adapter for Google Antigravity (agy) CLI.
 * Exposes the Antigravity subscription CLI as an ACP subagent for dsh orchestrator.
 */
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Dynamically resolve @agentclientprotocol/sdk from dsh profile or global
let acp;
try {
	acp = await import("@agentclientprotocol/sdk");
} catch {
	const dshProfileSdk = join(homedir(), ".agent/dsh/profiles/headless/node_modules/@agentclientprotocol/sdk/dist/acp.js");
	if (existsSync(dshProfileSdk)) {
		acp = await import(`file://${dshProfileSdk}`);
	} else {
		throw new Error("Cannot find @agentclientprotocol/sdk");
	}
}

function resolveAgyBinary() {
	const override = process.env.PIXELOFFICE_ANTIGRAVITY_BINARY?.trim();
	if (override && existsSync(override)) {
		return override;
	}
	const localAgy = join(homedir(), ".local/bin/agy");
	if (existsSync(localAgy)) {
		return localAgy;
	}
	return "agy";
}

class AntigravityAcpAgent {
	constructor(connection) {
		this.connection = connection;
		this.sessions = new Map();
	}

	async initialize(_params) {
		return {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
			},
		};
	}

	async newSession(params) {
		const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		this.sessions.set(sessionId, {
			cwd: params.cwd || process.cwd(),
			pendingPrompt: null,
		});
		return {
			sessionId,
		};
	}

	async authenticate(_params) {
		return {};
	}

	async setSessionMode(_params) {
		return {};
	}

	async prompt(params) {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session ${params.sessionId} not found`);
		}

		const promptText = (params.prompt || [])
			.filter((p) => p.type === "text")
			.map((p) => p.text)
			.join("\n\n");

		session.pendingPrompt?.abort();
		const abortController = new AbortController();
		session.pendingPrompt = abortController;

		try {
			await this.runAgyTurn(params.sessionId, session.cwd, promptText, abortController.signal);
		} catch (err) {
			if (abortController.signal.aborted) {
				return { stopReason: "cancelled" };
			}
			throw err;
		} finally {
			session.pendingPrompt = null;
		}

		return {
			stopReason: "end_turn",
		};
	}

	async runAgyTurn(sessionId, cwd, promptText, signal) {
		const binary = resolveAgyBinary();
		const args = [
			"--dangerously-skip-permissions",
			"--input-format=stream-json",
			"--output-format=stream-json",
			"-p=",
		];

		return new Promise((resolve, reject) => {
			const child = spawn(binary, args, {
				cwd,
				env: { ...process.env },
				stdio: ["pipe", "pipe", "inherit"],
			});

			let done = false;
			const cleanup = () => {
				if (!done) {
					done = true;
					signal.removeEventListener("abort", onAbort);
				}
			};

			const onAbort = () => {
				cleanup();
				child.kill("SIGTERM");
				setTimeout(() => {
					try { child.kill("SIGKILL"); } catch {}
				}, 2000);
				reject(new Error("aborted"));
			};

			signal.addEventListener("abort", onAbort, { once: true });

			let buffer = "";
			child.stdout.on("data", async (chunk) => {
				buffer += chunk.toString("utf8");
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					try {
						const parsed = JSON.parse(trimmed);
						// Parse agy stream-json output
						let deltaText = "";
						if (parsed.event === "step_update" && parsed.step_update) {
							if (parsed.step_update.step_type === "agent_response" && parsed.step_update.text_delta) {
								deltaText = parsed.step_update.text_delta;
							}
						} else if (parsed.event === "assistant" && parsed.message?.content) {
							deltaText = parsed.message.content;
						} else if (typeof parsed.text === "string") {
							deltaText = parsed.text;
						}

						if (deltaText) {
							await this.connection.sessionUpdate({
								sessionId,
								update: {
									sessionUpdate: "agent_message_chunk",
									content: {
										type: "text",
										text: deltaText,
									},
								},
							});
						}
					} catch {
						// Plain text output fallback
						await this.connection.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: {
									type: "text",
									text: trimmed + "\n",
								},
							},
						});
					}
				}
			});

			child.on("error", (err) => {
				cleanup();
				reject(err);
			});

			child.on("close", async (code) => {
				cleanup();
				if (buffer.trim()) {
					try {
						const parsed = JSON.parse(buffer.trim());
						let deltaText = parsed.step_update?.text_delta || parsed.message?.content || parsed.text || "";
						if (deltaText) {
							await this.connection.sessionUpdate({
								sessionId,
								update: {
									sessionUpdate: "agent_message_chunk",
									content: { type: "text", text: deltaText },
								},
							});
						}
					} catch {
						await this.connection.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: { type: "text", text: buffer.trim() },
							},
						});
					}
				}
				resolve();
			});

			// Send prompt in agy stream-json format
			const stdinPayload = `${JSON.stringify({ event: "user", message: { role: "user", content: promptText } })}\n`;
			child.stdin.write(stdinPayload);
			child.stdin.end();
		});
	}

	async cancel(params) {
		this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
	}
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((conn) => new AntigravityAcpAgent(conn), stream);
