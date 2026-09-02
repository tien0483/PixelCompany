import { randomUUID } from "node:crypto";

const CODE_ASSIST_BASE =
	process.env.PIXELOFFICE_FLOWISE_LLM_GEMINI_UPSTREAM?.trim()?.replace(/\/$/, "") ||
	"https://cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_URL = `${CODE_ASSIST_BASE}/v1internal:loadCodeAssist`;
const FETCH_MODELS_URL = `${CODE_ASSIST_BASE}/v1internal:fetchAvailableModels`;
const GENERATE_CONTENT_URL = `${CODE_ASSIST_BASE}/v1internal:generateContent`;
const STREAM_GENERATE_CONTENT_URL = `${CODE_ASSIST_BASE}/v1internal:streamGenerateContent?alt=sse`;
const CODE_ASSIST_USER_AGENT = "antigravity/1.1.21 (linux; x86_64)";
const CODE_ASSIST_CLIENT_METADATA = JSON.stringify({
	ideType: "ANTIGRAVITY",
	platform: "LINUX",
	pluginType: "GEMINI",
});
const PROJECT_CACHE_TTL_MS = 60_000;

interface ProjectCacheEntry {
	projectId: string;
	expiresAtMs: number;
}

let projectCache: ProjectCacheEntry | null = null;

export interface GeminiCodegenForwardPlan {
	upstreamUrl: string;
	headers: Headers;
	body?: Buffer;
	streaming: boolean;
}

function codeAssistHeaders(accessToken: string, projectId: string | null): Headers {
	const headers = new Headers({
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": CODE_ASSIST_USER_AGENT,
		"Client-Metadata": CODE_ASSIST_CLIENT_METADATA,
	});
	if (projectId) {
		headers.set("x-goog-user-project", projectId);
	}
	return headers;
}

