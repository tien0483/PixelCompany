import type { RuntimeJackedProvider } from "@/runtime/types";

const PROVIDER_LABELS: Record<RuntimeJackedProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	antigravity: "Antigravity",
};

export function jackedProviderLabel(provider: RuntimeJackedProvider): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

export function formatPercent(value: number | null): string {
	if (value === null) {
		return "—";
	}
	return `${Math.round(value)}%`;
}

export function pressureBarColor(pressure: number, canAutoSwap: boolean): string {
	if (!canAutoSwap) {
		return "var(--color-text-tertiary)";
	}
	if (pressure >= 0.9) {
		return "var(--color-status-red)";
	}
	if (pressure >= 0.7) {
		return "var(--color-status-orange)";
	}
	return "var(--color-status-green)";
}
