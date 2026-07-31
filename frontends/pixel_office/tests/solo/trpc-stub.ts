import type { Page, Request } from "@playwright/test";

export interface TrpcCall {
	procedure: string;
	input: unknown;
}

export interface TrpcStub {
	/** Every stubbed call in the order the app made it. */
	calls: TrpcCall[];
	callsTo: (procedure: string) => TrpcCall[];
	waitForCall: (procedure: string, timeoutMs?: number) => Promise<TrpcCall>;
}

/**
 * Intercepts a chosen set of tRPC procedures and answers them from a handler map.
 *
 * The app talks to the runtime through `httpBatchLink`, so a request path is
 * `"/api/trpc/a.b,c.d"` with inputs keyed by position. Anything not listed in
 * `handlers` falls through to the real runtime, which keeps the board, git and
 * terminal traffic authentic while account mutations stay off real credentials.
 */
export async function stubTrpc(
	page: Page,
	handlers: Record<string, (input: unknown) => unknown>,
): Promise<TrpcStub> {
	const calls: TrpcCall[] = [];

	const readInputs = (request: Request, url: URL): Record<string, unknown> => {
		const raw = url.searchParams.get("input");
		if (raw) {
			try {
				return JSON.parse(raw) as Record<string, unknown>;
			} catch {
				return {};
			}
		}
		const body = request.postData();
		if (!body) {
			return {};
		}
		try {
			return JSON.parse(body) as Record<string, unknown>;
		} catch {
			return {};
		}
	};

	await page.route("**/api/trpc/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace(/^.*\/api\/trpc\//, "");
		const procedures = path.split(",").map((entry) => decodeURIComponent(entry));

		// Only take over batches we can answer completely; a mixed batch must reach
		// the runtime or the un-stubbed half would silently break.
		if (!procedures.every((procedure) => procedure in handlers)) {
			await route.fallback();
			return;
		}

		const inputs = readInputs(request, url);
		const results = procedures.map((procedure, index) => {
			const input = (inputs as Record<string, { json?: unknown } | unknown>)[String(index)];
			const unwrapped =
				input && typeof input === "object" && "json" in (input as Record<string, unknown>)
					? (input as { json: unknown }).json
					: input;
			calls.push({ procedure, input: unwrapped });
			return { result: { data: handlers[procedure]?.(unwrapped) ?? null } };
		});

		const isBatch = url.searchParams.get("batch") === "1";
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(isBatch ? results : results[0]),
		});
	});

	return {
		calls,
		callsTo: (procedure) => calls.filter((call) => call.procedure === procedure),
		waitForCall: async (procedure, timeoutMs = 10_000) => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				const match = calls.find((call) => call.procedure === procedure);
				if (match) {
					return match;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(`Timed out waiting for tRPC call to ${procedure}`);
		},
	};
}
