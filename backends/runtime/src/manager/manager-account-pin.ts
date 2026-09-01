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
import type {
	RuntimeAgentId,
	RuntimeManagerAccount,
	RuntimeManagerProvider,
	RuntimeSeatPreset,
} from "../core/api-contract";
import { resolveHostPath } from "../terminal/task-launch-settings";
import { extraCreditRemainingUsd, pickBestClaudeAutoSeat, pickBestFableSeat, type AutoSeatFleetContext } from "./claude-auto-seat-ranking";

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
	 * Board-task launches only: resolves an unpinned Claude card onto a concrete
	 * seat, which is then pinned like an explicit one. Supplying this is what turns
	 * "Auto" from "inherit jacked's global credential" into a real per-task pin, so
	 * task load stops landing on whichever seat jacked last swapped to.
	 *
	 * The one-shot routes (Plans, Review, doc-skill, graph-rebuild) leave it unset:
	 * their callers either send an explicit id or deliberately want the global seat.
	 */
	resolveAutoClaudeAccountId?: () => Promise<number | null>;
	/**
	 * Seat resolution mode from the card, when it names a policy instead of an account.
	 * Ignored once `managerAccountId` is set — an explicit pin always wins.
	 */
	seatPreset?: RuntimeSeatPreset | undefined;
	/**
	 * Board-task launches with `seatPreset: "fable"`: resolves onto the Claude seat with the
	 * most spendable extra usage credit. Supplying this is what makes the preset work at all;
	 * the one-shot routes leave it unset because they never carry a preset.
	 */
	resolveFableClaudeAccountId?: () => Promise<number | null>;
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
	fiveHourResetsAt?: string | null;
	sevenDayResetsAt?: string | null;
	pressure?: number;
	donateLimitPercent?: number;
	donateLimitLocked?: boolean;
	ccNeedsAuth?: boolean;
	validationStatus?: string | null;
	/** Extra usage credit pool; the Fable preset refuses to launch on a seat with none left. */
	extraUsage?: RuntimeManagerAccount["extraUsage"];
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
		fiveHourResetsAt: account.fiveHourResetsAt,
		sevenDayResetsAt: account.sevenDayResetsAt,
		pressure: account.pressure,
		donateLimitPercent: account.donateLimitPercent,
		donateLimitLocked: account.donateLimitLocked,
		ccNeedsAuth: account.ccNeedsAuth,
		validationStatus: account.validationStatus,
		extraUsage: account.extraUsage,
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
	if (agentId === "gemini") {
		return "antigravity";
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
 * Picks the pool member with the lowest 5h usage (missing usage counts as 0,
 * so an unvalidated seat is never penalized). Ties keep the first candidate,
 * matching the previous `pool[0]` fallback's determinism.
 *
 * Cursor and Antigravity only. Claude seats rank through `pickBestClaudeAutoSeat`,
 * which also weighs the 7d deadline — Cursor's pools are monthly, so a 5h/7d
 * deadline bucket would classify every Cursor seat identically.
 */
function pickLeastFiveHourUsage<T extends ManagerDonateAccountLike>(pool: ReadonlyArray<T>): T | null {
	if (pool.length === 0) {
		return null;
	}
	return pool.reduce((best, account) =>
		(account.fiveHourPercent ?? 0) < (best.fiveHourPercent ?? 0) ? account : best,
	);
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
	if (input.activeAccountId !== null && pool.some((account) => account.id === input.activeAccountId)) {
		return input.activeAccountId;
	}
	return pickLeastFiveHourUsage(pool)?.id ?? null;
}

/**
 * Prefer the currently active Claude seat if it is under its donate cap, else
 * the best-ranked under-cap Claude seat (see `pickBestClaudeAutoSeat`). Mirrors
 * `pickDefaultCursorAccountId`: an over-donate active seat is skipped for
 * Auto selection so unpinned launches do not wait on jacked's own async
 * auto-swap daemon to move off it first. If every Claude seat is exhausted,
 * falls back to the unfiltered active seat so the locked-cap hard-block in
 * `resolveManagerAccountPin` still has a target.
 */
export function pickDefaultClaudeAccountId(input: {
	accounts: ReadonlyArray<ManagerDonateAccountLike>;
	activeAccountId: number | null;
	fleetContext?: AutoSeatFleetContext;
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
	return pickBestClaudeAutoSeat(pool, Date.now(), input.fleetContext)?.id ?? null;
}

/**
 * The seat an Auto (unpinned) Claude board task runs on: the best-ranked healthy,
 * under-cap, enabled Claude seat — nearest 7d reset first, then least used, with a
 * 5h-saturated seat sunk to the back. See `claude-auto-seat-ranking.ts`.
 *
 * Deliberately ignores jacked's global active seat, which is what separates this
 * from `pickDefaultClaudeAccountId`. That seat is the credential an unpinned launch
 * used to inherit, it is what the Plans and Review tabs fall back to, and jacked's
 * auto-swap daemon rewrites it underneath both — so every Auto card piling onto it
 * is exactly what this picker exists to stop.
 */
export function pickLeastUsedClaudeAccountId(input: {
	accounts: ReadonlyArray<ManagerDonateAccountLike>;
	fleetContext?: AutoSeatFleetContext;
}): number | null {
	const claudeAccounts = input.accounts.filter(
		(account) => account.provider === "claude" && account.isActive !== false,
	);
	if (claudeAccounts.length === 0) {
		return null;
	}
	return pickBestClaudeAutoSeat(pickHealthyPool(claudeAccounts), Date.now(), input.fleetContext)?.id ?? null;
}

/**
 * The seat a `seatPreset: "fable"` card runs on: the enabled, auth-healthy Claude seat with the
 * most spendable extra usage credit, preferring seats whose subscription windows are already
 * capped. See `claude-auto-seat-ranking.ts` for why saturation is a *preference* here.
 *
 * Deliberately narrows with `isManagerAccountAuthBroken` alone rather than `pickHealthyPool`:
 * that helper's second stage drops over-donate-cap seats, and those are precisely the seats
 * whose next turn bills credit. The donate-cap launch gate is skipped for this preset to match
 * (`resolveManagerAccountPin`), so the narrowing and the gate stay consistent.
 */
export function pickFableClaudeAccountId(input: { accounts: ReadonlyArray<ManagerDonateAccountLike> }): number | null {
	const claudeAccounts = input.accounts.filter(
		(account) => account.provider === "claude" && account.isActive !== false && !isManagerAccountAuthBroken(account),
	);
	if (claudeAccounts.length === 0) {
		return null;
	}
	return pickBestFableSeat(claudeAccounts)?.id ?? null;
}

/** True when the seat has no extra usage credit left to spend, so the Fable preset must refuse. */
export function isFableSeatCreditExhausted(account: ManagerDonateAccountLike): boolean {
	return extraCreditRemainingUsd(account) === null;
}

export function pickDefaultAntigravityAccountId(input: {
	accounts: ReadonlyArray<ManagerDonateAccountLike>;
	activeAccountId: number | null;
}): number | null {
	const antigravityAccounts = input.accounts.filter(
		(account) => account.provider === "antigravity" && account.isActive !== false,
	);
	if (antigravityAccounts.length === 0) {
		return null;
	}
	const pool = pickHealthyPool(antigravityAccounts);
	const activeForProvider = pool.find((account) => account.isActiveForProvider === true);
	if (activeForProvider) {
		return activeForProvider.id;
	}
	return pickLeastFiveHourUsage(pool)?.id ?? null;
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

/**
 * Tail of the hard-block warnings. An Auto-resolved seat has no pin to change, and
 * `pickHealthyPool` already skips broken and over-cap seats — so reaching a block on
 * an Auto launch means the whole Claude fleet is unusable, which is what to say.
 */
function blockedPinRemedy(autoResolved: boolean, explicit: string): string {
	return autoResolved ? "no healthy Claude seat is available to launch on." : explicit;
}

export async function resolveManagerAccountPin(input: ResolveManagerAccountPinInput): Promise<ManagerAccountPin> {
	let { managerAccountId } = input;
	let mismatchWarning: string | null = null;
	// True when the seat below was chosen by Auto rather than named by the card.
	// Only affects the wording of the hard-block warnings: telling someone to
	// "switch this task to Auto" makes no sense when Auto is what picked the seat.
	let autoResolved = false;
	// The Fable preset spends extra usage credit, which only bills once a seat's subscription
	// windows are capped — so the donate-cap gate below, which exists to keep tasks off capped
	// seats, would refuse every seat this preset is meant to choose. It is skipped for the
	// preset and replaced by a credit-exhaustion refusal. The disabled and auth-broken gates
	// still apply: neither of those seats can run a task at all.
	const fablePreset = input.seatPreset === "fable" && input.agentId === "claude";

	if (managerAccountId !== undefined) {
		const accountProvider = (await input.getAccountProvider?.(managerAccountId)) ?? null;
		const expectedProvider = expectedProviderForAgent(input.agentId);
		if (expectedProvider === null) {
			return {
				...UNPINNED,
				warning: `Account pinning only applies to Claude Code, Cursor Agent, and Antigravity CLI; ${input.agentId} sessions ignore it.`,
			};
		}
		if (accountProvider !== null && accountProvider !== expectedProvider) {
			mismatchWarning = providerMismatchWarning(managerAccountId, accountProvider, input.agentId);
			// Drop the orphaned cross-provider pin. For Cursor, fall through to
			// unpinned CLI login rather than forcing another Seats snapshot.
			managerAccountId = undefined;
		}
	}

	// Auto on a Claude card resolves to a concrete seat and is pinned from here on,
	// so the launch never rides jacked's global credential. This also subsumes the
	// skill/MCP-tag case: those rewrite CLAUDE_CONFIG_DIR and need prepare_account_dir
	// to have run for some seat first, or the scoped clone has no CC credential and
	// Claude opens on its login screen. `resolveActiveClaudeAccountId` remains that
	// case's fallback for callers (the one-shot routes) that pass no Auto resolver.
	if (managerAccountId === undefined && input.agentId === "claude") {
		// A preset resolves first: it names a different pool than Auto does, and falling through
		// to Auto would silently run a Fable card on a seat with no credit to spend.
		const presetId = fablePreset ? ((await input.resolveFableClaudeAccountId?.()) ?? null) : null;
		if (fablePreset && presetId === null) {
			return {
				env: {},
				accountId: null,
				blocked: true,
				warning: "No Claude seat has extra usage credit remaining; the Fable seat was not launched.",
			};
		}
		const autoId =
			presetId ??
			(await input.resolveAutoClaudeAccountId?.()) ??
			(input.needsClaudeConfigDirForLaunchTags === true
				? ((await input.resolveActiveClaudeAccountId?.()) ?? null)
				: null);
		if (autoId !== null) {
			managerAccountId = autoId;
			autoResolved = true;
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
				(await input.resolveLiveActiveClaudeAccountId?.()) ??
				(await input.resolveActiveClaudeAccountId?.()) ??
				null;
			if (liveSeatId !== null) {
				const liveSeat = (await input.getPinnedAccount?.(liveSeatId)) ?? null;
				if (liveSeat && !fablePreset && isManagerAccountDonatePinBlocked(liveSeat)) {
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
			warning: `Account ${String(managerAccountId)} is disabled in Manager; ${blockedPinRemedy(autoResolved, "re-enable the seat or switch this task to Auto.")}`,
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
			warning: `Account ${String(managerAccountId)} needs re-auth; ${blockedPinRemedy(autoResolved, "re-authenticate the seat or switch this task to Auto.")}`,
		};
	}

	// The Fable preset's own refusal, standing in for the donate-cap gate it skips. Without it
	// a fleet whose credit ran out mid-month would keep launching Claude Fable 5 — the priciest
	// tier — against ordinary subscription capacity.
	if (fablePreset && pinnedAccount && isFableSeatCreditExhausted(pinnedAccount)) {
		return {
			env: {},
			accountId: null,
			blocked: true,
			warning: autoResolved
				? "No Claude seat has extra usage credit remaining; the Fable seat was not launched."
				: `Account ${String(managerAccountId)} has no extra usage credit remaining; the Fable seat was not launched.`,
		};
	}

	// Donate cap over limit: refuse the pin outright, locked or unlocked. The
	// launch path aborts on `blocked`. No manual override.
	if (!fablePreset && pinnedAccount && isManagerAccountDonatePinBlocked(pinnedAccount)) {
		return {
			env: {},
			accountId: null,
			blocked: true,
			warning: autoResolved
				? `Every Claude seat is over its donate cap (account ${String(managerAccountId)} ranked best); refusing to launch until usage resets.`
				: `Account ${String(managerAccountId)} is over its donate cap; refusing to launch on this seat until usage resets.`,
		};
	}

	if (input.agentId === "gemini") {
		return {
			env: {},
			accountId: managerAccountId,
			warning: mismatchWarning,
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
