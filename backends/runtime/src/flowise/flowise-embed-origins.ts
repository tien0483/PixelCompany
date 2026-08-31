/** CSP frame-ancestors rejects bracketed IPv6 literals like `[::1]` — only name/IPv4 hosts. */
function isValidFrameAncestorHost(host: string): boolean {
	const trimmed = host.trim();
	return trimmed.length > 0 && !trimmed.includes("[") && !trimmed.includes("]");
}

/** Comma-separated origins Flowise reads as CORS_ORIGINS and IFRAME_ORIGINS. */
export function resolvePixelOfficeEmbedOrigins(pixelOfficePort: string): string {
	// Solo advertises 127.0.0.1:3484; localhost is kept as a fallback for the same port.
	const hosts = new Set(["127.0.0.1", "localhost"]);
	const runtimeHost = process.env.KANBAN_RUNTIME_HOST?.trim();
	if (runtimeHost && isValidFrameAncestorHost(runtimeHost)) {
		hosts.add(runtimeHost);
	}
	return [...hosts]
		.flatMap((host) => [`http://${host}:${pixelOfficePort}`, `https://${host}:${pixelOfficePort}`])
		.join(",");
}
