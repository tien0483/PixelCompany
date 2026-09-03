/**
 * Non-PTY one-shot agent invocation for HTML generation.
 * Prompt is delivered on stdin; stdout is stream-json parsed into InvokeEvents.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { RUNTIME_AGENT_CATALOG } from "../core/agent-catalog";
import { buildWindowsCmdArgsArray, resolveWindowsComSpec, shouldUseWindowsCmdLaunch } from "../core/windows-cmd-launch";
import { makeParser } from "../html/html-stream-parser";
import {
	type ManagerAccountPin,
	type ResolveManagerAccountPinInput,
	resolveManagerAccountPin,
} from "../manager/manager-account-pin";
import { withStackBinOnPath } from "../stack/stack-paths";
import { isBinaryAvailableOnPath } from "./command-discovery";

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
	/**
	 * Appended to the CLI's own system prompt. The review chat uses this to be an
	 * assistant rather than a reviewer; nothing else passes it, so the argv every
	 * other caller produces is unchanged.
	 */
	appendSystemPrompt?: string;
	/**
	 * Continues an earlier `-p` run instead of starting fresh. The session id comes
	 * from the `session` meta frame of the run that created it. A one-shot process
	 * per turn is still one process per turn — the history lives in the CLI's own
	 * session store, which is what makes a multi-turn chat possible here without a
	 * PTY. A stale id makes the CLI fail immediately, so callers that resume need a
	 * fallback (see `handleAgentStreamRoute`).
	 */
	resumeSessionId?: string;
	/** Extra env merged after pin + process.env. */
	env?: Record<string, string | undefined>;
	/** When provided, used instead of calling resolveManagerAccountPin internally. */
	accountPin?: ManagerAccountPin;
	/** Inputs for resolveManagerAccountPin when accountPin is not supplied. */
	pinInput?: Omit<ResolveManagerAccountPinInput, "agentId"> & {
		managerAccountId?: number;
	};
	/**
	 * Antigravity only: reasoning effort, and permission to act without asking.
	 *
	 * `agy` starts in `request-review` permission mode, and a `-p` run has no UI to
	 * answer a review request with — the same stall the idle watchdog exists for.
	 * Anything that has to write files (a knowledge-graph rebuild runs scripts and
	 * writes into `.ua/`) must opt in explicitly rather than get it by default.
	 */
	effort?: "low" | "medium" | "high";
	skipPermissions?: boolean;
	/** Called as soon as the child process is spawned, with pause/resume controls. */
	onSpawn?: (child: ChildProcess, control: AgentOneShotControl) => void;
}

export interface AgentOneShotControl {
	pause: () => boolean;
	resume: () => boolean;
	isPaused: () => boolean;
}

/** Engines this module can drive. Anything else is refused up front. */
export const AGENT_ONE_SHOT_SUPPORTED_AGENT_IDS = ["claude", "gemini"] as const;
export type AgentOneShotAgentId = (typeof AGENT_ONE_SHOT_SUPPORTED_AGENT_IDS)[number];

function isAgyAgentId(agentId: string): agentId is "gemini" {
	return agentId === "gemini";
}

/**
 * How the engine is named in an error the reviewer reads. Deliberately not the
 * binary — `claude` and `agy` are what you type, not what the failure is about,
 * and "agy exited with code 7" reads like a missing dependency rather than a
 * failed run.
 */
const AGENT_ONE_SHOT_LABELS: Record<AgentOneShotAgentId, string> = {
	claude: "Claude",
	gemini: "Antigravity CLI",
};

function resolveClaudeBinary(): string {
	const entry = RUNTIME_AGENT_CATALOG.find((agent) => agent.id === "claude");
	const binary = entry?.binary ?? "claude";
	if (!isBinaryAvailableOnPath(binary)) {
		throw new Error(`Claude Code binary "${binary}" is not available on PATH. Install Claude Code to generate HTML.`);
	}
	return binary;
}

