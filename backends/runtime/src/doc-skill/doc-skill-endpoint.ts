// Shared host/port/base-URL resolution for the docs sidecar, so the process
// supervisor (which spawns it) and the HTTP client (which talks to it) never
// drift onto different env-var ladders.

export const DEFAULT_DOCSKILL_HOST = "127.0.0.1";
export const DEFAULT_DOCSKILL_PORT = 8323;

/**
 * Resolution order: an explicit `configured` value, then the port embedded in
 * `PIXELOFFICE_DOCSKILL_URL`, then `PIXELOFFICE_DOCSKILL_PORT`, then the
 * default port.
 */
export function resolveDocSkillPort(configured: number | undefined): number {
	if (configured !== undefined) {
		return configured;
	}
	const fromUrl = process.env.PIXELOFFICE_DOCSKILL_URL?.trim();
	if (fromUrl) {
		try {
			const parsed = new URL(fromUrl);
			if (parsed.port) {
				return Number(parsed.port);
			}
		} catch {
			// fall through
		}
	}
	const fromPortEnv = process.env.PIXELOFFICE_DOCSKILL_PORT?.trim();
	if (fromPortEnv) {
		const parsed = Number(fromPortEnv);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return DEFAULT_DOCSKILL_PORT;
}

/**
 * Resolution order: an explicit `configured` URL, then `PIXELOFFICE_DOCSKILL_URL`
 * verbatim, then `http://127.0.0.1:<resolveDocSkillPort()>` — so a bare
 * `PIXELOFFICE_DOCSKILL_PORT` override (with no `_URL` set) reaches the client
 * the same way it already reaches the process supervisor.
 */
export function resolveDocSkillBaseUrl(configured: string | undefined): string {
	const fromUrl = configured ?? process.env.PIXELOFFICE_DOCSKILL_URL?.trim();
	if (fromUrl) {
		return fromUrl.replace(/\/$/, "");
	}
	return `http://${DEFAULT_DOCSKILL_HOST}:${resolveDocSkillPort(undefined)}`;
}
