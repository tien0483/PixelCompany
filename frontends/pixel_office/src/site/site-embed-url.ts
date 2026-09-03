/** Loopback hostname the runtime advertises for its sidecars. */
export const EMBED_LOOPBACK_HOST = "127.0.0.1";

const LOOPBACK_HOSTNAMES = new Set([EMBED_LOOPBACK_HOST, "localhost", "::1", "[::1]"]);

/**
 * Rewrites a sidecar base URL so the browser can actually reach it.
 *
 * The runtime reports `http://127.0.0.1:<port>` because that is where it bound. When the
 * board is open from another host — the remote-access case — a literal `127.0.0.1` in an
 * iframe points at the *viewer's* machine, not the server's, so the frame silently fails.
 * Swapping in the hostname the page itself was loaded from keeps both cases working.
 *
 * Mirrors `alignFlowiseBaseUrlForBrowser`, which pins to loopback instead because the
 * studio's CORS allowlist is built from loopback origins.
 */
export function alignEmbedHostForBrowser(baseUrl: string): string {
	if (baseUrl.length === 0 || typeof window === "undefined") {
		return baseUrl;
	}
	try {
		const parsed = new URL(baseUrl);
		const pageHost = window.location.hostname;
		if (LOOPBACK_HOSTNAMES.has(parsed.hostname) && pageHost.length > 0) {
			parsed.hostname = pageHost;
		}
		return parsed.origin;
	} catch {
		return baseUrl;
	}
}
