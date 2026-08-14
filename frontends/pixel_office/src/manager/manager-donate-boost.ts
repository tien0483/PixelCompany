import type { RuntimeManagerAccount } from "@/runtime/types";
import {
	LocalStorageKey,
	readLocalStorageItem,
	removeLocalStorageItem,
	writeLocalStorageItem,
} from "@/storage/local-storage-store";

/** Cap every boosted seat lands on — the maximum the slider and the API allow. */
export const DONATE_BOOST_TARGET_PERCENT = 100;

/**
 * What the Seats toolbar remembers between "Max donate" and "Restore caps".
 *
 * `active` is stored rather than inferred from `prior` being non-empty: a fleet
 * already sitting at 100% produces no patches, and an emptiness check would read
 * that back as "never boosted".
 *
 * This lives in one browser's localStorage. Boost in one browser and the other
 * one shows the button as off — the seats stay at 100 until the first browser
 * restores them.
 */
export interface DonateBoostRecord {
	v: 1;
	active: boolean;
	/** Account id (as a string key) -> donateLimitPercent before the boost. */
	prior: Record<string, number>;
}

export const INACTIVE_DONATE_BOOST: DonateBoostRecord = {
	v: 1,
	active: false,
	prior: {},
};

/** The subset of a seat the boost planners need. */
export type DonateBoostAccount = Pick<
	RuntimeManagerAccount,
	| "id"
	| "provider"
	| "donateLimitPercent"
	| "donateLimitLocked"
	| "isActive"
	| "hasCcToken"
	| "ccNeedsAuth"
>;

export interface DonateBoostPatch {
	accountId: number;
	percent: number;
}

export interface DonateBoostPlan {
	patches: DonateBoostPatch[];
	/** Pre-boost cap of every eligible seat, keyed the same way as the record. */
	prior: Record<string, number>;
	/** Seats the bulk action refuses to touch (locked, off, or needing CC auth). */
	skipped: number;
}

export interface DonateRestorePlan {
	patches: DonateBoostPatch[];
	/**
	 * Remembered seats left alone: deleted, no longer eligible, or moved off 100%
	 * by hand since the boost.
	 */
	skipped: number;
}

function isRecordShape(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoostRecord(raw: string): DonateBoostRecord {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecordShape(parsed) || parsed.v !== 1 || typeof parsed.active !== "boolean") {
		return INACTIVE_DONATE_BOOST;
	}
	const prior: Record<string, number> = {};
	if (isRecordShape(parsed.prior)) {
		for (const [key, value] of Object.entries(parsed.prior)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				prior[key] = Math.min(100, Math.max(0, Math.round(value)));
			}
		}
	}
	return { v: 1, active: parsed.active, prior };
}

/** Reads the boost record; anything unreadable or malformed degrades to "not boosted". */
export function readDonateBoost(): DonateBoostRecord {
	const raw = readLocalStorageItem(LocalStorageKey.ManagerDonateBoost);
	if (raw === null || raw.trim() === "") {
		return INACTIVE_DONATE_BOOST;
	}
	try {
		return parseBoostRecord(raw);
	} catch {
		return INACTIVE_DONATE_BOOST;
	}
}

export function writeDonateBoost(record: DonateBoostRecord): void {
	writeLocalStorageItem(LocalStorageKey.ManagerDonateBoost, JSON.stringify(record));
}

export function clearDonateBoost(): void {
	removeLocalStorageItem(LocalStorageKey.ManagerDonateBoost);
}

/**
 * True when the bulk action may move this seat's cap.
 *
 * Mirrors the per-row slider's own disable rule (`AccountRow` in
 * `manager-accounts-view.tsx`) so the toolbar never silently changes a seat
 * whose slider is greyed out. Only `donateLimitLocked` is enforced server-side
 * (PATCH answers 400 `DONATE_LIMIT_LOCKED`); the other two are UI parity.
 */
export function isDonateBoostEligible(account: DonateBoostAccount): boolean {
	if (account.donateLimitLocked || !account.isActive) {
		return false;
	}
	const ccAuthRequired =
		account.provider !== "cursor" && (!account.hasCcToken || account.ccNeedsAuth);
	return !ccAuthRequired;
}

/** Plans "Max donate": push every eligible seat to 100%, remembering where it was. */
export function planDonateBoost(accounts: readonly DonateBoostAccount[]): DonateBoostPlan {
	const patches: DonateBoostPatch[] = [];
	const prior: Record<string, number> = {};
	let skipped = 0;
	for (const account of accounts) {
		if (!isDonateBoostEligible(account)) {
			skipped += 1;
			continue;
		}
		// Recorded even when the seat is already maxed, so restore puts it back
		// at 100 instead of forgetting it.
		prior[String(account.id)] = account.donateLimitPercent;
		if (account.donateLimitPercent !== DONATE_BOOST_TARGET_PERCENT) {
			patches.push({ accountId: account.id, percent: DONATE_BOOST_TARGET_PERCENT });
		}
	}
	return { patches, prior, skipped };
}

/**
 * Plans "Restore caps": put each remembered seat back where it was.
 *
 * A seat is restored only while it still reads 100% — if the user dragged its
 * slider since the boost, that newer value wins and the seat is left alone.
 */
export function planDonateRestore(
	accounts: readonly DonateBoostAccount[],
	record: DonateBoostRecord,
): DonateRestorePlan {
	const byId = new Map(accounts.map((account) => [String(account.id), account]));
	const patches: DonateBoostPatch[] = [];
	let skipped = 0;
	for (const [key, percent] of Object.entries(record.prior)) {
		const account = byId.get(key);
		if (
			account === undefined ||
			!isDonateBoostEligible(account) ||
			account.donateLimitPercent !== DONATE_BOOST_TARGET_PERCENT
		) {
			skipped += 1;
			continue;
		}
		if (percent === DONATE_BOOST_TARGET_PERCENT) {
			// Already where it started; no PATCH, and not a skip either.
			continue;
		}
		patches.push({ accountId: account.id, percent });
	}
	return { patches, skipped };
}
