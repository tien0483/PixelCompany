// Slim HTTP server for the standalone Review package: tRPC (`reviewStandaloneRouter`)
// + the three review SSE routes + static asset serving. No TLS, no WebSocket upgrade,
// no passcode gate, no Manager/Stack/OmniRoute — none of those are needed for a
// single-user localhost tool.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { getWebUiDir, normalizeRequestPath, readAsset } from "../server/assets";
import { type ReviewTrpcContext, reviewStandaloneRouter } from "./router";
import { tryHandleReviewStandaloneRoute } from "./routes";

export interface ReviewServer {
	url: string;
	close: () => Promise<void>;
}

export interface StartReviewServerDependencies {
	context: ReviewTrpcContext;
	host: string;
	port: number;
}

export async function startReviewServer(deps: StartReviewServerDependencies): Promise<ReviewServer> {
	const webUiDir = getWebUiDir();

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: reviewStandaloneRouter,
		createContext: async () => deps.context,
	});

	const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
				return;
			}

			if (await tryHandleReviewStandaloneRoute(req, res, pathname, deps.context)) {
				return;
			}

			// GitLab OAuth callback — browser is redirected here after authorization.
			if (req.method === "GET" && pathname === "/api/gitlab/oauth/callback") {
				const callbackUrl = new URL(req.url ?? "/", "http://localhost");
				const html = await deps.context.oauthSession.handleCallback(
					callbackUrl.searchParams.get("code"),
					callbackUrl.searchParams.get("state"),
					callbackUrl.searchParams.get("error"),
				);
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(html);
				return;
			}

			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

			// The build script installs the review page as this package's `index.html`,
			// so `readAsset`'s own `/` handling is already correct.
			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, { "Content-Type": asset.contentType, "Cache-Control": "no-store" });
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	};

	const server = createServer(requestHandler);

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(deps.port, deps.host, () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	const port = address && typeof address === "object" ? address.port : deps.port;

	return {
		url: `http://${deps.host}:${port}`,
		close: () =>
			new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
			}),
	};
}
