/**
 * Shared brand-env dual-read helper for scripts (PXT-5).
 * PIXTIEL_FOO wins; legacy PIXELOFFICE_FOO / PIXEL_OFFICE_FOO fall back.
 */
export function readBrandEnv(suffix) {
	return (
		process.env[`PIXTIEL_${suffix}`] ??
		process.env[`PIXELOFFICE_${suffix}`] ??
		process.env[`PIXEL_OFFICE_${suffix}`]
	);
}
