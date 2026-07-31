/**
 * Maps claude-jacked state onto office presentation data.
 *
 * Pressure (0-1) drives atmosphere; accounts become the meter wall; features become
 * library shelves; review agents become review-room NPCs; lessons become the vault.
 */
import type {
	RuntimeJackedAccount,
	RuntimeJackedFeature,
	RuntimeJackedSnapshot,
	RuntimeJackedState,
} from "@/runtime/types";

export interface ProviderMeter {
	provider: RuntimeJackedAccount["provider"];
	label: string;
	/** Active account's display name or email — the primary heading, not the provider brand. */
	accountLabel: string | null;
	pressure: number;
	activeEmail: string | null;
	canAutoSwap: boolean;
	accountCount: number;
}

export interface LibraryShelf {
	category: RuntimeJackedFeature["category"];
	name: string;
	displayName: string;
	description: string;
	installed: boolean;
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

export interface OfficeJackedSemantics {
	pressure: number;
	meters: ProviderMeter[];
	libraryShelves: LibraryShelf[];
	reviewers: ReviewerNpc[];
	memoryVault: MemoryVaultState;
	latestSwap: RuntimeJackedSnapshot["latestSwap"];
	swapPausedUntil: string | null;
	nightShift: boolean;
}

const PROVIDER_LABELS: Record<RuntimeJackedAccount["provider"], string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	antigravity: "Antigravity",
};

/** PixelOffice office chrome only meters Claude fleets. */
const PROVIDER_ORDER: RuntimeJackedAccount["provider"][] = ["claude"];

export function emptyOfficeJackedSemantics(): OfficeJackedSemantics {
	return {
		pressure: 0,
		meters: [],
		libraryShelves: [],
		reviewers: [],
		memoryVault: { enabled: false, lessonsActive: null },
		latestSwap: null,
		swapPausedUntil: null,
		nightShift: false,
	};
}

export function deriveOfficeJackedSemantics(jacked: RuntimeJackedState): OfficeJackedSemantics {
	if (jacked === null) {
		return emptyOfficeJackedSemantics();
	}

	const meters: ProviderMeter[] = [];
	for (const provider of PROVIDER_ORDER) {
		const accounts = jacked.accounts.filter((account) => account.provider === provider);
		if (accounts.length === 0) {
			continue;
		}
		const active = accounts.find((account) => account.id === jacked.activeAccountId) ?? accounts[0];
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

	const libraryShelves: LibraryShelf[] = jacked.features
		.filter((feature) => feature.category === "commands" || feature.category === "knowledge")
		.map((feature) => ({
			category: feature.category,
			name: feature.name,
			displayName: feature.displayName,
			description: feature.description,
			installed: feature.installed,
		}));

	const reviewers: ReviewerNpc[] = jacked.features
		.filter((feature) => feature.category === "agents")
		.map((feature) => ({
			name: feature.name,
			displayName: feature.displayName,
			active: feature.installed,
		}));

	const memoryHook = jacked.features.find(
		(feature) => feature.category === "hooks" && feature.name.includes("memory"),
	);
	const nightShiftFeature = jacked.features.find(
		(feature) => feature.name === "night-shift" || feature.name === "night_shift",
	);

	return {
		pressure: jacked.pressure,
		meters,
		libraryShelves,
		reviewers,
		memoryVault: {
			enabled: memoryHook?.installed ?? false,
			lessonsActive: jacked.lessonsActive,
		},
		latestSwap: jacked.latestSwap,
		swapPausedUntil: jacked.swapPausedUntil,
		nightShift: nightShiftFeature?.installed === true,
	};
}
