import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { pickBestClaudeAutoSeat } from "@runtime-manager-seat-ranking";
import {
	TaskAccountPicker,
	type TaskSeatSelection,
	type TaskSubagentSeatSelection,
	agentIdForManagerProvider,
	applyTaskSeatSelection,
	applyTaskSubagentSeatSelection,
	autoFallbackAccount,
	autoOptionLabel,
	autoTaskSeatAccount,
	filterManagerAccountsForAgent,
	managerProviderForAgent,
	resolveActiveManagerSeat,
	resolveCreateTaskDefaultAgentId,
	runningSeatHint,
	shouldClearManagerAccountPin,
} from "@/manager/task-account-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeAgentId, RuntimeClineApiSeat, RuntimeManagerAccount, RuntimeTaskClineSettings } from "@/runtime/types";

function account(
	id: number,
	provider: RuntimeManagerAccount["provider"],
	email: string,
): RuntimeManagerAccount {
	return {
		id,
		provider,
		email,
		displayName: null,
		organizationName: null,
		isActive: true,
		fiveHourPercent: 10,
		sevenDayPercent: 5,
		fiveHourResetsAt: null,
		sevenDayResetsAt: null,
		usageCachedAt: null,
		subscriptionType: null,
		donateLimitPercent: 100,
		donateLimitLocked: false,
		pressure: 0.1,
		nextRefreshAt: null,
		canAutoSwap: provider === "claude",
		canTrackUsage: true,
		hasCcToken: provider === "claude",
		ccNeedsAuth: false,
		isActiveForProvider: id === 3,
		validationStatus: "valid",
		lastError: null,
	};
}

function isoInHours(hours: number): string {
	return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function apiSeat(providerId: string, name: string, defaultModelId: string | null): RuntimeClineApiSeat {
	return {
		providerId,
		name,
		baseUrl: `https://${providerId}.example.com/v1`,
		defaultModelId,
		models: [],
		source: "builtin",
		apiKeyConfigured: true,
	};
}

function renderPicker(
	props: {
		accounts: RuntimeManagerAccount[];
		agentId: "claude" | "cursor" | "codex" | "cline";
		value?: number;
		activeAccountId?: number | null;
		apiSeats?: RuntimeClineApiSeat[];
		clineProviderId?: string | null;
		onChange?: (selection: TaskSeatSelection) => void;
		subagentSeatProviderId?: string | null;
		onSubagentSeatChange?: (selection: TaskSubagentSeatSelection) => void;
		subagentSeatAppliesOnRestart?: boolean;
		sessionAccountId?: number | null;
		sessionAccount?: RuntimeManagerAccount | null;
	},
): HTMLElement {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);
	const wrap = (children: ReactNode) => <TooltipProvider>{children}</TooltipProvider>;

	act(() => {
		root.render(
			wrap(
				<TaskAccountPicker
					accounts={props.accounts}
					apiSeats={props.apiSeats ?? []}
					value={props.value}
					clineProviderId={props.clineProviderId ?? null}
					activeAccountId={props.activeAccountId ?? null}
					agentId={props.agentId}
					onChange={props.onChange ?? (() => {})}
					sessionAccountId={props.sessionAccountId ?? null}
					sessionAccount={props.sessionAccount ?? null}
					subagentSeatProviderId={props.subagentSeatProviderId ?? null}
					subagentSeatAppliesOnRestart={props.subagentSeatAppliesOnRestart ?? false}
					{...(props.onSubagentSeatChange ? { onSubagentSeatChange: props.onSubagentSeatChange } : {})}
				/>,
			),
		);
	});

	return container;
}

describe("managerProviderForAgent", () => {
	it("maps Claude and Cursor agents to their provider fleets", () => {
		expect(managerProviderForAgent("claude")).toBe("claude");
		expect(managerProviderForAgent("cursor")).toBe("cursor");
		expect(managerProviderForAgent("codex")).toBeNull();
	});
});

