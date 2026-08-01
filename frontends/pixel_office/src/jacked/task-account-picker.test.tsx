import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	TaskAccountPicker,
	autoFallbackAccount,
	filterJackedAccountsForAgent,
	jackedProviderForAgent,
} from "@/jacked/task-account-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeJackedAccount } from "@/runtime/types";

function account(
	id: number,
	provider: RuntimeJackedAccount["provider"],
	email: string,
): RuntimeJackedAccount {
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
		pressure: 0.1,
		nextRefreshAt: null,
		canAutoSwap: provider === "claude",
		canTrackUsage: true,
		hasCcToken: provider === "claude",
		isActiveForProvider: id === 3,
		validationStatus: "valid",
		lastError: null,
	};
}

function renderPicker(
	props: {
		accounts: RuntimeJackedAccount[];
		agentId: "claude" | "cursor" | "codex";
		value?: number;
		activeAccountId?: number | null;
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
					value={props.value}
					activeAccountId={props.activeAccountId ?? null}
					agentId={props.agentId}
					onChange={() => {}}
				/>,
			),
		);
	});

	return container;
}

describe("jackedProviderForAgent", () => {
	it("maps Claude and Cursor agents to their provider fleets", () => {
		expect(jackedProviderForAgent("claude")).toBe("claude");
		expect(jackedProviderForAgent("cursor")).toBe("cursor");
		expect(jackedProviderForAgent("codex")).toBeNull();
	});
});

describe("filterJackedAccountsForAgent", () => {
	const fleet = [
		account(1, "claude", "claude@example.com"),
		account(2, "claude", "claude-spare@example.com"),
		account(3, "cursor", "cursor@example.com"),
	];

	it("returns only Cursor accounts for Cursor tasks", () => {
		const filtered = filterJackedAccountsForAgent(fleet, "cursor");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.provider).toBe("cursor");
	});

	it("returns only Claude accounts for Claude tasks", () => {
		const filtered = filterJackedAccountsForAgent(fleet, "claude");
		expect(filtered).toHaveLength(2);
		expect(filtered.every((entry) => entry.provider === "claude")).toBe(true);
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
});
