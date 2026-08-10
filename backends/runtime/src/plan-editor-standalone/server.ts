// Slim HTTP server for the standalone Plan Editor package: tRPC (`planEditorRouter`)
// + the 4 REST/SSE html routes + static asset serving. No TLS, no WebSocket upgrade,
// no passcode gate, no Manager/Stack/OmniRoute — none of those are needed for a
// single-user localhost tool.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import type { HtmlClient } from "../html/html-client";
import { getWebUiDir, normalizeRequestPath, readAsset } from "../server/assets";
import { tryHandlePlanEditorHtmlRoute } from "./html-routes";
import { createPlanEditorContext, planEditorRouter } from "./router";

export interface PlanEditorServer {
	url: string;
	close: () => Promise<void>;
}

export interface StartPlanEditorServerDependencies {
	htmlClient: HtmlClient;
	host: string;
	port: number;
}

export async function startPlanEditorServer(deps: StartPlanEditorServerDependencies): Promise<PlanEditorServer> {
	const webUiDir = getWebUiDir();
	const serverCwd = process.cwd();

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: planEditorRouter,
		createContext: async () => createPlanEditorContext({ htmlClient: deps.htmlClient, serverCwd }),
	});

	const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
				return;
			}

			if (await tryHandlePlanEditorHtmlRoute(req, res, requestUrl, pathname, deps.htmlClient)) {
				return;
			}

			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

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
