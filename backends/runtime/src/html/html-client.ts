// Read-mostly client for the html-anything sidecar on 127.0.0.1:8322.
// Optional companion: every call resolves to null / failure instead of throwing
// when the port is closed.
import type {
	RuntimeHtmlPromptResponse,
	RuntimeHtmlTemplate,
	RuntimeHtmlTemplateExample,
} from "../core/api-contract";

const DEFAULT_BASE_URL = "http://127.0.0.1:8322";
const REQUEST_TIMEOUT_MS = 4000;
const LONG_REQUEST_TIMEOUT_MS = 30000;

/**
 * Why this is a discriminated union rather than `null`: an unreachable port, a
 * 30 s timeout and a `400 unknown template` are three different operator
 * problems, and collapsing them into one "sidecar unreachable or unknown
 * template" message sent people hunting for a dead port when the sidecar was up
 * and answering. Callers map each `kind` to its own status and text.
 */
export type HtmlPromptFailure =
	| { kind: "unreachable"; baseUrl: string; message: string }
	| { kind: "timeout"; baseUrl: string; timeoutMs: number }
	| { kind: "http"; status: number; body: string }
	| { kind: "malformed"; body: string };

export type HtmlPromptResult =
	| { ok: true; value: RuntimeHtmlPromptResponse }
	| { ok: false; failure: HtmlPromptFailure };

export interface HtmlClient {
	baseUrl: string;
	status: () => Promise<{ online: boolean }>;
	fetchTemplates: () => Promise<RuntimeHtmlTemplate[] | null>;
	fetchTemplateExample: (id: string) => Promise<RuntimeHtmlTemplateExample | null>;
	fetchPrompt: (input: {
		templateId: string;
		content: string;
		format?: string;
		editFromHtml?: string;
		editFromContent?: string;
		/** Unified diff of the requirement; selects the sidecar's diff-edit prompt. */
		editDiff?: string;
	}) => Promise<HtmlPromptResult>;
	proxyRequest: (
		method: string,
		htmlPath: string,
		body?: string | null,
		contentType?: string | null,
	) => Promise<{ status: number; body: string; contentType: string }>;
}

export interface CreateHtmlClientDependencies {
	baseUrl?: string;
	warn: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseExample(raw: unknown): RuntimeHtmlTemplate["example"] | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const id = readString(raw, "id");
	const name = readString(raw, "name");
	if (!id || !name) {
		return undefined;
	}
	const sourceRaw = raw.source;
	const source =
		isRecord(sourceRaw) && readString(sourceRaw, "url") && readString(sourceRaw, "label")
			? { url: readString(sourceRaw, "url")!, label: readString(sourceRaw, "label")! }
			: undefined;
	return {
		id,
		name,
		format: readString(raw, "format") ?? "markdown",
		tagline: readString(raw, "tagline") ?? "",
		desc: readString(raw, "desc") ?? "",
		hasHtml: raw.hasHtml === true,
		hasMd: raw.hasMd === true,
		...(source ? { source } : {}),
	};
}

function parseTemplate(raw: unknown): RuntimeHtmlTemplate | null {
	if (!isRecord(raw)) {
		return null;
	}
	const id = readString(raw, "id");
	if (!id) {
		return null;
	}
	const featured = readNumber(raw, "featured");
	const recommended = readNumber(raw, "recommended");
	const tags = Array.isArray(raw.tags)
		? raw.tags.filter((tag): tag is string => typeof tag === "string")
		: [];
	return {
		id,
		zhName: readString(raw, "zhName") ?? id,
		enName: readString(raw, "enName") ?? id,
		emoji: readString(raw, "emoji") ?? "",
		description: readString(raw, "description") ?? "",
		category: readString(raw, "category") ?? "other",
		scenario: readString(raw, "scenario") ?? "marketing",
		aspectHint: readString(raw, "aspectHint") ?? "",
		tags,
		...(raw.allowRead === true ? { allowRead: true } : {}),
		...(featured !== null ? { featured } : {}),
		...(recommended !== null ? { recommended } : {}),
		...(parseExample(raw.example) ? { example: parseExample(raw.example) } : {}),
	};
}

