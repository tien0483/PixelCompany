import type { RuntimeJackedFeature } from "@/runtime/types";

/** Shelf membership rules over the flat feature list the runtime streams. */
export const FEATURE_SHELF_SELECTORS = {
	staff: (feature: RuntimeJackedFeature) => feature.category === "agents",
	playbooks: (feature: RuntimeJackedFeature) => feature.category === "commands",
	// jacked returns skills inside `knowledge`, prefixed `skill_`; the rest of that
	// category is house rules and reference material.
	training: (feature: RuntimeJackedFeature) =>
		feature.category === "knowledge" && feature.name.startsWith("skill_"),
	handbook: (feature: RuntimeJackedFeature) =>
		feature.category === "knowledge" && !feature.name.startsWith("skill_"),
} as const;