/**
 * The Antigravity CLI ships under more than one name, and the catalog records
 * both: `binary` plus `binaryAliases: ["gemini", "antigravity"]`. Probing the
 * aliases matters because the alias that is actually installed decides the flags —
 * `agy` and Google's `gemini` are different programs.
 */
function resolveAgyBinary(): string {
	const entry = RUNTIME_AGENT_CATALOG.find((agent) => agent.id === "gemini");
	const candidates = [entry?.binary, ...(entry?.binaryAliases ?? [])].filter(
		(candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
	);
	for (const candidate of candidates) {
		if (isBinaryAvailableOnPath(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`The Antigravity CLI is not available on PATH (tried ${candidates.join(", ") || "agy"}). Install it from https://antigravity.google.`,
	);
}

/**
 * `agy`'s flags share almost nothing with `claude -p`, and the mismatches are the
 * kind that fail silently:
 *
 * - `-p` is a Go *value* flag, so it must be written `-p=` (empty, because the
 *   prompt arrives on stdin). A bare `-p` swallows the next flag as its value.
 * - Stdin only carries a prompt with `--input-format=stream-json`, which in turn
 *   requires `--output-format=stream-json`. This is not optional plumbing: argv has
 *   a 128 KB single-argument cap, and these prompts run well past it.
 * - `--print-timeout` defaults to 5 minutes and is a wall-clock kill, so anything
 *   longer than a chat turn has to raise it or get cut off mid-run.
 */
export function buildAgyArgv(options: {
	model?: string;
	effort?: "low" | "medium" | "high";
	printTimeoutMs?: number;
	skipPermissions?: boolean;
}): string[] {
	const seconds = options.printTimeoutMs === undefined ? null : Math.max(1, Math.round(options.printTimeoutMs / 1000));
	return [
		"--input-format=stream-json",
		"--output-format=stream-json",
		...(seconds === null ? [] : [`--print-timeout=${String(seconds)}s`]),
		...(options.model ? [`--model=${options.model}`] : []),
		...(options.effort ? [`--effort=${options.effort}`] : []),
		...(options.skipPermissions ? ["--dangerously-skip-permissions"] : []),
		// Last, and empty: the prompt is a stdin NDJSON message.
		"-p=",
	];
}

/** The one NDJSON shape agy accepts; any other `event` prints a warning and exits. */
export function buildAgyStdinPayload(prompt: string): string {
	return `${JSON.stringify({ event: "user", message: { role: "user", content: prompt } })}\n`;
}

/**
 * Every added flag is conditional on its input being present, so a caller that
 * passes neither of the last two produces byte-identical argv to before they
 * existed — the HTML, audit and rules-extract routes must not change behaviour
 * because the review chat needed a system prompt.
 */
export function buildClaudeArgv(
	model?: string,
	allowedTools?: string[],
	options?: { appendSystemPrompt?: string; resumeSessionId?: string },
): string[] {
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
		...(options?.appendSystemPrompt ? ["--append-system-prompt", options.appendSystemPrompt] : []),
		...(options?.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
	];
}

export async function runAgentOneShot(input: RunAgentOneShotInput): Promise<{ code: number | null }> {
	// Every early return below emits `done` alongside its `error`. A consumer that
	// only learns a run is over from `done` — the SSE hook in the browser — sees a
	// stream that just stops otherwise, which is indistinguishable from a dropped
	// connection and is why a refused pin looked like an empty answer area.
	const isAgy = isAgyAgentId(input.agentId);
	if (input.agentId !== "claude" && !isAgy) {
		input.onEvent({
			type: "error",
			message: `One-shot runs support ${AGENT_ONE_SHOT_SUPPORTED_AGENT_IDS.join(" and ")} (got ${input.agentId}).`,
		});
		input.onEvent({ type: "done", code: 1 });
		return { code: 1 };
	}

	// Narrowed from the `string` field so the pin resolver gets a catalog id: the
	// gate above has already established it is one of exactly these two.
	const agentId: AgentOneShotAgentId = isAgy ? "gemini" : "claude";

	let pin: ManagerAccountPin = input.accountPin ?? { env: {}, accountId: null, warning: null };
	if (!input.accountPin && input.pinInput) {
		pin = await resolveManagerAccountPin({
			...input.pinInput,
			agentId,
		});
	}
	if (pin.blocked) {
		const message = pin.warning ?? `Pinned ${input.agentId} account is over its donate cap.`;
		input.onEvent({ type: "error", message });
		input.onEvent({ type: "done", code: 1 });
		return { code: 1 };
	}
	if (pin.warning) {
		input.onEvent({ type: "meta", key: "pin_warning", value: pin.warning });
	}

	let binary: string;
	try {
		binary = isAgy ? resolveAgyBinary() : resolveClaudeBinary();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.onEvent({ type: "error", message });
		input.onEvent({ type: "done", code: 1 });
		return { code: 1 };
	}

	const argv = isAgy
		? buildAgyArgv({
				...(input.model === undefined ? {} : { model: input.model }),
				...(input.effort === undefined ? {} : { effort: input.effort }),
				// agy kills its own run at `--print-timeout`, so it has to know about the
				// caller's ceiling or it would cut a long job short at its 5-minute default.
				...(input.timeoutMs === undefined ? {} : { printTimeoutMs: input.timeoutMs }),
				...(input.skipPermissions === undefined ? {} : { skipPermissions: input.skipPermissions }),
			})
		: buildClaudeArgv(input.model, input.allowedTools, {
				appendSystemPrompt: input.appendSystemPrompt,
				resumeSessionId: input.resumeSessionId,
			});
	// Same stack PATH as an interactive session (see buildTerminalEnvironment):
	// a one-shot agent should have the same tooling as a long-running one.
	const childEnv: NodeJS.ProcessEnv = withStackBinOnPath({
		...process.env,
		...pin.env,
		...input.env,
	});

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
		input.onEvent({ type: "done", code: 1 });
		return { code: 1 };
	}

	input.onEvent({ type: "start", agent: input.agentId, model: input.model });

	let isPaused = false;
	const control: AgentOneShotControl = {
		pause: () => {
			if (isPaused) {
				return false;
			}
			isPaused = true;
			clearIdleTimer();
			if (process.platform !== "win32" && child.pid) {
				try {
					process.kill(child.pid, "SIGSTOP");
					return true;
				} catch {
					return false;
				}
			}
			return false;
		},
		resume: () => {
			if (!isPaused) {
				return false;
			}
			isPaused = false;
			resetIdleTimer();
			if (process.platform !== "win32" && child.pid) {
				try {
					process.kill(child.pid, "SIGCONT");
					return true;
				} catch {
					return false;
				}
			}
			return false;
		},
		isPaused: () => isPaused,
	};

	input.onSpawn?.(child, control);

	const onAbort = () => {
		try {
			if (isPaused && process.platform !== "win32" && child.pid) {
				try {
					process.kill(child.pid, "SIGCONT");
				} catch {
					// already gone
				}
			}
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
		if (input.idleTimeoutMs === undefined || isPaused) {
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

	// agy reads one NDJSON message per line and runs a turn for each; Claude takes
	// the prompt as raw text.
	child.stdin?.on("error", () => {
		// Ignore EPIPE when child exits before stdin is drained
	});
	child.stdin?.write(isAgy ? buildAgyStdinPayload(input.prompt) : input.prompt);
	child.stdin?.end();

	const parse = makeParser(input.agentId);
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
		input.onEvent({ type: "error", message: `${AGENT_ONE_SHOT_LABELS[agentId]} exited with code ${code}` });
	}
	input.onEvent({ type: "done", code });
	return { code };
}