async function postCodeAssist<T>(
	url: string,
	accessToken: string,
	body: Record<string, unknown>,
	projectId: string | null,
): Promise<T | null> {
	const response = await fetch(url, {
		method: "POST",
		headers: codeAssistHeaders(accessToken, projectId),
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		return null;
	}
	const parsed: unknown = await response.json();
	return parsed && typeof parsed === "object" ? (parsed as T) : null;
}

/** Discovers the cloudaicompanionProject Antigravity OAuth is bound to. */
export async function resolveCodeAssistProject(accessToken: string, nowMs = Date.now()): Promise<string | null> {
	if (projectCache !== null && projectCache.expiresAtMs > nowMs) {
		return projectCache.projectId;
	}
	const payload = await postCodeAssist<Record<string, unknown>>(
		LOAD_CODE_ASSIST_URL,
		accessToken,
		{
			metadata: {
				ideType: "ANTIGRAVITY",
				ideName: "antigravity",
				ideVersion: "1.1.21",
				pluginType: "GEMINI",
			},
		},
		null,
	);
	const projectId =
		typeof payload?.cloudaicompanionProject === "string" ? payload.cloudaicompanionProject.trim() : "";
	if (!projectId) {
		return null;
	}
	projectCache = { projectId, expiresAtMs: nowMs + PROJECT_CACHE_TTL_MS };
	return projectId;
}

export function clearCodeAssistProjectCache(): void {
	projectCache = null;
}

function parseGeminiModelAction(upstreamPath: string): { modelId: string; streaming: boolean } | null {
	const match = /^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(upstreamPath);
	if (!match) {
		return null;
	}
	return {
		modelId: decodeURIComponent(match[1] ?? ""),
		streaming: match[2] === "streamGenerateContent",
	};
}

function buildCodegenEnvelope(
	projectId: string,
	modelId: string,
	requestBody: Record<string, unknown>,
): Record<string, unknown> {
	return {
		project: projectId,
		model: modelId,
		request: requestBody,
		requestType: "agent",
		userAgent: "antigravity",
		requestId: `pixeloffice-${randomUUID()}`,
	};
}

function modelsListFromFetchAvailable(payload: Record<string, unknown>): Record<string, unknown> {
	const models = Array.isArray(payload.models) ? payload.models : [];
	const mapped = models
		.map((entry) => {
			if (!entry || typeof entry !== "object") {
				return null;
			}
			const record = entry as Record<string, unknown>;
			const id = typeof record.id === "string" ? record.id : typeof record.name === "string" ? record.name : "";
			if (!id) {
				return null;
			}
			const displayName =
				typeof record.displayName === "string"
					? record.displayName
					: typeof record.label === "string"
						? record.label
						: id;
			return {
				name: `models/${id}`,
				displayName,
				supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
	return { models: mapped };
}

function unwrapCodegenResponse(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") {
		return payload;
	}
	const record = payload as Record<string, unknown>;
	if (record.response && typeof record.response === "object") {
		return record.response;
	}
	return payload;
}

/**
 * Maps a generativelanguage-style gemini proxy request onto Cloud Code Assist.
 * Returns null when the path should fall through to a plain upstream forward.
 */
export async function buildGeminiCodegenForwardPlan(
	method: string,
	upstreamPath: string,
	body: Buffer | undefined,
	accessToken: string,
): Promise<GeminiCodegenForwardPlan | null> {
	const upperMethod = method.toUpperCase();
	const projectId = await resolveCodeAssistProject(accessToken);
	if (projectId === null) {
		return null;
	}

	if (upperMethod === "GET" && (upstreamPath === "/v1beta/models" || upstreamPath === "/v1beta/models/")) {
		const payload = await postCodeAssist<Record<string, unknown>>(
			FETCH_MODELS_URL,
			accessToken,
			{ project: projectId },
			projectId,
		);
		if (payload === null) {
			return null;
		}
		return {
			upstreamUrl: "pixeloffice://models-list",
			headers: new Headers({ "Content-Type": "application/json" }),
			body: Buffer.from(JSON.stringify(modelsListFromFetchAvailable(payload)), "utf8"),
			streaming: false,
		};
	}

	const action = parseGeminiModelAction(upstreamPath);
	if (action === null || upperMethod !== "POST") {
		return null;
	}
	let requestBody: Record<string, unknown> = {};
	if (body !== undefined && body.length > 0) {
		try {
			const parsed: unknown = JSON.parse(body.toString("utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				requestBody = parsed as Record<string, unknown>;
			}
		} catch {
			return null;
		}
	}
	const envelope = buildCodegenEnvelope(projectId, action.modelId, requestBody);
	return {
		upstreamUrl: action.streaming ? STREAM_GENERATE_CONTENT_URL : GENERATE_CONTENT_URL,
		headers: codeAssistHeaders(accessToken, projectId),
		body: Buffer.from(JSON.stringify(envelope), "utf8"),
		streaming: action.streaming,
	};
}

export async function forwardGeminiCodegenResponse(
	res: import("node:http").ServerResponse,
	plan: GeminiCodegenForwardPlan,
	warn?: (message: string) => void,
): Promise<void> {
	if (plan.upstreamUrl === "pixeloffice://models-list") {
		res.writeHead(200, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		});
		res.end(plan.body ?? Buffer.from("{\"models\":[]}", "utf8"));
		return;
	}

	let upstream: Response;
	try {
		upstream = await fetch(plan.upstreamUrl, {
			method: "POST",
			headers: plan.headers,
			body: plan.body && plan.body.length > 0 ? new Uint8Array(plan.body) : undefined,
		});
	} catch (error) {
		warn?.(`Gemini Code Assist upstream failed: ${error instanceof Error ? error.message : String(error)}`);
		res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "Gemini Code Assist upstream unreachable." }));
		return;
	}

	if (!plan.streaming) {
		const rawText = await upstream.text();
		let responseBody = rawText;
		if (upstream.ok) {
			try {
				responseBody = JSON.stringify(unwrapCodegenResponse(JSON.parse(rawText)));
			} catch {
				responseBody = rawText;
			}
		}
		res.writeHead(upstream.status, {
			...(upstream.headers.get("content-type")
				? { "Content-Type": upstream.headers.get("content-type")! }
				: { "Content-Type": "application/json; charset=utf-8" }),
			"Cache-Control": "no-store",
		});
		res.end(responseBody);
		return;
	}

	res.writeHead(upstream.status, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-store",
	});
	if (!upstream.body) {
		res.end();
		return;
	}
	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) {
					continue;
				}
				const data = trimmed.slice(5).trim();
				if (!data || data === "[DONE]") {
					continue;
				}
				try {
					const unwrapped = unwrapCodegenResponse(JSON.parse(data));
					res.write(`data: ${JSON.stringify(unwrapped)}\n\n`);
				} catch {
					res.write(`${line}\n`);
				}
			}
		}
		res.end();
	} catch (error) {
		warn?.(`Gemini Code Assist stream failed: ${error instanceof Error ? error.message : String(error)}`);
		if (!res.headersSent) {
			res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
		}
		res.end();
	} finally {
		reader.releaseLock();
	}
}
