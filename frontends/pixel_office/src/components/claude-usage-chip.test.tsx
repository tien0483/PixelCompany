import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaudeUsageChip } from "@/components/claude-usage-chip";
import type { ClaudeUsageState } from "@/html/use-claude-usage";

let usage: ClaudeUsageState = { available: false, reason: "unreachable" };

vi.mock("@/html/use-claude-usage", () => ({
	useClaudeUsage: () => usage,
}));

describe("ClaudeUsageChip", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	async function render(testId?: string): Promise<HTMLElement> {
		await act(async () => {
			root.render(testId === undefined ? <ClaudeUsageChip /> : <ClaudeUsageChip testId={testId} />);
		});
		const chip = container.querySelector<HTMLElement>("[data-testid]");
		if (!chip) {
			throw new Error("chip did not render");
		}
		return chip;
	}

	it("renders both windows with their percentages when usage is available", async () => {
		usage = {
			available: true,
			fiveHourPercent: 42,
			sevenDayPercent: 7,
			fiveHourResetsAt: null,
			sevenDayResetsAt: null,
			fetchedAt: 1_700_000_000,
		};
		const chip = await render();
		expect(chip.dataset.testid).toBe("claude-usage-chip");
		expect(chip.textContent).toContain("5h");
		expect(chip.textContent).toContain("7d");
		expect(chip.textContent).toContain("42");
		expect(chip.textContent).toContain("7%");
	});

	// The chip must degrade to em-dashes rather than disappear: a missing meter reads
	// as "plenty of quota left", which is exactly wrong when the credential is dead.
	it("keeps the labelled box with em-dashes when credentials are missing", async () => {
		usage = { available: false, reason: "no-credentials" };
		const chip = await render("review-claude-usage-chip");
		expect(chip.dataset.testid).toBe("review-claude-usage-chip");
		expect(chip.textContent).toContain("5h");
		expect(chip.textContent).toContain("7d");
		expect(chip.textContent).toContain("—");
		expect(chip.getAttribute("title")).toContain("No Claude credentials found");
	});
});
