// Single source for user-facing brand strings in the web bundle.
// The runtime bundle has its own mirror at backends/runtime/src/brand.ts (P-3).
export const BRAND_NAME = "PIXTiel";
export const BRAND_COLOR = "#0084FF";

/** v1.0.131 -> "v1.0.0131" (build counter, patch zero-padded to 4 — DESIGN P-10). */
export function formatVersion(version: string): string {
	const [major = "0", minor = "0", patch = "0"] = version.split(".");
	return `v${major}.${minor}.${patch.padStart(4, "0")}`;
}
