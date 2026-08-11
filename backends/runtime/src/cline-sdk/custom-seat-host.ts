// Maps a Cline *seat* id (what the user picked) to the *host* provider id the SDK
// actually streams under.
//
// Why this exists: the SDK's agent gateway is constructed as
// `createGateway({ providerConfigs, logger })` and never with `providers`, so its
// registry only ever holds the built-in provider manifests. A seat the user added
// through `models.json` is registered in `ClineCore.Llms` (so it lists models fine)
// but is invisible to the gateway, and the very first turn dies with
// `Unknown or disabled provider "<id>"`. Every custom OpenAI-compatible seat has to
// borrow a built-in manifest while its own baseUrl / apiKey / modelId ride along in
// the launch config.
//
// `openrouter` is the closest built-in: `openai-compatible` family, default
// `openai-chat` protocol (custom endpoints serve `/v1/chat/completions`), and
// `vendor/model` ids that match what these endpoints publish. A seat that speaks the
// OpenAI *responses* API instead would need `litellm` as its host — set
// `CLINE_CUSTOM_SEAT_HOST_PROVIDER_ID` for that case.
//
// This started as an OmniRoute-only swap (see ../omniroute/omniroute-endpoint.ts);
// it is generic because every user-added seat hits the exact same wall.

import { isBuiltInProviderId, normalizeProviderId } from "@clinebot/core";

/** Built-in provider id that custom (models.json) seats stream under. */
export const DEFAULT_CUSTOM_SEAT_HOST_PROVIDER_ID = "openrouter";

/** Env override, shared by every custom seat. */
export function resolveCustomSeatHostProviderId(): string {
	const fromEnv = process.env.CLINE_CUSTOM_SEAT_HOST_PROVIDER_ID?.trim().toLowerCase() ?? "";
	return fromEnv.length > 0 ? fromEnv : DEFAULT_CUSTOM_SEAT_HOST_PROVIDER_ID;
}

/** True when the SDK gateway knows this id natively and no swap is needed. */
export function isBuiltInSeatProviderId(seatProviderId: string): boolean {
	const normalized = seatProviderId.trim().toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	return isBuiltInProviderId(normalizeProviderId(normalized));
}

/**
 * Built-in seat -> itself (aliases normalized to their canonical id).
 * Custom seat -> the borrowed built-in host id.
 */
export function resolveSeatHostProviderId(seatProviderId: string): string {
	const normalized = seatProviderId.trim().toLowerCase();
	if (normalized.length === 0) {
		return normalized;
	}
	const canonical = normalizeProviderId(normalized);
	return isBuiltInProviderId(canonical) ? canonical : resolveCustomSeatHostProviderId();
}

/**
 * A borrowed manifest carries the *host's* default endpoint, so a custom seat without
 * its own base URL would silently send the user's key to openrouter.ai. Fail instead.
 */
export function assertCustomSeatBaseUrl(seatProviderId: string, baseUrl: string | null | undefined): void {
	if (isBuiltInSeatProviderId(seatProviderId)) {
		return;
	}
	if ((baseUrl?.trim() ?? "").length > 0) {
		return;
	}
	throw new Error(
		`Custom provider "${seatProviderId}" has no base URL. Open Settings, edit the provider, and set its OpenAI-compatible endpoint (for example https://api.example.com/v1) before starting a task on this seat.`,
	);
}
