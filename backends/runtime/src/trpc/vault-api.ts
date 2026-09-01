import type {
	RuntimeVaultDeleteRequest,
	RuntimeVaultDeleteResponse,
	RuntimeVaultEntrySummary,
	RuntimeVaultSetGithubPatRequest,
	RuntimeVaultSetGithubPatResponse,
	RuntimeVaultSetMcpSecretRequest,
	RuntimeVaultSetMcpSecretResponse,
	RuntimeVaultTestGithubRequest,
	RuntimeVaultTestGithubResponse,
} from "../core/api-contract";
import { clearGitlabCredential, readGitlabCredential } from "../gitlab/gitlab-credentials";
import {
	deleteVaultFile,
	formatMcpServiceId,
	GithubVaultEntrySchema,
	isMcpServiceId,
	listVaultServices,
	McpVaultEntrySchema,
	probeGhCliStatus,
	redactGithubEntry,
	redactMcpEntry,
	readVaultFile,
	validateGithubPat,
	writeVaultFile,
	type GithubVaultEntry,
	type McpVaultEntry,
} from "../vault";

export interface RuntimeVaultApi {
	list: () => Promise<RuntimeVaultEntrySummary[]>;
	setGithubPat: (input: RuntimeVaultSetGithubPatRequest) => Promise<RuntimeVaultSetGithubPatResponse>;
	setMcpSecret: (input: RuntimeVaultSetMcpSecretRequest) => Promise<RuntimeVaultSetMcpSecretResponse>;
	delete: (input: RuntimeVaultDeleteRequest) => Promise<RuntimeVaultDeleteResponse>;
	testGithub: (input?: RuntimeVaultTestGithubRequest) => Promise<RuntimeVaultTestGithubResponse>;
}

export interface CreateVaultApiDependencies {
	validatePat?: typeof validateGithubPat;
	probeGh?: typeof probeGhCliStatus;
}

export function createVaultApi(deps: CreateVaultApiDependencies = {}): RuntimeVaultApi {
	const validatePat = deps.validatePat ?? validateGithubPat;
	const probeGh = deps.probeGh ?? probeGhCliStatus;

	return {
		list: async (): Promise<RuntimeVaultEntrySummary[]> => {
			const summaries: RuntimeVaultEntrySummary[] = [];

			// 1. GitHub: stored PAT wins, else probe gh-cli
			const githubVault = await readVaultFile("github", GithubVaultEntrySchema);
			if (githubVault) {
				const redacted = redactGithubEntry(githubVault);
				summaries.push({
					service: "github",
					kind: "github",
					username: redacted.username,
					last4: redacted.last4,
					host: redacted.host,
					updatedAt: redacted.updatedAt,
					source: "vault",
				});
			} else {
				const ghStatus = await probeGh();
				summaries.push({
					service: "github",
					kind: "github",
					source: "gh-cli",
					status: ghStatus,
				});
			}

			// 2. GitLab: adapter over existing credential file
			try {
				const gitlabCred = await readGitlabCredential();
				if (gitlabCred) {
					summaries.push({
						service: "gitlab",
						kind: "gitlab",
						username: gitlabCred.username ?? undefined,
						host: gitlabCred.host ?? undefined,
						updatedAt: typeof gitlabCred.expiresAt === "number" ? new Date(gitlabCred.expiresAt).toISOString() : undefined,
						source: "gitlab-file",
					});
				}
			} catch {
				// Non-fatal if gitlab credential cannot be read
			}

			// 3. MCP secrets: list all `mcp:*` files in the vault
			const services = await listVaultServices();
			for (const serviceId of services) {
				if (isMcpServiceId(serviceId)) {
					const entry = await readVaultFile(serviceId, McpVaultEntrySchema);
					if (entry) {
						const redacted = redactMcpEntry(entry);
						summaries.push({
							service: serviceId,
							kind: "mcp",
							keys: redacted.keys,
							updatedAt: redacted.updatedAt,
							source: "vault",
						});
					}
				}
			}

			return summaries;
		},

		setGithubPat: async (input: RuntimeVaultSetGithubPatRequest): Promise<RuntimeVaultSetGithubPatResponse> => {
			const validation = await validatePat(input.token);
			if (!validation.ok) {
				return {
					ok: false,
					error: validation.reason,
				};
			}

			const entry: GithubVaultEntry = {
				authKind: "pat",
				accessToken: input.token.trim(),
				username: validation.login,
				host: input.host?.trim() || "github.com",
				updatedAt: new Date().toISOString(),
			};

			await writeVaultFile("github", entry);
			const redacted = redactGithubEntry(entry);

			return {
				ok: true,
				login: validation.login,
				entry: {
					service: "github",
					kind: "github",
					username: redacted.username,
					last4: redacted.last4,
					host: redacted.host,
					updatedAt: redacted.updatedAt,
					source: "vault",
				},
			};
		},

		setMcpSecret: async (input: RuntimeVaultSetMcpSecretRequest): Promise<RuntimeVaultSetMcpSecretResponse> => {
			const serviceId = formatMcpServiceId(input.serverId);
			const entry: McpVaultEntry = {
				env: input.env,
				updatedAt: new Date().toISOString(),
			};

			await writeVaultFile(serviceId, entry);
			const redacted = redactMcpEntry(entry);

			return {
				ok: true,
				entry: {
					service: serviceId,
					kind: "mcp",
					keys: redacted.keys,
					updatedAt: redacted.updatedAt,
					source: "vault",
				},
			};
		},

		delete: async (input: RuntimeVaultDeleteRequest): Promise<RuntimeVaultDeleteResponse> => {
			if (input.service === "gitlab" || input.service === "gitlab-file") {
				await clearGitlabCredential();
				return { ok: true };
			}
			const ok = await deleteVaultFile(input.service);
			return { ok };
		},

		testGithub: async (input?: RuntimeVaultTestGithubRequest): Promise<RuntimeVaultTestGithubResponse> => {
			if (input?.token) {
				const result = await validatePat(input.token);
				return result.ok
					? { ok: true, login: result.login }
					: { ok: false, reason: result.reason };
			}

			const githubVault = await readVaultFile("github", GithubVaultEntrySchema);
			if (!githubVault) {
				return {
					ok: false,
					reason: "No GitHub PAT configured in vault.",
				};
			}

			const result = await validatePat(githubVault.accessToken);
			return result.ok
				? { ok: true, login: result.login }
				: { ok: false, reason: result.reason };
		},
	};
}