describe("filterManagerAccountsForAgent", () => {
	const fleet = [
		account(1, "claude", "claude@example.com"),
		account(2, "claude", "claude-spare@example.com"),
		account(3, "cursor", "cursor@example.com"),
	];

	it("returns only Cursor accounts for Cursor tasks", () => {
		const filtered = filterManagerAccountsForAgent(fleet, "cursor");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.provider).toBe("cursor");
	});

	it("returns only Claude accounts for Claude tasks", () => {
		const filtered = filterManagerAccountsForAgent(fleet, "claude");
		expect(filtered).toHaveLength(2);
		expect(filtered.every((entry) => entry.provider === "claude")).toBe(true);
	});

	it("excludes disabled seats from Kanban when kanbanEligibleOnly is set", () => {
		const disabled = account(2, "claude", "off@example.com");
		disabled.isActive = false;
		const filtered = filterManagerAccountsForAgent([fleet[0]!, disabled], "claude", {
			kanbanEligibleOnly: true,
		});
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.email).toBe("claude@example.com");
	});
});

describe("shouldClearManagerAccountPin", () => {
	const claudeSeat = account(1, "claude", "claude@example.com");
	const cursorSeat = account(3, "cursor", "cursor@example.com");

	it("clears a pin whose seat is no longer eligible (disabled in Manager)", () => {
		const disabled = account(2, "claude", "off@example.com");
		disabled.isActive = false;
		expect(
			shouldClearManagerAccountPin({
				pinnedAccountId: 2,
				snapshotAccounts: [claudeSeat, disabled],
				eligibleAccounts: [claudeSeat],
			}),
		).toBe(true);
	});

	it("clears a pin that belongs to the other provider", () => {
		expect(
			shouldClearManagerAccountPin({
				pinnedAccountId: 3,
				snapshotAccounts: [claudeSeat, cursorSeat],
				eligibleAccounts: [claudeSeat],
			}),
		).toBe(true);
	});

	it("keeps a pin whose seat is still eligible", () => {
		expect(
			shouldClearManagerAccountPin({
				pinnedAccountId: 1,
				snapshotAccounts: [claudeSeat, cursorSeat],
				eligibleAccounts: [claudeSeat],
			}),
		).toBe(false);
	});

	// Manager offline or the snapshot still loading. Clearing here would wipe good
	// pins on every boot, which is worse than briefly honoring a stale one.
	it("keeps the pin when the snapshot is empty", () => {
		expect(
			shouldClearManagerAccountPin({
				pinnedAccountId: 1,
				snapshotAccounts: [],
				eligibleAccounts: [],
			}),
		).toBe(false);
	});

	it("does nothing for an unpinned task", () => {
		expect(
			shouldClearManagerAccountPin({
				pinnedAccountId: undefined,
				snapshotAccounts: [claudeSeat],
				eligibleAccounts: [claudeSeat],
			}),
		).toBe(false);
	});
});

describe("autoFallbackAccount", () => {
	it("prefers under-donate seats for Claude Auto", () => {
		const exhausted = account(1, "claude", "hot@example.com");
		exhausted.fiveHourPercent = 90;
		exhausted.donateLimitPercent = 70;
		exhausted.pressure = 0.9;
		const cool = account(2, "claude", "cool@example.com");
		cool.donateLimitPercent = 70;
		const picked = autoFallbackAccount([exhausted, cool], 1, "claude");
		expect(picked?.id).toBe(2);
	});

	it("still returns an exhausted seat when every seat is over the limit", () => {
		const only = account(1, "claude", "hot@example.com");
		only.fiveHourPercent = 95;
		only.donateLimitPercent = 70;
		expect(autoFallbackAccount([only], 1, "claude")?.id).toBe(1);
	});

	it("skips disabled seats for Auto pick", () => {
		const disabled = account(1, "claude", "off@example.com");
		disabled.isActive = false;
		const active = account(2, "claude", "on@example.com");
		expect(autoFallbackAccount([disabled, active], 1, "claude")?.id).toBe(2);
	});

	it("skips a seat that needs re-auth for Auto pick", () => {
		const broken = account(1, "claude", "broken@example.com");
		broken.ccNeedsAuth = true;
		const healthy = account(2, "claude", "healthy@example.com");
		expect(autoFallbackAccount([broken, healthy], 1, "claude")?.id).toBe(2);
	});

	it("falls back to a broken seat when every seat needs re-auth", () => {
		const broken = account(1, "claude", "broken@example.com");
		broken.validationStatus = "invalid";
		expect(autoFallbackAccount([broken], 1, "claude")?.id).toBe(1);
	});

	it("keeps preferring the active seat, which is what the Plans and Review tabs use", () => {
		const active = account(1, "claude", "active@example.com");
		active.fiveHourPercent = 80;
		const cooler = account(2, "claude", "cooler@example.com");
		cooler.fiveHourPercent = 5;
		expect(autoFallbackAccount([active, cooler], 1, "claude")?.id).toBe(1);
	});
});

