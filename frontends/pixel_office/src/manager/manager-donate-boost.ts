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

/**
 * The subset of a seat the boost planners need.
 *
 * Deliberately narrow: the bulk action is a fleet-wide override, so it reads no
 * lock, seat-enabled or CC-auth state — see `planDonateBoost`.
 */
export type DonateBoostAccount = Pick<RuntimeManagerAccount, "id" | "donateLimitPercent">;

export interface DonateBoostPatch {
	accountId: number;
	percent: number;
}

export interface DonateBoostPlan {
	patches: DonateBoostPatch[];
	/** Pre-boost cap of every seat in the fleet, keyed the same way as the record. */
	prior: Record<string, number>;
}

export interface DonateRestorePlan {
	patches: DonateBoostPatch[];
	/**
	 * Remembered seats left alone: gone from the fleet, or moved off 100% by hand
	 * since the boost.
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
 * Plans "Max donate": push every seat to 100%, remembering where it was.
 *
 * No seat is exempt — not a locked cap, not a disabled seat, not one still
 * needing CC auth. The bulk toggle is an explicit fleet-wide override, so it
 * deliberately does *not* mirror the per-row slider's disable rule; locked seats
 * ride through on `allowLocked` (jacked would answer 400 `DONATE_LIMIT_LOCKED`
 * otherwise). Each seat's own slider stays locked either way.
 */
export function planDonateBoost(accounts: readonly DonateBoostAccount[]): DonateBoostPlan {
	const patches: DonateBoostPatch[] = [];
	const prior: Record<string, number> = {};
	for (const account of accounts) {
		// Recorded even when the seat is already maxed, so restore puts it back
		// at 100 instead of forgetting it.
		prior[String(account.id)] = account.donateLimitPercent;
		if (account.donateLimitPercent !== DONATE_BOOST_TARGET_PERCENT) {
			patches.push({ accountId: account.id, percent: DONATE_BOOST_TARGET_PERCENT });
		}
	}
	return { patches, prior };
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
		if (account === undefined || account.donateLimitPercent !== DONATE_BOOST_TARGET_PERCENT) {
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
