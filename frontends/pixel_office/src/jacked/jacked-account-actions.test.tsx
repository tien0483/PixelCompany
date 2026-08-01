import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JackedAccountActions } from "@/jacked/jacked-account-actions";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeJackedAccount } from "@/runtime/types";

function baseAccount(overrides: Partial<RuntimeJackedAccount> = {}): RuntimeJackedAccount {
	return {
		id: 1,
		provider: "claude",
		email: "claude@example.com",
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
		canAutoSwap: true,
		canTrackUsage: true,
		hasCcToken: true,
		isActiveForProvider: false,
		validationStatus: "valid",
		lastError: null,
		...overrides,
	};
}

function renderActions(account: RuntimeJackedAccount, handlers: Record<string, () => void>): HTMLElement {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);

	const wrap = (children: ReactNode) => <TooltipProvider>{children}</TooltipProvider>;

	act(() => {
		root.render(
			wrap(
				<JackedAccountActions
					account={account}
					online
					busy={false}
					isFirst={false}
					isLast={false}
					onReauth={handlers.onReauth ?? vi.fn()}
					onReauthRemote={handlers.onReauthRemote ?? vi.fn()}
					onAuthorizeCc={handlers.onAuthorizeCc ?? vi.fn()}
					onAuthorizeCcRemote={handlers.onAuthorizeCcRemote ?? vi.fn()}
					onReimport={handlers.onReimport}
					onValidate={handlers.onValidate ?? vi.fn()}
					onToggleEnabled={handlers.onToggleEnabled ?? vi.fn()}
					onDelete={handlers.onDelete ?? vi.fn()}
					onMoveUp={handlers.onMoveUp ?? vi.fn()}
					onMoveDown={handlers.onMoveDown ?? vi.fn()}
				/>,
			),
		);
	});

	return container;
}

describe("JackedAccountActions", () => {
	let roots: Root[] = [];

	beforeEach(() => {
		roots = [];
	});

	afterEach(() => {
		for (const root of roots) {
			act(() => {
				root.unmount();
			});
		}
		document.body.replaceChildren();
	});

	it("shows Claude OAuth controls for Claude accounts", () => {
		const container = renderActions(baseAccount(), {});
		expect(container.querySelector('[aria-label="Re-authenticate claude@example.com"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Authorize Claude Code tokens for claude@example.com"]')).not.toBeNull();
	});

	it("hides Claude OAuth controls and shows Re-import for Cursor accounts", () => {
		const onReimport = vi.fn();
		const container = renderActions(
			baseAccount({
				id: 3,
				provider: "cursor",
				email: "cursor@example.com",
				canAutoSwap: false,
				hasCcToken: false,
			}),
			{ onReimport },
		);
		expect(container.querySelector('[aria-label="Re-authenticate cursor@example.com"]')).toBeNull();
		expect(container.querySelector('[aria-label="Authorize Claude Code tokens for cursor@example.com"]')).toBeNull();
		const reimport = container.querySelector('[aria-label="Re-import cursor@example.com from Cursor IDE"]');
		expect(reimport).not.toBeNull();
		expect(reimport?.textContent).toContain("Re-import");
		act(() => {
			(reimport as HTMLButtonElement).click();
		});
		expect(onReimport).toHaveBeenCalledTimes(1);
	});

	it("labels Claude Re-auth / CC actions instead of icon-only controls", () => {
		const container = renderActions(baseAccount({ hasCcToken: false }), {});
		const reauth = container.querySelector('[aria-label="Re-authenticate claude@example.com"]');
		const cc = container.querySelector('[aria-label="Authorize Claude Code tokens for claude@example.com"]');
		expect(reauth?.textContent).toContain("Re-auth");
		expect(cc?.textContent).toContain("Add CC");
	});

	it("hides auto-swap priority controls when canAutoSwap is false", () => {
		const container = renderActions(
			baseAccount({
				provider: "cursor",
				email: "cursor@example.com",
				canAutoSwap: false,
			}),
			{ onReimport: vi.fn() },
		);
		expect(container.querySelector('[aria-label="Raise auto-swap priority of cursor@example.com"]')).toBeNull();
		expect(container.querySelector('[aria-label="Lower auto-swap priority of cursor@example.com"]')).toBeNull();
	});
});