describe("autoTaskSeatAccount", () => {
	it("ignores the active seat and picks the least-used one for Claude cards", () => {
		const active = account(1, "claude", "active@example.com");
		active.fiveHourPercent = 80;
		const cooler = account(2, "claude", "cooler@example.com");
		cooler.fiveHourPercent = 5;
		expect(autoTaskSeatAccount([active, cooler], 1, "claude")?.id).toBe(2);
	});

	it("skips disabled, re-auth-needed and over-cap seats before comparing usage", () => {
		const disabled = account(1, "claude", "off@example.com");
		disabled.isActive = false;
		disabled.fiveHourPercent = 1;
		const broken = account(2, "claude", "broken@example.com");
		broken.ccNeedsAuth = true;
		broken.fiveHourPercent = 2;
		const overCap = account(3, "claude", "hot@example.com");
		overCap.fiveHourPercent = 80;
		overCap.donateLimitPercent = 70;
		const usable = account(4, "claude", "usable@example.com");
		usable.fiveHourPercent = 60;
		expect(autoTaskSeatAccount([disabled, broken, overCap, usable], 1, "claude")?.id).toBe(4);
	});

	it("keeps Cursor and Antigravity on their provider-active seat", () => {
		// `account()` marks id 3 as the provider-active seat.
		const cool = account(1, "cursor", "cool@example.com");
		cool.fiveHourPercent = 1;
		const providerActive = account(3, "cursor", "active@example.com");
		providerActive.fiveHourPercent = 90;
		expect(autoTaskSeatAccount([cool, providerActive], null, "cursor")?.id).toBe(3);
	});

	it("returns null for an empty fleet", () => {
		expect(autoTaskSeatAccount([], 1, "claude")).toBeNull();
	});

	it("prefers the seat whose 7d window expires soonest over a less-used one", () => {
		const expiringSoon = account(1, "claude", "soon@example.com");
		expiringSoon.sevenDayPercent = 60;
		expiringSoon.sevenDayResetsAt = isoInHours(20);
		const plentyOfRunway = account(2, "claude", "later@example.com");
		plentyOfRunway.sevenDayPercent = 10;
		plentyOfRunway.sevenDayResetsAt = isoInHours(120);
		expect(autoTaskSeatAccount([plentyOfRunway, expiringSoon], null, "claude")?.id).toBe(1);
	});

	// The label defers to the same ranker the runtime's `pickLeastUsedClaudeAccountId`
	// calls (see its own suite), so this pins the frontend half of that contract: a
	// label naming one seat while the launch pins another is worse than no label.
	it("defers to the shared ranker rather than ordering seats itself", () => {
		const seats = [
			account(1, "claude", "a@example.com"),
			account(2, "claude", "b@example.com"),
			account(3, "claude", "c@example.com"),
		];
		seats[0]!.sevenDayPercent = 10;
		seats[0]!.sevenDayResetsAt = isoInHours(150);
		seats[1]!.sevenDayPercent = 55;
		seats[1]!.sevenDayResetsAt = isoInHours(30);
		seats[2]!.sevenDayPercent = 40;
		seats[2]!.sevenDayResetsAt = isoInHours(26);
		expect(autoTaskSeatAccount(seats, null, "claude")?.id).toBe(pickBestClaudeAutoSeat(seats)?.id);
	});
});

