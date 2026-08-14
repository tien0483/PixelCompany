import { describe, expect, it, vi } from "vitest";

import { createManagerClient } from "./manager-client";

describe("createManagerClient", () => {
	it("returns null snapshot when health check fails", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		vi.stubGlobal("fetch", fetchMock);

		const warn = vi.fn();
		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:9",
			warn,
		});
		const snapshot = await client.fetchSnapshot();
		expect(snapshot).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		client.close();
		vi.unstubAllGlobals();
	});

	it("builds a snapshot from healthy responses", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const path = String(url);
			if (path.endsWith("/api/health")) {
				return { ok: true, json: async () => ({ status: "ok", db: true }) };
			}
			if (path.includes("/api/auth/accounts")) {
				return {
					ok: true,
					json: async () => [
						{
							id: 1,
							provider: "claude",
							email: "a@example.com",
							is_active: true,
							usage: { five_hour: 40, seven_day: 20 },
						},
					],
				};
			}
			if (path.includes("/api/menubar-summary")) {
				return { ok: true, json: async () => ({ active_account_id: 1 }) };
			}
			if (path.includes("/api/settings/swap-settings")) {
				return {
					ok: true,
					json: async () => ({ auto_swap_enabled: true, auto_swap_paused_until: null }),
				};
			}
			if (path.includes("/api/features")) {
				return { ok: true, json: async () => ({ agents: [], commands: [], hooks: [], knowledge: [] }) };
			}
			if (path.includes("/api/settings/swap-log")) {
				return { ok: true, json: async () => ({ swaps: [] }) };
			}
			if (path.includes("/api/analytics/lessons")) {
				return { ok: true, json: async () => ({ active: 3 }) };
			}
			if (path.includes("/api/version")) {
				return { ok: true, json: async () => ({ current: "1.0.0" }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const snapshot = await client.fetchSnapshot();
		expect(snapshot).not.toBeNull();
		expect(snapshot?.accounts).toHaveLength(1);
		expect(snapshot?.accounts[0]?.pressure).toBeCloseTo(0.4);
		expect(snapshot?.lessonsActive).toBe(3);
		client.close();
		vi.unstubAllGlobals();
	});

	it("prefers API can_auto_swap over the local capability table", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const path = String(url);
			if (path.endsWith("/api/health")) {
				return { ok: true, json: async () => ({ status: "ok", db: true }) };
			}
			if (path.includes("/api/auth/accounts")) {
				return {
					ok: true,
					json: async () => [
						{
							id: 9,
							provider: "claude",
							email: "c@example.com",
							is_active: true,
							can_auto_swap: false,
							can_track_usage: true,
							usage: { five_hour: 10, seven_day: 5 },
						},
					],
				};
			}
			if (path.includes("/api/menubar-summary")) {
				return { ok: true, json: async () => ({ active_account_id: 9 }) };
			}
			if (path.includes("/api/settings/swap-settings")) {
				return {
					ok: true,
					json: async () => ({ auto_swap_enabled: true, auto_swap_paused_until: null }),
				};
			}
			if (path.includes("/api/features")) {
				return { ok: true, json: async () => ({ agents: [], commands: [], hooks: [], knowledge: [] }) };
			}
			if (path.includes("/api/settings/swap-log")) {
				return { ok: true, json: async () => ({ swaps: [] }) };
			}
			if (path.includes("/api/analytics/lessons")) {
				return { ok: true, json: async () => ({ active: 0 }) };
			}
			if (path.includes("/api/version")) {
				return { ok: true, json: async () => ({ current: "1.0.0" }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const snapshot = await client.fetchSnapshot();
		expect(snapshot?.accounts[0]?.canAutoSwap).toBe(false);
		expect(snapshot?.stale).toBe(false);
		client.close();
		vi.unstubAllGlobals();
	});

	it("filters to Claude and Cursor managed accounts in the PixelOffice snapshot", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const path = String(url);
			if (path.endsWith("/api/health")) {
				return { ok: true, json: async () => ({ status: "ok", db: true }) };
			}
			if (path.includes("/api/auth/accounts") && !path.includes("refresh")) {
				return {
					ok: true,
					json: async () => [
						{
							id: 1,
							provider: "claude",
							email: "claude@example.com",
							is_active: true,
							usage: { five_hour: 40, seven_day: 20 },
						},
						{
							id: 2,
							provider: "codex",
							email: "codex@example.com",
							is_active: true,
							usage: { five_hour: 90, seven_day: 50 },
						},
						{
							id: 3,
							provider: "cursor",
							email: "cursor@example.com",
							is_active: false,
							is_active_for_provider: false,
							usage: { five_hour: 5, seven_day: 1 },
						},
					],
				};
			}
			if (path.includes("/api/menubar-summary")) {
				return { ok: true, json: async () => ({ active_account_id: 2 }) };
			}
			if (path.includes("/api/settings/swap-settings")) {
				return {
					ok: true,
					json: async () => ({ auto_swap_enabled: true, auto_swap_paused_until: null }),
				};
			}
			if (path.includes("/api/features")) {
				return { ok: true, json: async () => ({ agents: [], commands: [], hooks: [], knowledge: [] }) };
			}
			if (path.includes("/api/settings/swap-log")) {
				return { ok: true, json: async () => ({ swaps: [] }) };
			}
			if (path.includes("/api/analytics/lessons")) {
				return { ok: true, json: async () => ({ active: 0 }) };
			}
			if (path.includes("/api/version")) {
				return { ok: true, json: async () => ({ current: "1.0.0" }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const snapshot = await client.fetchSnapshot();
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/api/auth/accounts?include_inactive=true"),
			expect.anything(),
		);
		expect(snapshot?.accounts).toHaveLength(2);
		expect(snapshot?.accounts.map((account) => account.provider)).toEqual(["claude", "cursor"]);
		expect(snapshot?.accounts[1]?.isActive).toBe(false);
		expect(snapshot?.accounts[1]?.isActiveForProvider).toBe(false);
		expect(snapshot?.activeAccountId).toBeNull();
		expect(snapshot?.pressure).toBeCloseTo(0.4);
		client.close();
		vi.unstubAllGlobals();
	});

	it("starts Claude OAuth and returns flow metadata", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/add") && init?.method === "POST") {
				expect(path).toContain("provider=claude");
				return {
					ok: true,
					json: async () => ({
						flow_id: "flow-1",
						auth_url: "https://claude.com/cai/oauth/authorize?stub=1",
						mode: "browser",
					}),
				};
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const started = await client.startClaudeOAuth();
		expect(started.ok).toBe(true);
		expect(started.flowId).toBe("flow-1");
		expect(started.authUrl).toContain("claude.com");
		expect(started.mode).toBe("browser");
		client.close();
		vi.unstubAllGlobals();
	});

	it("uses account mutation when healthy", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/3/use") && init?.method === "POST") {
				return { ok: true, json: async () => ({ ok: true }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const result = await client.useAccount(3);
		expect(result.ok).toBe(true);
		client.close();
		vi.unstubAllGlobals();
	});

	it("reports a 200 body with valid:false as a failure", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/5/validate") && init?.method === "POST") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						valid: false,
						error: "Anthropic refused this account (permission_error): Your account has been suspended.",
						verdict: "bad",
					}),
				};
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.validateAccount(5);
		expect(result.ok).toBe(false);
		expect(result.verdict).toBe("bad");
		expect(result.error).toContain("suspended");
		client.close();
		vi.unstubAllGlobals();
	});

	it("surfaces an indeterminate verdict without claiming success", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/5/validate") && init?.method === "POST") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						valid: true,
						error: "Credential looks good; the live inference check was rate-limited — try again in a few minutes.",
						verdict: "indeterminate",
					}),
				};
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.validateAccount(5);
		expect(result.ok).toBe(true);
		expect(result.verdict).toBe("indeterminate");
		expect(result.error).toContain("rate-limited");
		client.close();
		vi.unstubAllGlobals();
	});

	it("maps a 504 VALIDATE_TIMEOUT envelope to indeterminate, not bad", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/5/validate") && init?.method === "POST") {
				return {
					ok: false,
					status: 504,
					json: async () => ({
						error: { message: "Validation timed out — server may be recovering a wedged refresh" },
					}),
				};
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.validateAccount(5);
		expect(result.ok).toBe(false);
		expect(result.verdict).toBe("indeterminate");
		expect(result.error).toContain("timed out");
		client.close();
		vi.unstubAllGlobals();
	});

	it("defaults verdict to good for a legacy body without verdict", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.includes("/api/auth/accounts/5/validate") && init?.method === "POST") {
				return { ok: true, status: 200, json: async () => ({ valid: true, error: null }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.validateAccount(5);
		expect(result.ok).toBe(true);
		expect(result.verdict).toBe("good");
		expect(result.error).toBeUndefined();
		client.close();
		vi.unstubAllGlobals();
	});

	it("reports transport failure on validate as not-reachable and indeterminate", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:9", warn: vi.fn() });
		const result = await client.validateAccount(5);
		expect(result.ok).toBe(false);
		expect(result.verdict).toBe("indeterminate");
		expect(result.error).toContain("not reachable");
		client.close();
		vi.unstubAllGlobals();
	});

	it("parses installations overview", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const path = String(url);
			if (path.includes("/api/installations/overview")) {
				return {
					ok: true,
					json: async () => ({
						global_install: {
							version: "0.88.0",
							agents: [{ name: "reviewer", display_name: "Reviewer", installed: true }],
							commands: [],
							hooks: [],
							knowledge: [],
							skills: [],
						},
						projects: [
							{
								repo_path: "/tmp/demo",
								repo_name: "demo",
								commands_run: 2,
								hook_executions: 1,
								last_activity: null,
								unique_sessions: 1,
								has_guardrails: false,
								has_lessons: true,
								lessons_count: 4,
							},
						],
						total_projects: 1,
					}),
				};
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({
			baseUrl: "http://127.0.0.1:8321",
			warn: vi.fn(),
		});
		const overview = await client.fetchInstallationsOverview();
		expect(overview?.version).toBe("0.88.0");
		expect(overview?.agents).toHaveLength(1);
		expect(overview?.projects[0]?.repoName).toBe("demo");
		expect(overview?.projects[0]?.lessonsCount).toBe(4);
		client.close();
		vi.unstubAllGlobals();
	});

	it("patches only the account fields the caller set", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ id: 4 }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.updateAccount({ accountId: 4, isActive: false });

		expect(result.ok).toBe(true);
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toBe("http://127.0.0.1:8321/api/auth/accounts/4");
		expect(call?.[1]?.method).toBe("PATCH");
		// display_name is keyed off presence in jacked, so it must stay out of the body.
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ is_active: false });
		client.close();
		vi.unstubAllGlobals();
	});

	it("patches donate_limit_percent when set", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ id: 4 }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.updateAccount({ accountId: 4, donateLimitPercent: 70 });

		expect(result.ok).toBe(true);
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
			donate_limit_percent: 70,
		});
		client.close();
		vi.unstubAllGlobals();
	});

	it("sends allow_locked alongside a donate cap when the caller overrides a lock", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ id: 4 }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.updateAccount({
			accountId: 4,
			donateLimitPercent: 100,
			allowLocked: true,
		});

		expect(result.ok).toBe(true);
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
			donate_limit_percent: 100,
			allow_locked: true,
		});
		client.close();
		vi.unstubAllGlobals();
	});

	it("parses usage resets, cache age, subscription, and donate limit", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const path = String(url);
			if (path.endsWith("/api/health")) {
				return { ok: true, json: async () => ({ status: "ok", db: true }) };
			}
			if (path.includes("/api/auth/accounts")) {
				return {
					ok: true,
					json: async () => [
						{
							id: 1,
							provider: "cursor",
							email: "c@example.com",
							is_active: true,
							subscription_type: "pro",
							usage_cached_at: 1_700_000_000,
							donate_limit_percent: 70,
							usage: {
								five_hour: 40,
								seven_day: 20,
								five_hour_resets_at: "2099-01-01T12:00:00Z",
								seven_day_resets_at: "2099-01-08T12:00:00Z",
							},
						},
					],
				};
			}
			if (path.includes("/api/menubar-summary")) {
				return { ok: true, json: async () => ({ active_account_id: 1 }) };
			}
			if (path.includes("/api/settings/swap-settings")) {
				return {
					ok: true,
					json: async () => ({ auto_swap_enabled: true, auto_swap_paused_until: null }),
				};
			}
			if (path.includes("/api/features")) {
				return { ok: true, json: async () => ({ agents: [], commands: [], hooks: [], knowledge: [] }) };
			}
			if (path.includes("/api/settings/swap-log")) {
				return { ok: true, json: async () => ({ swaps: [] }) };
			}
			if (path.includes("/api/analytics/lessons")) {
				return { ok: true, json: async () => ({ active: 0 }) };
			}
			if (path.includes("/api/version")) {
				return { ok: true, json: async () => ({ current: "1.0.0" }) };
			}
			return { ok: false, json: async () => ({}) };
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const snapshot = await client.fetchSnapshot();
		expect(snapshot?.accounts[0]).toMatchObject({
			fiveHourPercent: 40,
			sevenDayPercent: 20,
			fiveHourResetsAt: "2099-01-01T12:00:00Z",
			sevenDayResetsAt: "2099-01-08T12:00:00Z",
			usageCachedAt: 1_700_000_000,
			subscriptionType: "pro",
			donateLimitPercent: 70,
		});
		client.close();
		vi.unstubAllGlobals();
	});

	it("refuses an empty account patch without calling jacked", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.updateAccount({ accountId: 4 });

		expect(result).toEqual({ ok: false, error: "Nothing to update." });
		expect(fetchMock).not.toHaveBeenCalled();
		client.close();
		vi.unstubAllGlobals();
	});

	it("treats allow_locked on its own as an empty patch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.updateAccount({ accountId: 4, allowLocked: true });

		expect(result).toEqual({ ok: false, error: "Nothing to update." });
		expect(fetchMock).not.toHaveBeenCalled();
		client.close();
		vi.unstubAllGlobals();
	});

	it("submits the full order when reordering accounts", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => [],
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.reorderAccounts([3, 1, 2]);

		expect(result.ok).toBe(true);
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toBe("http://127.0.0.1:8321/api/auth/accounts/reorder");
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ order: [3, 1, 2] });
		client.close();
		vi.unstubAllGlobals();
	});

	it("flattens active sessions grouped by account id", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				sessions: {
					"1": [
						{ session_id: "abcd1234", repo_path: "/tmp/a", last_activity_at: "2026-07-30T10:00:00Z" },
						{ session_id: "efgh5678", repo_path: "/tmp/b", is_subagent: true, agent_type: "reviewer" },
					],
					"2": [{ session_id: "ijkl9012", repo_path: null }],
				},
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.fetchActiveSessions();

		expect(result?.sessions).toHaveLength(3);
		expect(result?.sessions.filter((session) => session.accountId === 1)).toHaveLength(2);
		expect(result?.sessions[1]).toMatchObject({ accountId: 1, isSubagent: true, agentType: "reviewer" });
		expect(result?.sessions[2]).toMatchObject({ accountId: 2, repoPath: null, isSubagent: false });
		client.close();
		vi.unstubAllGlobals();
	});

	it("returns the prepared per-account credential dir", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ account_id: 5, config_dir: "/home/u/.claude/accounts/5" }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.fetchAccountLaunchDir(5);

		expect(result).toEqual({ accountId: 5, configDir: "/home/u/.claude/accounts/5" });
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toBe("http://127.0.0.1:8321/api/auth/accounts/5/launch-dir");
		expect(call?.[1]?.method).toBe("POST");
		client.close();
		vi.unstubAllGlobals();
	});

	it("reports no launch dir when jacked refuses the account", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: false,
			json: async () => ({ error: { message: "Account not found" } }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		expect(await client.fetchAccountLaunchDir(42)).toBeNull();
		client.close();
		vi.unstubAllGlobals();
	});

	it("parses packs with per-pack install counts", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({
				npx_available: true,
				packs: [
					{
						name: "marketing",
						display_name: "Marketing Skills",
						description: "Curated marketing skills.",
						source: "coreyhaines31/marketingskills",
						homepage: "https://github.com/coreyhaines31/marketingskills",
						total: 20,
						installed_count: 7,
						enabled: true,
						default: true,
						explicit: false,
					},
				],
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.fetchPacks();

		expect(result?.npxAvailable).toBe(true);
		expect(result?.packs).toHaveLength(1);
		expect(result?.packs[0]).toMatchObject({
			name: "marketing",
			displayName: "Marketing Skills",
			skillCount: 20,
			installedCount: 7,
			enabled: true,
			isDefault: true,
			explicit: false,
		});
		client.close();
		vi.unstubAllGlobals();
	});

	it("reports npx as unavailable so the UI can explain a failing toggle", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ npx_available: false, packs: [] }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		expect(await client.fetchPacks()).toEqual({ packs: [], npxAvailable: false });
		client.close();
		vi.unstubAllGlobals();
	});

	it("toggles a pack by name", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ ok: true }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.setPackEnabled("marketing", false);

		expect(result.ok).toBe(true);
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toBe("http://127.0.0.1:8321/api/packs/marketing");
		expect(call?.[1]?.method).toBe("PUT");
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ enabled: false });
		client.close();
		vi.unstubAllGlobals();
	});

	it("re-auth reuses the OAuth flow shape and targets the account", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
			ok: true,
			json: async () => ({ flow_id: "flow-9", auth_url: "https://claude.ai/oauth", mode: "browser" }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.startAccountReauth(6, true);

		expect(result).toEqual({
			ok: true,
			flowId: "flow-9",
			authUrl: "https://claude.ai/oauth",
			mode: "browser",
		});
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8321/api/auth/accounts/6/reauth?remote=true");
		client.close();
		vi.unstubAllGlobals();
	});

	it("reimports a Cursor account from the IDE snapshot", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
			ok: true,
			json: async () => ({
				id: 9,
				provider: "cursor",
				email: "cursor@example.com",
				is_active_for_provider: false,
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const client = createManagerClient({ baseUrl: "http://127.0.0.1:8321", warn: vi.fn() });
		const result = await client.reimportCursorAccount(9);
		expect(result).toEqual({
			ok: true,
			accountId: 9,
			email: "cursor@example.com",
		});
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"http://127.0.0.1:8321/api/auth/accounts/9/reimport?provider=cursor",
		);
		expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
		client.close();
		vi.unstubAllGlobals();
	});
});
