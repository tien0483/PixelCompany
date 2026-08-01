// Resolves a board task's pinned Jacked account into PTY environment.
//
// Claude pins via CLAUDE_CONFIG_DIR (per-account credential dirs). Cursor pins
// via CURSOR_API_KEY from jacked slot snapshots so concurrent tasks can run on
// different accounts without rewriting the IDE's global sqlite state.
//
// Unpinned Cursor tasks intentionally inject nothing: the Cursor Agent CLI then
// uses the same `agent login` session as an interactive terminal. Auto-injecting
// a stale Seats snapshot overrides that working login and causes false 401s.
//
// Pinning is best-effort: if Manager is offline or refuses the account, the session
// still launches on the CLI login / globally active credential rather than failing.
import type { RuntimeAgentId, RuntimeManagerProvider } from "../core/api-contract";
import { resolveHostPath } from "../terminal/task-launch-settings";

export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
export const CURSOR_API_KEY_ENV = "CURSOR_API_KEY";

export interface ResolveManagerAccountPinInput {
	agentId: RuntimeAgentId;
	managerAccountId?: number | undefined;
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
	getAccountLaunchCredential?: (accountId: number) => Promise<{ apiKey: string } | null>;
	getAccountProvider?: (accountId: number) => Promise<RuntimeManagerProvider | null>;
	/**
	 * Only used when an explicit Cursor pin fails and we need a same-provider
	 * fallback. Unpinned Cursor Auto tasks do not call this — they inherit
	 * `agent login` like a normal terminal.
	 */
	resolveDefaultCursorAccountId?: () => Promise<number | null>;
	/**
	 * When Claude skill/MCP tags force a scoped CLAUDE_CONFIG_DIR on an unpinned
	 * card, prepare the active Jacked seat so CC tokens/onboarding are written
	 * before the scoped dir clones them. Avoids Claude Code's login screen.
	 */
	resolveActiveClaudeAccountId?: () => Promise<number | null>;
	/** True when this launch will rewrite CLAUDE_CONFIG_DIR for skill/MCP tags. */
	needsClaudeConfigDirForLaunchTags?: boolean;
}

export interface ManagerAccountPin {
	env: Record<string, string>;
	accountId: number | null;
	warning: string | null;
}

const UNPINNED: ManagerAccountPin = { env: {}, accountId: null, warning: null };

export interface ManagerDonateAccountLike {
	id: number;
	provider: string;
	isActive?: boolean;
	isActiveForProvider?: boolean;
	fiveHourPercent?: number | null;
	sevenDayPercent?: number | null;
	pressure?: number;
	donateLimitPercent?: number;
}

/**
 * True when max(5h%, 7d%) meets/exceeds the seat's donate cap.
 * Used to Auto-exclude the seat from Auto pick / auto-swap (pins still allowed).
 */
export function isManagerAccountDonateExhausted(account: ManagerDonateAccountLike): boolean {
	const limit = account.donateLimitPercent ?? 100;
	if (account.fiveHourPercent == null && account.sevenDayPercent == null) {
		return (account.pressure ?? 0) * 100 >= limit;
	}
	return Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0) >= limit;
}

function expectedProviderForAgent(agentId: RuntimeAgentId): RuntimeManagerProvider | null {
	if (agentId === "claude") {
		return "claude";
	}
	if (agentId === "cursor") {
		return "cursor";
	}
	return null;
}

function providerMismatchWarning(
	accountId: number,
	accountProvider: RuntimeManagerProvider,
	agentId: RuntimeAgentId,
): string {
	return `Account ${String(accountId)} is a ${accountProvider} account but this task runs ${agentId}; pin ignored.`;
}

/**
 * Prefer the Cursor fleet's own active seat (`isActiveForProvider`), else the
 * first Cursor account. Never treat Claude's global `activeAccountId` as a
 * Cursor default unless that id is itself a Cursor row.
 *
 * Over-donate seats are skipped for Auto selection; if every Cursor seat is
 * exhausted we fall back to the previous unfiltered order so launch still has
 * a credential target when an explicit pin fails.
 */
export function pickDefaultCursorAccountId(input: {
	accounts: ReadonlyArray<ManagerDonateAccountLike>;
	activeAccountId: number | null;
}): number | null {
	const cursorAccounts = input.accounts.filter(
		(account) => account.provider === "cursor" && account.isActive !== false,
	);
	if (cursorAccounts.length === 0) {
		return null;
	}
	const underLimit = cursorAccounts.filter((account) => !isManagerAccountDonateExhausted(account));
	const pool = underLimit.length > 0 ? underLimit : cursorAccounts;
	const activeForProvider = pool.find((account) => account.isActiveForProvider === true);
	if (activeForProvider) {
		return activeForProvider.id;
	}
	if (
		input.activeAccountId !== null &&
		pool.some((account) => account.id === input.activeAccountId)
	) {
		return input.activeAccountId;
	}
	return pool[0]?.id ?? null;
}