export function createHtmlClient(deps: CreateHtmlClientDependencies): HtmlClient {
	const baseUrl = (deps.baseUrl ?? process.env.PIXELOFFICE_HTML_URL ?? DEFAULT_BASE_URL).replace(
		/\/$/,
		"",
	);

	type RequestOptions = {
		body?: string | null;
		contentType?: string | null;
		timeoutMs?: number;
	};
	type RequestOutcome =
		| { ok: true; status: number; body: string; contentType: string }
		| { ok: false; timedOut: boolean; message: string };

	const requestDetailed = async (
		method: string,
		path: string,
		options?: RequestOptions,
	): Promise<RequestOutcome> => {
		const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const headers: Record<string, string> = {};
			if (options?.body != null && options.contentType) {
				headers["Content-Type"] = options.contentType;
			}
			const response = await fetch(`${baseUrl}${path}`, {
				method,
				headers,
				body: options?.body ?? undefined,
				signal: controller.signal,
			});
			const contentType = response.headers.get("content-type") ?? "application/json; charset=utf-8";
			const body = await response.text();
			return { ok: true, status: response.status, body, contentType };
		} catch (error) {
			const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
			const message = error instanceof Error ? error.message : String(error);
			const timedOut = controller.signal.aborted;
			if (!timedOut) {
				deps.warn(`HTML sidecar request ${method} ${path} failed: ${cause ?? message}`);
			}
			return { ok: false, timedOut, message: cause ?? message };
		} finally {
			clearTimeout(timeout);
		}
	};

	const request = async (
		method: string,
		path: string,
		options?: RequestOptions,
	): Promise<{ status: number; body: string; contentType: string } | null> => {
		const outcome = await requestDetailed(method, path, options);
		return outcome.ok
			? { status: outcome.status, body: outcome.body, contentType: outcome.contentType }
			: null;
	};

	return {
		baseUrl,
		status: async () => {
			const result = await request("GET", "/api/templates");
			return { online: result !== null && result.status >= 200 && result.status < 300 };
		},
		fetchTemplates: async () => {
			const result = await request("GET", "/api/templates");
			if (!result || result.status < 200 || result.status >= 300) {
				return null;
			}
			try {
				const parsed: unknown = JSON.parse(result.body);
				const list = isRecord(parsed) && Array.isArray(parsed.templates) ? parsed.templates : null;
				if (!list) {
					return null;
				}
				const templates: RuntimeHtmlTemplate[] = [];
				for (const item of list) {
					const template = parseTemplate(item);
					if (template) {
						templates.push(template);
					}
				}
				return templates;
			} catch {
				return null;
			}
		},
		fetchTemplateExample: async (id) => {
			const encoded = encodeURIComponent(id);
			const result = await request("GET", `/api/templates/${encoded}/example`);
			if (!result || result.status < 200 || result.status >= 300) {
				return null;
			}
			try {
				const parsed: unknown = JSON.parse(result.body);
				if (!isRecord(parsed)) {
					return null;
				}
				return {
					id,
					name: readString(parsed, "name"),
					templateId: readString(parsed, "templateId") ?? id,
					format: readString(parsed, "format") ?? "markdown",
					content: readString(parsed, "content") ?? "",
					html: readString(parsed, "html") ?? "",
				};
			} catch {
				return null;
			}
		},
		fetchPrompt: async (input) => {
			const outcome = await requestDetailed("POST", "/api/prompt", {
				body: JSON.stringify(input),
				contentType: "application/json",
				timeoutMs: LONG_REQUEST_TIMEOUT_MS,
			});
			if (!outcome.ok) {
				return {
					ok: false,
					failure: outcome.timedOut
						? { kind: "timeout", baseUrl, timeoutMs: LONG_REQUEST_TIMEOUT_MS }
						: { kind: "unreachable", baseUrl, message: outcome.message },
				};
			}
			if (outcome.status < 200 || outcome.status >= 300) {
				return {
					ok: false,
					failure: { kind: "http", status: outcome.status, body: outcome.body.slice(0, 500) },
				};
			}
			try {
				const parsed: unknown = JSON.parse(outcome.body);
				const prompt = isRecord(parsed) ? readString(parsed, "prompt") : null;
				const template = isRecord(parsed) ? parseTemplate(parsed.template) : null;
				if (!prompt || !template) {
					return {
						ok: false,
						failure: { kind: "malformed", body: outcome.body.slice(0, 500) },
					};
				}
				return { ok: true, value: { prompt, template } };
			} catch {
				return { ok: false, failure: { kind: "malformed", body: outcome.body.slice(0, 500) } };
			}
		},
		proxyRequest: async (method, htmlPath, body, contentType) => {
			const result = await request(method, htmlPath, {
				body,
				contentType,
				timeoutMs: LONG_REQUEST_TIMEOUT_MS,
			});
			if (!result) {
				return {
					status: 502,
					body: JSON.stringify({ error: "HTML sidecar unreachable" }),
					contentType: "application/json; charset=utf-8",
				};
			}
			return result;
		},
	};
}
