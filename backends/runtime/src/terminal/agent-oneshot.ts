/**
 * Non-PTY one-shot agent invocation for HTML generation.
 * Prompt is delivered on stdin; stdout is stream-json parsed into InvokeEvents.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
	buildWindowsCmdArgsArray,
	resolveWindowsComSpec,
	shouldUseWindowsCmdLaunch,
} from "../core/windows-cmd-launch";
import {
	resolveManagerAccountPin,
	type ManagerAccountPin,
	type ResolveManagerAccountPinInput,
} from "../manager/manager-account-pin";
import { makeParser } from "../html/html-stream-parser";
import { isBinaryAvailableOnPath } from "./command-discovery";
import { RUNTIME_AGENT_CATALOG } from "../core/agent-catalog";

export type AgentOneShotEvent =
	| { type: "start"; agent: string; model?: string }
	| { type: "delta"; text: string }
	| { type: "html"; text: string }
	| { type: "meta"; key: string; value: unknown }
	| { type: "stderr"; text: string }
	| { type: "raw"; line: string }
	| { type: "done"; code: number | null }
	| { type: "error"; message: string };

export interface RunAgentOneShotInput {
	agentId: string;
	prompt: string;
	cwd?: string;
	model?: string;
	signal?: AbortSignal;
	onEvent: (event: AgentOneShotEvent) => void;
	/**
	 * Tools the agent may use without a permission prompt. A one-shot `-p` run
	 * has no UI to answer a prompt with, so an unexpected one would stall the
	 * SSE stream until the request is cancelled — templates that need file
	 * access (mockup images) pass an explicit allowlist instead of relying on
	 * `--permission-mode auto` to decide.
	 */
	allowedTools?: string[];
	/**
	 * Hard ceiling on the whole run, regardless of output. Guards against a
	 * process that keeps producing output (or keeps resetting the idle timer)
	 * without ever finishing.
	 */
	timeoutMs?: number;
	/**
	 * Cancels the run if no stdout/stderr line arrives for this long. This is
	 * the watchdog for the actual stall this module exists to prevent: a
	 * one-shot `-p` run that silently blocks on a permission prompt it has no
	 * UI to answer produces no output at all, so an idle timer — reset on
	 * every line — is what notices.
	 */
	idleTimeoutMs?: number;
	/** Extra env merged after pin + process.env. */
	env?: Record<string, string | undefined>;
	/** When provided, used instead of calling resolveManagerAccountPin internally. */
	accountPin?: ManagerAccountPin;
	/** Inputs for resolveManagerAccountPin when accountPin is not supplied. */
	pinInput?: Omit<ResolveManagerAccountPinInput, "agentId"> & {
		managerAccountId?: number;
	};
}

function resolveClaudeBinary(): string {
	const entry = RUNTIME_AGENT_CATALOG.find((agent) => agent.id === "claude");
	const binary = entry?.binary ?? "claude";
	if (!isBinaryAvailableOnPath(binary)) {
		throw new Error(
			`Claude Code binary "${binary}" is not available on PATH. Install Claude Code to generate HTML.`,
		);
	}
	return binary;
}

function buildClaudeArgv(model?: string, allowedTools?: string[]): string[] {
	return [
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--permission-mode",
		"auto",
		...(allowedTools && allowedTools.length > 0 ? ["--allowedTools", allowedTools.join(",")] : []),
		...(model ? ["--model", model] : []),
	];
}

