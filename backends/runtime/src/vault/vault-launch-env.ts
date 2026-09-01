import { readVaultFile } from "./vault-store";
import {
	GithubVaultEntrySchema,
	McpVaultEntrySchema,
	formatMcpServiceId,
	type GithubVaultEntry,
	type McpVaultEntry,
} from "./vault-services";

export interface VaultLaunchEnv {
	env: Record<string, string>; // e.g. { GH_TOKEN: "..." }
	mcpEnvByServerId: Record<string, Record<string, string>>;
}

export async function collectVaultLaunchEnv(mcpServerIds?: readonly string[] | null): Promise<VaultLaunchEnv> {
	const env: Record<string, string> = {};
	const mcpEnvByServerId: Record<string, Record<string, string>> = {};

	const githubEntry = await readVaultFile<GithubVaultEntry>("github", GithubVaultEntrySchema);
	if (githubEntry?.accessToken) {
		env.GH_TOKEN = githubEntry.accessToken;
	}

	if (mcpServerIds && mcpServerIds.length > 0) {
		for (const rawId of mcpServerIds) {
			const serverId = rawId.trim();
			if (!serverId) {
				continue;
			}
			const mcpEntry = await readVaultFile<McpVaultEntry>(
				formatMcpServiceId(serverId),
				McpVaultEntrySchema,
			);
			if (mcpEntry?.env && Object.keys(mcpEntry.env).length > 0) {
				mcpEnvByServerId[serverId] = { ...mcpEntry.env };
			}
		}
	}

	return {
		env,
		mcpEnvByServerId,
	};
}
