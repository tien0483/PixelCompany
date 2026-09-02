import { z } from "zod";

export const GithubVaultEntrySchema = z.object({
	authKind: z.literal("pat"),
	accessToken: z.string().min(1),
	username: z.string().min(1),
	host: z.string().default("github.com"),
	updatedAt: z.string(),
});

export type GithubVaultEntry = z.infer<typeof GithubVaultEntrySchema>;

export const McpVaultEntrySchema = z.object({
	env: z.record(z.string(), z.string()),
	updatedAt: z.string(),
});

export type McpVaultEntry = z.infer<typeof McpVaultEntrySchema>;

export const MCP_SERVICE_PREFIX = "mcp:";

export function formatMcpServiceId(serverId: string): string {
	return `${MCP_SERVICE_PREFIX}${serverId}`;
}

export function isMcpServiceId(serviceId: string): boolean {
	return serviceId.startsWith(MCP_SERVICE_PREFIX);
}

export function parseMcpServerId(serviceId: string): string | null {
	if (!isMcpServiceId(serviceId)) {
		return null;
	}
	return serviceId.slice(MCP_SERVICE_PREFIX.length);
}

export interface RedactedGithubVaultEntry {
	kind: "github";
	username: string;
	host: string;
	last4: string;
	updatedAt: string;
}

export interface RedactedMcpVaultEntry {
	kind: "mcp";
	keys: string[];
	updatedAt: string;
}

export type RedactedVaultEntry = RedactedGithubVaultEntry | RedactedMcpVaultEntry;

export function redactGithubEntry(entry: GithubVaultEntry): RedactedGithubVaultEntry {
	const token = entry.accessToken;
	const last4 = token.length > 4 ? token.slice(-4) : token;
	return {
		kind: "github",
		username: entry.username,
		host: entry.host || "github.com",
		last4,
		updatedAt: entry.updatedAt,
	};
}

export function redactMcpEntry(entry: McpVaultEntry): RedactedMcpVaultEntry {
	return {
		kind: "mcp",
		keys: Object.keys(entry.env),
		updatedAt: entry.updatedAt,
	};
}

export function redactEntry(entry: GithubVaultEntry | McpVaultEntry): RedactedVaultEntry {
	if ("authKind" in entry && entry.authKind === "pat") {
		return redactGithubEntry(entry);
	}
	if ("env" in entry) {
		return redactMcpEntry(entry);
	}
	const candidate = entry as Record<string, unknown>;
	if (typeof candidate.accessToken === "string") {
		const token = candidate.accessToken;
		const last4 = token.length > 4 ? token.slice(-4) : token;
		return {
			kind: "github",
			username: typeof candidate.username === "string" ? candidate.username : "",
			host: typeof candidate.host === "string" ? candidate.host : "github.com",
			last4,
			updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
		};
	}
	if (candidate.env && typeof candidate.env === "object") {
		return {
			kind: "mcp",
			keys: Object.keys(candidate.env as Record<string, unknown>),
			updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
		};
	}
	throw new Error("Cannot redact unknown vault entry structure");
}
