// Resolves a board task's pinned Claude account into PTY environment.
//
// jacked's auto-swap rewrites one global credential file, so every unpinned
// Claude Code session shares whichever account is active. Pinning instead points
// a single session at `~/.claude/accounts/<id>` via CLAUDE_CONFIG_DIR, which is
// how several tasks can run on different accounts at the same time.
//
// Pinning is best-effort by design: if jacked is offline or refuses the account,
// the session still launches on the globally active credential rather than
// failing, and the caller surfaces the reason.
import type { RuntimeAgentId } from "../core/api-contract";

export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";

export interface ResolveJackedAccountPinInput {
	/** The agent actually being launched; only Claude Code reads CLAUDE_CONFIG_DIR. */
	agentId: RuntimeAgentId;
	/** Account pinned to the card, or undefined to follow jacked's global rotation. */
	jackedAccountId?: number | undefined;
	/** Prepares the per-account credential dir; null when jacked cannot serve it. */
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
}

export interface JackedAccountPin {
	/** Env overlay to merge into the session environment (empty when unpinned). */
	env: Record<string, string>;
	/** Account the session ended up pinned to, null when it follows the global credential. */
	accountId: number | null;
	/** Human-readable reason a requested pin was not applied. */
	warning: string | null;
}

const UNPINNED: JackedAccountPin = { env: {}, accountId: null, warning: null };

export async function resolveJackedAccountPin(input: ResolveJackedAccountPinInput): Promise<JackedAccountPin> {
	const { jackedAccountId } = input;
	if (jackedAccountId === undefined) {
		return UNPINNED;
	}
	if (input.agentId !== "claude") {
		return {
			...UNPINNED,
			warning: `Account pinning only applies to Claude Code; ${input.agentId} sessions ignore it.`,
		};
	}
	let launchDir: { configDir: string } | null;
	try {
		launchDir = await input.getAccountLaunchDir(jackedAccountId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			...UNPINNED,
			warning: `Could not prepare credentials for account ${String(jackedAccountId)}: ${message}`,
		};
	}
	if (!launchDir || launchDir.configDir.trim().length === 0) {
		return {
			...UNPINNED,
			warning: `Jacked could not prepare credentials for account ${String(jackedAccountId)}; using the active account.`,
		};
	}
	return {
		env: { [CLAUDE_CONFIG_DIR_ENV]: launchDir.configDir },
		accountId: jackedAccountId,
		warning: null,
	};
}
