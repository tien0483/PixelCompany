import type { RuntimeManagerFeature } from "@/runtime/types";

/** Shelf membership rules over the flat feature list the runtime streams. */
export const FEATURE_SHELF_SELECTORS = {
	agents: (feature: RuntimeManagerFeature) => feature.category === "agents",
	commands: (feature: RuntimeManagerFeature) => feature.category === "commands",
	// manager returns skills inside `knowledge`, prefixed `skill_`; the rest of that
	// category is house rules and reference material.
	skills: (feature: RuntimeManagerFeature) =>
		feature.category === "knowledge" && feature.name.startsWith("skill_"),
	rules: (feature: RuntimeManagerFeature) =>
		feature.category === "knowledge" && !feature.name.startsWith("skill_"),
} as const;
