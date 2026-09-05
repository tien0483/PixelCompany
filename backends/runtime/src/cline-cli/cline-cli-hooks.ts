// Runs the hook scripts `clineAdapter` writes into `--hooks-dir` before launch.
//
// Those scripts are the only reason a Cline card moves columns: each one reads a JSON payload on
// stdin and shells `kanban hooks notify --event … --source cline`, which the runtime turns into a
// board transition. The in-process SDK path never needed them (it emitted summaries directly), so
// a CLI that renders perfectly but skips this file produces a card that starts and then looks dead.
//
// Payload keys follow what `commands/hooks.ts` actually reads: `hook_event_name`, `tool_name`,
// `tool_input`, plus `event`/`source` for the two scripts that grep their own stdin.
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";

export type ClineCliHookName = "Notification" | "TaskComplete" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse";

/** Mirrors `getClineHookScriptPath` in `terminal/agent-session-adapters.ts`. */
export function resolveClineHookScriptPath(hooksDir: string, hookName: ClineCliHookName): string {
	if (process.platform === "win32") {
		return join(hooksDir, `${hookName}.ps1`);
	}
	return join(hooksDir, hookName);
}

export interface ClineCliHookPayload {
	toolName?: string | null;
	toolInput?: unknown;
	/** Only the Notification script reads this; `user_attention` is what opens a review. */
	event?: string | null;
	notificationType?: string | null;
	finalMessage?: string | null;
	error?: string | null;
}

export interface ClineCliHookRunner {
	fire(hookName: ClineCliHookName, payload?: ClineCliHookPayload): Promise<void>;
	/** Awaits every in-flight hook so a run does not exit while a transition is still in flight. */
	drain(): Promise<void>;
}

function buildPayloadJson(hookName: ClineCliHookName, payload: ClineCliHookPayload | undefined): string {
	const body: Record<string, unknown> = {
		source: "cline",
		hook_event_name: hookName,
		hookEventName: hookName,
	};
	if (payload?.toolName) {
		body.tool_name = payload.toolName;
		body.toolName = payload.toolName;
	}
	if (payload?.toolInput !== undefined) {
		body.tool_input = payload.toolInput;
		body.toolInput = payload.toolInput;
	}
	if (payload?.event) {
		body.event = payload.event;
	}
	if (payload?.notificationType) {
		body.notification_type = payload.notificationType;
	}
	if (payload?.finalMessage) {
		body.final_message = payload.finalMessage;
	}
	if (payload?.error) {
		body.error = payload.error;
	}
	return JSON.stringify(body);
}

function spawnHookScript(scriptPath: string, payloadJson: string): Promise<void> {
	return new Promise((resolve) => {
		const child =
			process.platform === "win32"
				? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
						stdio: ["pipe", "ignore", "ignore"],
					})
				: spawn(scriptPath, [], { stdio: ["pipe", "ignore", "ignore"] });
		// A hook is best-effort by contract: the scripts themselves swallow every failure and print
		// `{"cancel":false}`. Never let one take the agent down.
		child.on("error", () => resolve());
		child.on("close", () => resolve());
		child.stdin?.on("error", () => undefined);
		child.stdin?.end(payloadJson);
	});
}

/**
 * A runner with no hooks dir is a no-op, which is the normal case for a hand-run CLI outside a
 * card. Missing scripts are also silently skipped — `clineAdapter` writes all five, but a stale
 * hooks dir from an older runtime may not have them all.
 */
export function createClineCliHookRunner(hooksDir: string | null): ClineCliHookRunner {
	if (!hooksDir) {
		return {
			fire: async () => undefined,
			drain: async () => undefined,
		};
	}

	const inFlight = new Set<Promise<void>>();

	const fire = async (hookName: ClineCliHookName, payload?: ClineCliHookPayload): Promise<void> => {
		const scriptPath = resolveClineHookScriptPath(hooksDir, hookName);
		try {
			await access(scriptPath, constants.F_OK);
		} catch {
			return;
		}
		const run = spawnHookScript(scriptPath, buildPayloadJson(hookName, payload));
		inFlight.add(run);
		try {
			await run;
		} finally {
			inFlight.delete(run);
		}
	};

	return {
		fire,
		drain: async () => {
			await Promise.all([...inFlight]);
		},
	};
}
