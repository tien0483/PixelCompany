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
import type { RuntimeAgentId, RuntimeManagerAccount, RuntimeManagerProvider } from "../core/api-contract";
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
	/**
	 * Jacked's live active Claude seat (`snapshot.activeAccountId`), unfiltered —
	 * the credential an unpinned launch would actually inherit. Distinct from
	 * `resolveActiveClaudeAccountId`, which returns the auth/donate-healthy pick.
	 * Used to detect a revoked live seat and redirect the launch onto a healthy one.
	 */
	resolveLiveActiveClaudeAccountId?: () => Promise<number | null>;
	/** True when this launch will rewrite CLAUDE_CONFIG_DIR for skill/MCP tags. */
	needsClaudeConfigDirForLaunchTags?: boolean;
	/**
	 * Resolves the pinned account's donate state so an over-cap seat can
	 * hard-block the launch, locked or unlocked.
	 */
	getPinnedAccount?: (accountId: number) => Promise<ManagerDonateAccountLike | null>;
}

export interface ManagerAccountPin {
	env: Record<string, string>;
	accountId: number | null;
	warning: string | null;
	/** True when the pin is refused (locked donate cap over limit). Launch must abort. */
	blocked?: boolean;
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
	donateLimitLocked?: boolean;
	ccNeedsAuth?: boolean;
	validationStatus?: string | null;
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

/**
 * Projects a Manager snapshot account onto the gate's input shape.
 *
 * Lives next to the predicates because the fields it has to carry are exactly the
 * ones they read, and every field here is optional on the target: omitting one
 * type-checks cleanly and silently disables the gate that depends on it. That is
 * how `isActive` went missing and let pins on disabled seats launch.
 */
export function toManagerDonateAccount(account: RuntimeManagerAccount): ManagerDonateAccountLike {
	return {
		id: account.id,
		provider: account.provider,
		isActive: account.isActive,
		isActiveForProvider: account.isActiveForProvider,
		fiveHourPercent: account.fiveHourPercent,
		sevenDayPercent: account.sevenDayPercent,
		pressure: account.pressure,
		donateLimitPercent: account.donateLimitPercent,
		donateLimitLocked: account.donateLimitLocked,
		ccNeedsAuth: account.ccNeedsAuth,
		validationStatus: account.validationStatus,
	};
}

/**
 * True when the seat is paused/disabled in Manager (`is_active=false`).
 *
 * Compared against `false` explicitly: `isActive` is optional on this shape, and
 * a caller that omits it must keep counting as enabled.
 */
export function isManagerAccountDisabled(account: ManagerDonateAccountLike): boolean {
	return account.isActive === false;
}

/**
 * True when the seat is over its donate cap. Refuses explicit pins and unpinned
 * active-seat launches alike — no manual override, locked or unlocked. Only Auto
 * selection had a "soft skip" distinction; direct/pinned use does not.
 */
export function isManagerAccountDonatePinBlocked(account: ManagerDonateAccountLike): boolean {
	return isManagerAccountDonateExhausted(account);
}

/**
 * True when the seat's Claude credentials are dead: jacked's probe marked it
 * `ccNeedsAuth`, or its last validation came back `invalid`/`expired`.
 * `unknown` / `checking` (or an unset field) count as healthy — jacked's probe
 * is best-effort and must not lock out a seat it hasn't validated yet.
 */
export function isManagerAccountAuthBroken(account: ManagerDonateAccountLike): boolean {
	if (account.ccNeedsAuth === true) {
		return true;
	}
	return account.validationStatus === "invalid" || account.validationStatus === "expired";
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
 * Two-stage filter shared by the Claude and Cursor Auto pickers: prefer
 * auth-healthy seats, then narrow to under-donate-cap seats within that set.
 * Each stage falls back to the wider pool when it would otherwise empty out,
 * so a fully broken/exhausted fleet still yields a candidate for the pin's
 * hard-block gates to report on rather than silently picking nothing.
 */
function pickHealthyPool<T extends ManagerDonateAccountLike>(accounts: ReadonlyArray<T>): T[] {
	const authHealthy = accounts.filter((account) => !isManagerAccountAuthBroken(account));
	const pool = authHealthy.length > 0 ? authHealthy : accounts.slice();
	const underLimit = pool.filter((account) => !isManagerAccountDonateExhausted(account));
	return underLimit.length > 0 ? underLimit : pool;
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
	const pool = pickHealthyPool(cursorAccounts);
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

/**
 * Prefer the currently active Claude seat if it is under its donate cap, else
 * the first under-cap Claude seat. Mirrors `pickDefaultCursorAccountId`: an
 * over-donate active seat is skipped for Auto selection so unpinned launches
 * do not wait on jacked's own async auto-swap daemon to move off it first. If
 * every Claude seat is exhausted, falls back to the unfiltered active seat so
 * the locked-cap hard-block in `resolveManagerAccountPin` still has a target.
 */
export function pickDefaultClaudeAccountId(input: {
	accounts: ReadonlyArray<ManagerDonateAccountLike>;
	activeAccountId: number | null;
}): number | null {
	const claudeAccounts = input.accounts.filter(
		(account) => account.provider === "claude" && account.isActive !== false,
	);
	if (claudeAccounts.length === 0) {
		return null;
	}
	const pool = pickHealthyPool(claudeAccounts);
	if (input.activeAccountId !== null && pool.some((account) => account.id === input.activeAccountId)) {
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
		// Unpinned Claude launches follow jacked's global auto-swap, so the seat
		// that actually runs is jacked's active Claude seat — not a pin. The pin
		// gate below never sees it, so an over-cap active seat would run in
		// the Claude CLI ungated (the CLI `start` path passes no pin at all).
		// Resolve that active seat and hard-block it with the same donate-cap
		// rule as an explicit pin. Cursor unpinned launches keep their `agent login`
		// credential, which does not map 1:1 to a Seats row, so they are not gated.
		if (input.agentId === "claude") {
			const liveSeatId =
				(await input.resolveLiveActiveClaudeAccountId?.()) ?? (await input.resolveActiveClaudeAccountId?.()) ?? null;
			if (liveSeatId !== null) {
				const liveSeat = (await input.getPinnedAccount?.(liveSeatId)) ?? null;
				if (liveSeat && isManagerAccountDonatePinBlocked(liveSeat)) {
					return {
						env: {},
						accountId: null,
						blocked: true,
						warning: `The active seat (account ${String(liveSeatId)}) is over its donate cap; refusing to launch until usage resets.`,
					};
				}
				if (liveSeat && isManagerAccountAuthBroken(liveSeat)) {
					const healthySeatId = (await input.resolveActiveClaudeAccountId?.()) ?? null;
					if (healthySeatId === null || healthySeatId === liveSeatId) {
						return {
							env: {},
							accountId: null,
							blocked: true,
							warning: `The active seat (account ${String(liveSeatId)}) needs re-auth; no healthy Claude seat is available to launch on.`,
						};
					}
					let redirectLaunchDir: { configDir: string } | null;
					try {
						redirectLaunchDir = await input.getAccountLaunchDir(healthySeatId);
					} catch {
						redirectLaunchDir = null;
					}
					if (!redirectLaunchDir || redirectLaunchDir.configDir.trim().length === 0) {
						return {
							env: {},
							accountId: null,
							blocked: true,
							warning: `The active seat (account ${String(liveSeatId)}) needs re-auth, and account ${String(healthySeatId)}'s credentials could not be prepared; refusing to launch.`,
						};
					}
					return {
						env: { [CLAUDE_CONFIG_DIR_ENV]: resolveHostPath(redirectLaunchDir.configDir) },
						accountId: healthySeatId,
						warning: `The active seat (account ${String(liveSeatId)}) needs re-auth; launched on account ${String(healthySeatId)} instead.`,
					};
				}
			}
		}
		return mismatchWarning ? { ...UNPINNED, warning: mismatchWarning } : UNPINNED;
	}

	const pinnedAccount = (await input.getPinnedAccount?.(managerAccountId)) ?? null;

	// A seat disabled in Manager must not run a task, even when it is under its
	// donate cap. The card picker already hides disabled seats, but a pin stored
	// before the seat was disabled survives on the board (and the CLI `start` path
	// passes it straight through), so the gate has to live here too. Checked before
	// the provider branches so Claude and Cursor pins share one rule — matching
	// pickDefaultCursorAccountId, which already skips disabled Cursor seats.
	if (pinnedAccount && isManagerAccountDisabled(pinnedAccount)) {
		return {
			env: {},
			accountId: null,
			blocked: true,
			warning: `Account ${String(managerAccountId)} is disabled in Manager; re-enable the seat or switch this task to Auto.`,
		};
	}

	// An explicit pin names the seat the task must run on — no silent swap. A
	// pin on a seat with dead credentials must fail loudly rather than drop the
	// agent into a login screen.
	if (pinnedAccount && isManagerAccountAuthBroken(pinnedAccount)) {
		return {
			env: {},
			accountId: null,
			blocked: true,
			warning: `Account ${String(managerAccountId)} needs re-auth; re-authenticate the seat or switch this task to Auto.`,
		};
	}

	// Donate cap over limit: refuse the pin outright, locked or unlocked. The
	// launch path aborts on `blocked`. No manual override.
	if (pinnedAccount && isManagerAccountDonatePinBlocked(pinnedAccount)) {
		return {
			env: {},
			accountId: null,
			blocked: true,
			warning: `Account ${String(managerAccountId)} is over its donate cap; refusing to launch on this seat until usage resets.`,
		};
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
