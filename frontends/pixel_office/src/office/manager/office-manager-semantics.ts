/**
 * Maps Manager state onto office presentation data.
 *
 * Pressure (0-1) drives atmosphere; accounts become the meter wall; features become
 * library shelves; review agents become review-room NPCs; lessons become the vault.
 */
import type { RuntimeManagerAccount, RuntimeManagerSnapshot, RuntimeManagerState } from "@/runtime/types";

export interface ProviderMeter {
	provider: RuntimeManagerAccount["provider"];
	label: string;
	/** Active account's display name or email — the primary heading, not the provider brand. */
	accountLabel: string | null;
	pressure: number;
	activeEmail: string | null;
	canAutoSwap: boolean;
	accountCount: number;
}

export interface ReviewerNpc {
	name: string;
	displayName: string;
	active: boolean;
}

export interface MemoryVaultState {
	enabled: boolean;
	lessonsActive: number | null;
}

export interface OfficeManagerSemantics {
	pressure: number;
	meters: ProviderMeter[];
	reviewers: ReviewerNpc[];
	memoryVault: MemoryVaultState;
	latestSwap: RuntimeManagerSnapshot["latestSwap"];
	swapPausedUntil: string | null;
	nightShift: boolean;
}

const PROVIDER_LABELS: Record<RuntimeManagerAccount["provider"], string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	antigravity: "Antigravity",
};

/** PixelOffice office chrome only meters Claude fleets. */
const PROVIDER_ORDER: RuntimeManagerAccount["provider"][] = ["claude", "cursor"];

export function emptyOfficeManagerSemantics(): OfficeManagerSemantics {
	return {
		pressure: 0,
		meters: [],
		reviewers: [],
		memoryVault: { enabled: false, lessonsActive: null },
		latestSwap: null,
		swapPausedUntil: null,
		nightShift: false,
	};
}

export function deriveOfficeManagerSemantics(manager: RuntimeManagerState): OfficeManagerSemantics {
	if (manager === null) {
		return emptyOfficeManagerSemantics();
	}

	const meters: ProviderMeter[] = [];
	for (const provider of PROVIDER_ORDER) {
		const accounts = manager.accounts.filter((account) => account.provider === provider);
		if (accounts.length === 0) {
			continue;
		}
		const active = accounts.find((account) => account.id === manager.activeAccountId) ?? accounts[0];
		meters.push({
			provider,
			label: PROVIDER_LABELS[provider],
			accountLabel: active?.displayName ?? active?.email ?? null,
			pressure: active?.pressure ?? 0,
			activeEmail: active?.email ?? null,
			canAutoSwap: active?.canAutoSwap ?? false,
			accountCount: accounts.length,
		});
	}

	const reviewers: ReviewerNpc[] = manager.features
		.filter((feature) => feature.category === "agents")
		.map((feature) => ({
			name: feature.name,
			displayName: feature.displayName,
			active: feature.installed,
		}));

	const memoryHook = manager.features.find(
		(feature) => feature.category === "hooks" && feature.name.includes("memory"),
	);
	const nightShiftFeature = manager.features.find(
		(feature) => feature.name === "night-shift" || feature.name === "night_shift",
	);

	return {
		pressure: manager.pressure,
		meters,
		reviewers,
		memoryVault: {
			enabled: memoryHook?.installed ?? false,
			lessonsActive: manager.lessonsActive,
		},
		latestSwap: manager.latestSwap,
		swapPausedUntil: manager.swapPausedUntil,
		nightShift: nightShiftFeature?.installed === true,
	};
}
