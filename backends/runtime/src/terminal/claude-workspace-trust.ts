import type { RuntimeAgentId } from "../core/api-contract";
import { getLegacyTaskWorktreesHomePath, getTaskWorktreesHomePath } from "../state/workspace-state";

export const WORKSPACE_TRUST_CONFIRM_DELAY_MS = 100;

function normalizeTerminalText(input: string): string {
	return input.toLowerCase().replace(/\s+/gu, " ");
}

function stripAnsiAndControl(input: string): string {
	let output = "";
	let mode: "text" | "escape" | "csi" | "osc" | "osc_escape" = "text";
	for (const char of input) {
		if (mode === "text") {
			if (char === "\u001b") {
				mode = "escape";
				continue;
			}
			const code = char.charCodeAt(0);
			if ((code >= 32 && code !== 127) || char === "\n" || char === "\r" || char === "\t") {
				output += char;
			}
			continue;
		}
		if (mode === "escape") {
			if (char === "[") {
				mode = "csi";
				continue;
			}
			if (char === "]") {
				mode = "osc";
				continue;
			}
			mode = "text";
			continue;
		}
		if (mode === "csi") {
			const code = char.charCodeAt(0);
			if (code >= 64 && code <= 126) {
				mode = "text";
			}
			continue;
		}
		if (mode === "osc") {
			if (char === "\u0007") {
				mode = "text";
			} else if (char === "\u001b") {
				mode = "osc_escape";
			}
			continue;
		}
		if (mode === "osc_escape") {
			mode = char === "\\" ? "text" : "osc";
		}
	}
	return output;
}

export function hasClaudeWorkspaceTrustPrompt(text: string): boolean {
	const normalized = normalizeTerminalText(stripAnsiAndControl(text));
	return (
		/yes,?\s*i\s*trust\s*this\s*folder/u.test(normalized) ||
		/trust\s+this\s+folder/u.test(normalized) ||
		/trust\s+the\s+files/u.test(normalized) ||
		/trust\s+the\s+authors/u.test(normalized) ||
		/do\s+you\s+trust/u.test(normalized)
	);
}

function normalizeDirectoryPrefix(path: string): string {
	return `${path.replace(/\\/gu, "/").replace(/\/+$/u, "")}/`;
}

function isTaskWorktreePath(path: string): boolean {
	// Both roots count: worktrees created before the home-directory rename are never
	// moved, so auto-trust has to keep working for those in-flight tasks.
	const worktreeRoots = [getTaskWorktreesHomePath(), getLegacyTaskWorktreesHomePath()].map(normalizeDirectoryPrefix);
	const normalizedPath = normalizeDirectoryPrefix(path);
	return worktreeRoots.some((root) =>
		process.platform === "win32"
			? normalizedPath.toLowerCase().startsWith(root.toLowerCase())
			: normalizedPath.startsWith(root),
	);
}

export function shouldAutoConfirmClaudeWorkspaceTrust(agentId: RuntimeAgentId, cwd: string): boolean {
	return agentId === "claude" && Boolean(cwd?.trim());
}

export function stopWorkspaceTrustTimers(state: { workspaceTrustConfirmTimer: NodeJS.Timeout | null }): void {
	if (state.workspaceTrustConfirmTimer) {
		clearTimeout(state.workspaceTrustConfirmTimer);
		state.workspaceTrustConfirmTimer = null;
	}
}