describe("runningSeatHint", () => {
	const live = account(4, "claude", "live@example.com");
	const predicted = account(2, "claude", "predicted@example.com");

	it("says nothing when no session is running", () => {
		expect(
			runningSeatHint({
				sessionAccountId: null,
				sessionAccount: null,
				pinnedAccountId: undefined,
				autoAccount: predicted,
			}),
		).toBeNull();
	});

	it("says nothing when the pinned seat is the one running", () => {
		expect(
			runningSeatHint({
				sessionAccountId: 4,
				sessionAccount: live,
				pinnedAccountId: 4,
				autoAccount: predicted,
			}),
		).toBeNull();
	});

	// The regression this exists for: Auto stores no seat, so the option label predicts one
	// from live usage and drifts away from the seat the launch actually pinned.
	it("names the live seat and the seat a restart would pick for an Auto card", () => {
		expect(
			runningSeatHint({
				sessionAccountId: 4,
				sessionAccount: live,
				pinnedAccountId: undefined,
				autoAccount: predicted,
			}),
		).toBe("Running on live@example.com · restarts on predicted@example.com");
	});

	it("drops the restart clause when Auto still predicts the running seat", () => {
		expect(
			runningSeatHint({
				sessionAccountId: 4,
				sessionAccount: live,
				pinnedAccountId: undefined,
				autoAccount: live,
			}),
		).toBe("Running on live@example.com");
	});

	it("names the live seat for a pinned card the session drifted away from", () => {
		expect(
			runningSeatHint({
				sessionAccountId: 4,
				sessionAccount: live,
				pinnedAccountId: 2,
				autoAccount: predicted,
			}),
		).toBe("Running on live@example.com");
	});

	it("falls back to the account id when the seat is gone from the snapshot", () => {
		expect(
			runningSeatHint({
				sessionAccountId: 9,
				sessionAccount: null,
				pinnedAccountId: undefined,
				autoAccount: predicted,
			}),
		).toBe("Running on account 9 · restarts on predicted@example.com");
	});
});

describe("autoOptionLabel", () => {
	it("explains a Claude Auto pick with the winning seat's 7d runway", () => {
		const seat = account(1, "claude", "seat@example.com");
		seat.sevenDayResetsAt = isoInHours(19);
		expect(autoOptionLabel(seat, "claude")).toBe("Auto · seat@example.com · 7d in 19h");
	});

	it("omits the runway when the seat has no usable 7d reset", () => {
		const seat = account(1, "claude", "seat@example.com");
		expect(autoOptionLabel(seat, "claude")).toBe("Auto · seat@example.com");
	});

	// Cursor/Antigravity Auto follows the provider-active seat, not this ranking.
	it("stays plain for Cursor", () => {
		const seat = account(3, "cursor", "cursor@example.com");
		seat.sevenDayResetsAt = isoInHours(19);
		expect(autoOptionLabel(seat, "cursor")).toBe("Auto · cursor@example.com");
	});
});

describe("resolveActiveManagerSeat", () => {
	it("skips disabled seats", () => {
		const disabled = account(1, "claude", "off@example.com");
		disabled.isActive = false;
		const enabled = account(2, "claude", "on@example.com");
		expect(resolveActiveManagerSeat([disabled, enabled], 1)?.id).toBe(2);
	});

	it("prefers the Claude activeAccountId when that seat is enabled", () => {
		const primary = account(1, "claude", "primary@example.com");
		const spare = account(2, "claude", "spare@example.com");
		const cursor = account(3, "cursor", "cursor@example.com");
		expect(resolveActiveManagerSeat([primary, spare, cursor], 2)?.id).toBe(2);
	});

	it("falls through to Cursor IDE-active when Claude active is missing or disabled", () => {
		const disabledClaude = account(1, "claude", "off@example.com");
		disabledClaude.isActive = false;
		const cursor = account(3, "cursor", "cursor@example.com");
		cursor.isActiveForProvider = true;
		const spareCursor = account(4, "cursor", "spare-cursor@example.com");
		spareCursor.isActiveForProvider = false;
		expect(resolveActiveManagerSeat([disabledClaude, spareCursor, cursor], 1)?.id).toBe(3);
	});

	it("returns the first enabled seat when no active markers match", () => {
		const a = account(10, "claude", "a@example.com");
		const b = account(11, "claude", "b@example.com");
		expect(resolveActiveManagerSeat([a, b], null)?.id).toBe(10);
	});

	it("returns null when every seat is disabled", () => {
		const disabled = account(1, "claude", "off@example.com");
		disabled.isActive = false;
		expect(resolveActiveManagerSeat([disabled], 1)).toBeNull();
	});
});

