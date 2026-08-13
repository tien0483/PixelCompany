import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	TaskAccountPicker,
	type TaskSeatSelection,
	type TaskSubagentSeatSelection,
	agentIdForManagerProvider,
	applyTaskSeatSelection,
	applyTaskSubagentSeatSelection,
	autoFallbackAccount,
	filterManagerAccountsForAgent,
	managerProviderForAgent,
	resolveActiveManagerSeat,
	resolveCreateTaskDefaultAgentId,
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
