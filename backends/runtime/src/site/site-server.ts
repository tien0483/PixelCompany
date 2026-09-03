// Serves the built product website (`frontends/pixtiel-site/dist`) on its own loopback
// port so the Docs tab can frame it. In-process rather than a spawned sidecar: the site is
// static files, so a child process would buy nothing and cost a supervisor, a restart
// policy and a pidfile.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import { getKanbanRuntimePort } from "../core/runtime-endpoint";
import { resolvePixelOfficeEmbedOrigins } from "../flowise/flowise-embed-origins";
import {
	findSiteDistDir,
	resolveSiteBindHost,
	resolveSitePort,
	SITE_BUILD_COMMAND,
} from "./site-endpoint";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

export interface SiteServer {
	/** The port actually bound, or null when the site was not built so nothing started. */
	port: number | null;
	close: () => Promise<void>;
}

export interface StartSiteServerDependencies {
	log?: (message: string) => void;
	warn?: (message: string) => void;
	/** Overrides for tests. */
	port?: number;
	distDir?: string | null;
}

function noopSiteServer(): SiteServer {
	return { port: null, close: async () => {} };
}

/**
 * Maps a request path to a file inside `distDir`, or null when it escapes the root.
 *
 * Astro's static output is directory-per-page (`/docs/install/index.html`), so a path
 * without an extension resolves to `<path>/index.html`.
 */
export function resolveSiteFilePath(distDir: string, requestPath: string): string | null {
	const decoded = (() => {
		try {
			return decodeURIComponent(requestPath.split("?")[0] ?? "/");
		} catch {
			return null;
		}
	})();
	if (decoded === null) {
		return null;
	}
	const withoutQuery = decoded.replace(/[?#].*$/, "");
	const relative = normalize(withoutQuery).replace(/^([/\\])+/, "");
	const root = resolve(distDir);
	const candidate = resolve(join(root, relative));
	// Path traversal guard: the resolved file must stay under the dist root.
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		return null;
	}
	if (withoutQuery.endsWith("/") || extname(candidate) === "") {
		return join(candidate, "index.html");
	}
	return candidate;
}

async function readIfFile(path: string): Promise<Buffer | null> {
	try {
		const info = await stat(path);
		if (!info.isFile()) {
			return null;
		}
		return await readFile(path);
	} catch {
		return null;
	}
}

/**
 * Starts the static server, or returns a no-op when the site has not been built.
 *
 * Frameability is the whole point, so `X-Frame-Options` is deliberately *not* sent — the
 * boundary is instead a loopback bind plus a `frame-ancestors` CSP scoped to this
 * PIXTiel's own origins, the same list the Flowise and OpenMAIC embeds use.
 */
export async function startSiteServer(deps: StartSiteServerDependencies = {}): Promise<SiteServer> {
	const log = deps.log ?? (() => {});
	const warn = deps.warn ?? (() => {});
	const distDir = deps.distDir === undefined ? findSiteDistDir() : deps.distDir;
	if (distDir === null) {
		log(`Website not built — the Docs tab will explain how. Build it with: ${SITE_BUILD_COMMAND}`);
		return noopSiteServer();
	}

	const port = deps.port ?? resolveSitePort();
	const bindHost = resolveSiteBindHost();
	// The runtime's *bound* port, not the env default: `--port` is a CLI flag, so reading
	// PIXTIEL_PORT here would emit a frame-ancestors list for :3484 while the board runs
	// somewhere else — and the frame would be blocked with nothing in any log to say why.
	const runtimePort = String(getKanbanRuntimePort());
	const frameAncestors = resolvePixelOfficeEmbedOrigins(runtimePort).split(",").join(" ");

	const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const send = (status: number, body: Buffer | string, contentType: string): void => {
			res.writeHead(status, {
				"Content-Type": contentType,
				"Cache-Control": "no-cache",
				// Loopback + this list is the entire boundary. Never widen it to `*`.
				"Content-Security-Policy": `frame-ancestors 'self' ${frameAncestors}`,
			});
			res.end(body);
		};

		if (req.method !== "GET" && req.method !== "HEAD") {
			send(405, "Method Not Allowed", MIME_TYPES[".txt"] ?? "text/plain");
			return;
		}

		const filePath = resolveSiteFilePath(distDir, req.url ?? "/");
		if (filePath === null) {
			send(400, "Bad Request", MIME_TYPES[".txt"] ?? "text/plain");
			return;
		}

		const content = await readIfFile(filePath);
		if (content !== null) {
			send(200, content, MIME_TYPES[extname(filePath)] ?? "application/octet-stream");
			return;
		}

		// Astro emits a 404 page for static hosts; use it when present.
		const notFound = await readIfFile(join(distDir, "404.html"));
		if (notFound !== null) {
			send(404, notFound, MIME_TYPES[".html"] ?? "text/html");
			return;
		}
		send(404, "Not Found", MIME_TYPES[".txt"] ?? "text/plain");
	};

	const server: Server = createServer((req, res) => {
		void handler(req, res).catch((error: unknown) => {
			warn(`Website request failed: ${error instanceof Error ? error.message : String(error)}`);
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			}
			res.end("Internal Server Error");
		});
	});

	let boundPort = port;
	const started = await new Promise<boolean>((resolveStarted) => {
		server.once("error", (error: NodeJS.ErrnoException) => {
			// Someone already serves this port — adopt it rather than fail the launch, the
			// same posture every other sidecar here takes.
			if (error.code === "EADDRINUSE") {
				log(`Website already listening on ${bindHost}:${port} — using the running service.`);
			} else {
				warn(`Website server could not start: ${error.message}`);
			}
			resolveStarted(false);
		});
		server.listen(port, bindHost, () => {
			// `port: 0` asks the OS to choose; report what it actually bound.
			const address = server.address();
			if (address !== null && typeof address === "object") {
				boundPort = address.port;
			}
			log(`Website listening on ${bindHost}:${boundPort}.`);
			resolveStarted(true);
		});
	});

	if (!started) {
		return { port, close: async () => {} };
	}

	return {
		port: boundPort,
		close: async () => {
			await new Promise<void>((resolveClosed) => {
				server.close(() => resolveClosed());
			});
		},
	};
}