describe("agentIdForManagerProvider", () => {
	it("maps seat providers to launch agents", () => {
		expect(agentIdForManagerProvider("claude")).toBe("claude");
		expect(agentIdForManagerProvider("cursor")).toBe("cursor");
		expect(agentIdForManagerProvider(null)).toBeNull();
	});
});

describe("resolveCreateTaskDefaultAgentId", () => {
	it("uses the active seat provider when that agent is launchable", () => {
		const cursor = account(3, "cursor", "cursor@example.com");
		cursor.isActiveForProvider = true;
		expect(
			resolveCreateTaskDefaultAgentId({
				accounts: [cursor],
				activeAccountId: null,
				selectedAgentId: "claude",
			}),
		).toBe("cursor");
	});

	it("falls back to Settings selectedAgentId when Manager has no eligible seat", () => {
		expect(
			resolveCreateTaskDefaultAgentId({
				accounts: [],
				activeAccountId: null,
				selectedAgentId: "cursor",
			}),
		).toBe("cursor");
	});

	it("falls back to the first installed launchable agent when Settings is empty", () => {
		expect(
			resolveCreateTaskDefaultAgentId({
				accounts: [],
				activeAccountId: null,
				selectedAgentId: null,
				installedAgentIds: ["cursor", "claude"],
			}),
		).toBe("cursor");
	});

	it("skips a disabled activeAccountId and uses the next enabled seat", () => {
		const disabled = account(1, "claude", "off@example.com");
		disabled.isActive = false;
		const cursor = account(3, "cursor", "cursor@example.com");
		cursor.isActiveForProvider = true;
		expect(
			resolveCreateTaskDefaultAgentId({
				accounts: [disabled, cursor],
				activeAccountId: 1,
				selectedAgentId: "claude",
			}),
		).toBe("cursor");
	});
});

