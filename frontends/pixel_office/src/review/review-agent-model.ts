/**
 * Which Claude model the Review tab's one-shot agents run on.
 *
 * The three review passes (`/api/review/chat`, `/audit`, `/rules-extract`) used to
 * send no model at all, so every slash command in the panel ran on whatever the
 * `claude` CLI defaults to — Opus on most setups. A review pass is a bounded,
 * well-specified job against a diff that is already in the prompt, so Haiku is the
 * right default: the same answer, minutes sooner, and off the expensive seat.
 *
 * Aliases rather than dated ids, deliberately — the CLI resolves `haiku` to the
 * current Haiku, so this list does not need editing on every model release. The
 * runtime already advertises the same aliases in `agent-model-inventory.ts`.
 */
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export const REVIEW_AGENT_MODEL_OPTIONS = [
	{ id: "haiku", label: "Haiku", hint: "Fastest — enough for a diff-scoped review" },
	{ id: "sonnet", label: "Sonnet", hint: "Slower, better on subtle logic" },
	{ id: "opus", label: "Opus", hint: "Slowest and most expensive — for a hairy merge request" },
] as const;

export type ReviewAgentModelId = (typeof REVIEW_AGENT_MODEL_OPTIONS)[number]["id"];

export const DEFAULT_REVIEW_AGENT_MODEL: ReviewAgentModelId = "haiku";

export function normalizeReviewAgentModel(value: string | null | undefined): ReviewAgentModelId {
	const match = REVIEW_AGENT_MODEL_OPTIONS.find((option) => option.id === value?.trim());
	return match ? match.id : DEFAULT_REVIEW_AGENT_MODEL;
}

export function readStoredReviewAgentModel(): ReviewAgentModelId {
	return normalizeReviewAgentModel(readLocalStorageItem(LocalStorageKey.ReviewAgentModel));
}

export function writeStoredReviewAgentModel(model: ReviewAgentModelId): void {
	writeLocalStorageItem(LocalStorageKey.ReviewAgentModel, model);
}