async function resolveCursorCredentialPin(
	accountId: number,
	getCredential: (accountId: number) => Promise<{ apiKey: string } | null>,
): Promise<ManagerAccountPin> {
	let credential: { apiKey: string } | null;
	try {
		credential = await getCredential(accountId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			...UNPINNED,
			warning: `Could not prepare Cursor credentials for account ${String(accountId)}: ${message}`,
		};
	}
	const apiKey = credential?.apiKey.trim() ?? "";
	if (apiKey.length === 0) {
		return {
			...UNPINNED,
			warning: `Manager could not prepare Cursor credentials for account ${String(accountId)}; using the active credential.`,
		};
	}
	return {
		env: { [CURSOR_API_KEY_ENV]: apiKey },
		accountId,
		warning: null,
	};
}

export async function resolveManagerAccountPin(
	input: ResolveManagerAccountPinInput,
): Promise<ManagerAccountPin> {
	let { managerAccountId } = input;
	let mismatchWarning: string | null = null;

	if (managerAccountId !== undefined) {
		const accountProvider = (await input.getAccountProvider?.(managerAccountId)) ?? null;
		const expectedProvider = expectedProviderForAgent(input.agentId);
		if (expectedProvider === null) {
			return {
				...UNPINNED,
				warning: `Account pinning only applies to Claude Code and Cursor Agent; ${input.agentId} sessions ignore it.`,
			};
		}
		if (accountProvider !== null && accountProvider !== expectedProvider) {
			mismatchWarning = providerMismatchWarning(managerAccountId, accountProvider, input.agentId);
			// Drop the orphaned cross-provider pin. For Cursor, fall through to
			// unpinned CLI login rather than forcing another Seats snapshot.
			managerAccountId = undefined;
		}
	}

	// Claude skill/MCP tags rewrite CLAUDE_CONFIG_DIR. Unpinned cards must still
	// run prepare_account_dir for the active seat so the scoped clone gets a
	// fresh CC credential + oauthAccount seed (otherwise Claude shows login).
	if (
		managerAccountId === undefined &&
		input.agentId === "claude" &&
		input.needsClaudeConfigDirForLaunchTags === true
	) {
		const activeId = (await input.resolveActiveClaudeAccountId?.()) ?? null;
		if (activeId !== null) {
			managerAccountId = activeId;
		}
	}

	// Cursor Auto (no pin): do not inject CURSOR_API_KEY. Interactive `agent`
	// already authenticates via `agent login`; a Jacked snapshot often overrides
	// that with a stale key and breaks an otherwise working CLI.
	if (managerAccountId === undefined) {
		return mismatchWarning ? { ...UNPINNED, warning: mismatchWarning } : UNPINNED;
	}

	if (input.agentId === "claude") {
		let launchDir: { configDir: string } | null;
		try {
			launchDir = await input.getAccountLaunchDir(managerAccountId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				...UNPINNED,
				warning: `Could not prepare credentials for account ${String(managerAccountId)}: ${message}`,
			};
		}
		if (!launchDir || launchDir.configDir.trim().length === 0) {
			return {
				...UNPINNED,
				warning: `Manager could not prepare credentials for account ${String(managerAccountId)}; using the active account.`,
			};
		}
		// Normalize Win paths when the runtime is on WSL/Linux (Jacked may return `C:\...`).
		return {
			env: { [CLAUDE_CONFIG_DIR_ENV]: resolveHostPath(launchDir.configDir) },
			accountId: managerAccountId,
			warning: mismatchWarning,
		};
	}

	const getCredential = input.getAccountLaunchCredential;
	if (!getCredential) {
		return {
			...UNPINNED,
			warning: mismatchWarning ?? "Cursor account pinning is unavailable; using the active credential.",
		};
	}

	const pinned = await resolveCursorCredentialPin(managerAccountId, getCredential);
	if (pinned.accountId !== null) {
		return mismatchWarning ? { ...pinned, warning: mismatchWarning } : pinned;
	}

	// Explicit pin failed — try the Cursor fleet default before giving up.
	const fallbackId = (await input.resolveDefaultCursorAccountId?.()) ?? null;
	if (fallbackId !== null && fallbackId !== managerAccountId) {
		const fallback = await resolveCursorCredentialPin(fallbackId, getCredential);
		if (fallback.accountId !== null) {
			return {
				...fallback,
				warning:
					mismatchWarning ??
					`Pinned Cursor account ${String(managerAccountId)} was unavailable; using account ${String(fallbackId)}.`,
			};
		}
	}

	return {
		...UNPINNED,
		warning: mismatchWarning ?? pinned.warning,
	};
}