describe("TaskAccountPicker", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("labels the picker for Cursor tasks", () => {
		const container = renderPicker({
			accounts: [account(3, "cursor", "cursor@example.com")],
			agentId: "cursor",
			activeAccountId: 1,
		});
		const select = container.querySelector('[data-testid="task-account-picker"]');
		expect(select?.getAttribute("aria-label")).toBe("Cursor account for this task");
	});

	it("labels the picker for Claude tasks", () => {
		const container = renderPicker({
			accounts: [account(1, "claude", "claude@example.com")],
			agentId: "claude",
			activeAccountId: 1,
		});
		const select = container.querySelector('[data-testid="task-account-picker"]');
		expect(select?.getAttribute("aria-label")).toBe("Claude account for this task");
	});

	it("labels a seat that needs re-auth", () => {
		const broken = account(1, "claude", "broken@example.com");
		broken.ccNeedsAuth = true;
		const container = renderPicker({
			accounts: [broken],
			agentId: "claude",
			activeAccountId: 1,
		});
		const option = container.querySelector('option[value="manager:1"]');
		expect(option?.textContent).toContain("needs re-auth");
	});

	it("names the running seat under an Auto select that predicts a different one", () => {
		const hot = account(1, "claude", "hot@example.com");
		hot.fiveHourPercent = 90;
		const cool = account(2, "claude", "cool@example.com");
		cool.fiveHourPercent = 1;
		const container = renderPicker({
			accounts: [hot, cool],
			agentId: "claude",
			activeAccountId: 1,
			sessionAccountId: 1,
			sessionAccount: hot,
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-account-picker"]');
		expect(select?.value).toBe("auto");
		const hint = container.querySelector('[data-testid="task-session-account-hint"]');
		expect(hint?.textContent).toBe("Running on hot@example.com · restarts on cool@example.com");
	});

	it("shows no running-seat hint when the select already names that seat", () => {
		const seat = account(1, "claude", "claude@example.com");
		const container = renderPicker({
			accounts: [seat],
			agentId: "claude",
			activeAccountId: 1,
			value: 1,
			sessionAccountId: 1,
			sessionAccount: seat,
		});
		expect(container.querySelector('[data-testid="task-session-account-hint"]')).toBeNull();
	});

	it("lists API seats alongside Manager accounts", () => {
		const container = renderPicker({
			accounts: [account(1, "claude", "claude@example.com")],
			agentId: "claude",
			activeAccountId: 1,
			apiSeats: [apiSeat("openrouter", "OpenRouter", "cohere/north-mini-code:free")],
		});
		const option = container.querySelector('option[value="api:openrouter"]');
		expect(option?.textContent).toBe("OpenRouter · cohere/north-mini-code:free");
	});

	it("selects the API seat the card is pinned to", () => {
		const container = renderPicker({
			accounts: [],
			agentId: "cline",
			apiSeats: [apiSeat("openrouter", "OpenRouter", "cohere/north-mini-code:free")],
			clineProviderId: "openrouter",
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-account-picker"]');
		expect(select?.value).toBe("api:openrouter");
		expect(select?.getAttribute("aria-label")).toBe("API seat for this task");
	});

	it("emits an api selection carrying the seat's default model", () => {
		const selections: TaskSeatSelection[] = [];
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: [apiSeat("openrouter", "OpenRouter", "cohere/north-mini-code:free")],
			onChange: (selection) => selections.push(selection),
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-account-picker"]');
		act(() => {
			if (select) {
				select.value = "api:openrouter";
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		expect(selections).toEqual([
			{ kind: "api", providerId: "openrouter", modelId: "cohere/north-mini-code:free" },
		]);
	});
});

describe("applyTaskSeatSelection", () => {
	function collect(currentAgentId: RuntimeAgentId | null, selection: TaskSeatSelection) {
		const applied: {
			managerAccountId?: number | undefined;
			agentId?: RuntimeAgentId | undefined;
			clineSettings?: RuntimeTaskClineSettings | undefined;
		} = {};
		applyTaskSeatSelection(selection, {
			currentAgentId,
			onManagerAccountIdChange: (value) => {
				applied.managerAccountId = value;
			},
			onAgentIdChange: (value) => {
				applied.agentId = value;
			},
			onClineSettingsChange: (value) => {
				applied.clineSettings = value;
			},
		});
		return applied;
	}

	it("moves the card onto Cline and drops the Manager pin", () => {
		expect(
			collect("claude", { kind: "api", providerId: "openrouter", modelId: "cohere/north-mini-code:free" }),
		).toEqual({
			managerAccountId: undefined,
			agentId: "cline",
			clineSettings: { providerId: "openrouter", modelId: "cohere/north-mini-code:free" },
		});
	});

	it("omits modelId when the seat has no default model", () => {
		expect(collect("claude", { kind: "api", providerId: "openrouter", modelId: null }).clineSettings).toEqual({
			providerId: "openrouter",
		});
	});

	it("clears Cline settings when leaving an API seat for a Manager seat", () => {
		expect(collect("cline", { kind: "manager", accountId: 7, provider: "claude" })).toEqual({
			managerAccountId: 7,
			agentId: "claude",
			clineSettings: undefined,
		});
	});

	it("clears Cline settings when leaving an API seat for Auto", () => {
		expect(collect("cline", { kind: "auto" })).toEqual({
			managerAccountId: undefined,
			agentId: undefined,
			clineSettings: undefined,
		});
	});

	it("switches agent family when pinning a Cursor seat from a Claude task", () => {
		expect(collect("claude", { kind: "manager", accountId: 3, provider: "cursor" })).toEqual({
			managerAccountId: 3,
			agentId: "cursor",
		});
	});

	it("switches agent family to gemini when pinning an Antigravity seat from a Claude task", () => {
		expect(collect("claude", { kind: "manager", accountId: 5, provider: "antigravity" })).toEqual({
			managerAccountId: 5,
			agentId: "gemini",
		});
	});

	it("aligns agent to active Antigravity account when Auto is selected", () => {
		const accounts = [account(5, "antigravity", "user@example.com")];
		const applied: { managerAccountId?: number; agentId?: RuntimeAgentId } = {};
		applyTaskSeatSelection(
			{ kind: "auto" },
			{
				currentAgentId: "claude",
				onManagerAccountIdChange: (val) => {
					applied.managerAccountId = val;
				},
				onAgentIdChange: (val) => {
					applied.agentId = val;
				},
				accounts,
				activeAccountId: 5,
			},
		);
		expect(applied.managerAccountId).toBeUndefined();
		expect(applied.agentId).toBe("gemini");
	});
});

describe("subagent seat row", () => {
	const seats = [
		apiSeat("openrouter", "OpenRouter", "cohere/north-mini-code:free"),
		apiSeat("groq", "Groq", null),
	];

	it("offers the row for Claude tasks that have API seats to pick from", () => {
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			onSubagentSeatChange: () => {},
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-subagent-seat-picker"]');
		expect(select).not.toBeNull();
		expect([...(select?.options ?? [])].map((option) => option.value)).toEqual(["", "openrouter", "groq"]);
	});

	it("hides the row for agents that cannot route subagents", () => {
		for (const agentId of ["cursor", "codex", "cline"] as const) {
			const container = renderPicker({
				accounts: [],
				agentId,
				apiSeats: seats,
				onSubagentSeatChange: () => {},
			});
			expect(container.querySelector('[data-testid="task-subagent-seat-picker"]')).toBeNull();
		}
	});

	it("hides the row when the caller does not own launch settings", () => {
		const container = renderPicker({ accounts: [], agentId: "claude", apiSeats: seats });
		expect(container.querySelector('[data-testid="task-subagent-seat-picker"]')).toBeNull();
	});

	it("emits the seat's default model when one is pinned", () => {
		const selections: TaskSubagentSeatSelection[] = [];
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			onSubagentSeatChange: (selection) => selections.push(selection),
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-subagent-seat-picker"]');
		act(() => {
			if (select) {
				select.value = "openrouter";
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		expect(selections).toEqual([{ providerId: "openrouter", modelId: "cohere/north-mini-code:free" }]);
	});

	it("emits null when the pin is cleared back to Inherit", () => {
		const selections: TaskSubagentSeatSelection[] = [];
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			subagentSeatProviderId: "openrouter",
			onSubagentSeatChange: (selection) => selections.push(selection),
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-subagent-seat-picker"]');
		expect(select?.value).toBe("openrouter");
		act(() => {
			if (select) {
				select.value = "";
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		expect(selections).toEqual([null]);
	});

	it("falls back to Inherit when the pinned seat is gone", () => {
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			subagentSeatProviderId: "deleted-seat",
			onSubagentSeatChange: () => {},
		});
		const select = container.querySelector<HTMLSelectElement>('[data-testid="task-subagent-seat-picker"]');
		expect(select?.value).toBe("");
	});

	it("warns that the pin only lands on restart while a session runs on another seat", () => {
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			subagentSeatProviderId: "openrouter",
			onSubagentSeatChange: () => {},
			subagentSeatAppliesOnRestart: true,
		});
		expect(container.querySelector('[data-testid="task-subagent-seat-restart-hint"]')).not.toBeNull();
	});

	it("stays quiet when the running session already matches the pin", () => {
		const container = renderPicker({
			accounts: [],
			agentId: "claude",
			apiSeats: seats,
			subagentSeatProviderId: "openrouter",
			onSubagentSeatChange: () => {},
		});
		expect(container.querySelector('[data-testid="task-subagent-seat-restart-hint"]')).toBeNull();
	});
});

describe("applyTaskSubagentSeatSelection", () => {
	it("keeps unrelated launch settings intact", () => {
		expect(
			applyTaskSubagentSeatSelection({ providerId: "openrouter", modelId: "gpt-5" }, { agentIds: ["reviewer"] }),
		).toEqual({
			agentIds: ["reviewer"],
			subagentSeatProviderId: "openrouter",
			subagentSeatModelId: "gpt-5",
		});
	});

	it("omits the model when the seat has no default", () => {
		expect(applyTaskSubagentSeatSelection({ providerId: "groq", modelId: null }, undefined)).toEqual({
			subagentSeatProviderId: "groq",
		});
	});

	it("drops both fields when cleared, keeping the rest", () => {
		expect(
			applyTaskSubagentSeatSelection(null, {
				agentIds: ["reviewer"],
				subagentSeatProviderId: "openrouter",
				subagentSeatModelId: "gpt-5",
			}),
		).toEqual({ agentIds: ["reviewer"] });
	});

	it("returns undefined rather than an empty object when nothing else is set", () => {
		expect(
			applyTaskSubagentSeatSelection(null, { subagentSeatProviderId: "openrouter" }),
		).toBeUndefined();
	});
});