export async function runAgentOneShot(input: RunAgentOneShotInput): Promise<{ code: number | null }> {
	if (input.agentId !== "claude") {
		input.onEvent({
			type: "error",
			message: `HTML generation only supports Claude Code (got ${input.agentId}).`,
		});
		return { code: 1 };
	}

	let pin: ManagerAccountPin = input.accountPin ?? { env: {}, accountId: null, warning: null };
	if (!input.accountPin && input.pinInput) {
		pin = await resolveManagerAccountPin({
			...input.pinInput,
			agentId: "claude",
		});
	}
	if (pin.blocked) {
		const message = pin.warning ?? "Pinned Claude account is over its donate cap.";
		input.onEvent({ type: "error", message });
		return { code: 1 };
	}
	if (pin.warning) {
		input.onEvent({ type: "meta", key: "pin_warning", value: pin.warning });
	}

	let binary: string;
	try {
		binary = resolveClaudeBinary();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.onEvent({ type: "error", message });
		return { code: 1 };
	}

	const argv = buildClaudeArgv(input.model, input.allowedTools);
	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		...pin.env,
		...input.env,
	};

	const useCmd = shouldUseWindowsCmdLaunch(binary, process.platform, childEnv);
	let child: ChildProcess;
	try {
		if (useCmd) {
			const comSpec = resolveWindowsComSpec(childEnv);
			child = spawn(comSpec, buildWindowsCmdArgsArray(binary, argv), {
				cwd: input.cwd,
				env: childEnv,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
				shell: false,
			});
		} else {
			child = spawn(binary, argv, {
				cwd: input.cwd,
				env: childEnv,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
				shell: false,
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.onEvent({ type: "error", message });
		return { code: 1 };
	}

	input.onEvent({ type: "start", agent: "claude", model: input.model });

	const onAbort = () => {
		try {
			child.kill();
		} catch {
			// already gone
		}
	};
	if (input.signal) {
		if (input.signal.aborted) {
			onAbort();
		} else {
			input.signal.addEventListener("abort", onAbort, { once: true });
		}
	}

	// Guards the stall this module exists to prevent: a one-shot `-p` run has no
	// UI to answer an unexpected permission prompt, so it can sit forever
	// producing nothing. Once one watchdog fires, only its own error is kept —
	// a killed child's non-zero exit must not also emit "Claude exited with
	// code 1" as if that were a fresh, separate failure.
	let errorEmitted = false;
	const emitError = (message: string) => {
		if (errorEmitted) {
			return;
		}
		errorEmitted = true;
		input.onEvent({ type: "error", message });
	};

	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const clearIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};
	const resetIdleTimer = () => {
		if (input.idleTimeoutMs === undefined) {
			return;
		}
		clearIdleTimer();
		idleTimer = setTimeout(() => {
			const idleSeconds = Math.round(input.idleTimeoutMs! / 1000);
			emitError(`Agent produced no output for ${idleSeconds}s — cancelled.`);
			try {
				child.kill();
			} catch {
				// already gone
			}
		}, input.idleTimeoutMs);
	};
	resetIdleTimer();

	let hardTimer: ReturnType<typeof setTimeout> | undefined;
	if (input.timeoutMs !== undefined) {
		hardTimer = setTimeout(() => {
			const totalSeconds = Math.round(input.timeoutMs! / 1000);
			emitError(`Agent ran for ${totalSeconds}s without finishing — cancelled.`);
			try {
				child.kill();
			} catch {
				// already gone
			}
		}, input.timeoutMs);
	}

	child.stdin?.write(input.prompt);
	child.stdin?.end();

	const parse = makeParser("claude");
	if (child.stdout) {
		const rl = createInterface({ input: child.stdout });
		rl.on("line", (line) => {
			resetIdleTimer();
			input.onEvent({ type: "raw", line });
			for (const part of parse(line)) {
				if (part.kind === "delta") {
					input.onEvent({ type: "delta", text: part.text });
				} else if (part.kind === "html") {
					input.onEvent({ type: "html", text: part.text });
				} else if (part.kind === "meta") {
					input.onEvent({ type: "meta", key: part.key, value: part.value });
				}
			}
		});
	}
	if (child.stderr) {
		const rlErr = createInterface({ input: child.stderr });
		rlErr.on("line", (line) => {
			resetIdleTimer();
			input.onEvent({ type: "stderr", text: line });
		});
	}

	const code = await new Promise<number | null>((resolvePromise) => {
		child.once("error", (error) => {
			emitError(error.message);
			resolvePromise(1);
		});
		child.once("close", (exitCode) => {
			resolvePromise(exitCode);
		});
	});

	clearIdleTimer();
	if (hardTimer) {
		clearTimeout(hardTimer);
	}
	if (input.signal) {
		input.signal.removeEventListener("abort", onAbort);
	}
	if (code !== 0 && !errorEmitted) {
		input.onEvent({ type: "error", message: `Claude exited with code ${code}` });
	}
	input.onEvent({ type: "done", code });
	return { code };
}
