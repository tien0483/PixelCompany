import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StackControlDialog } from "@/components/stack-control-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

const { mockNotifyError, mockShowAppToast } = vi.hoisted(() => ({
	mockNotifyError: vi.fn(),
	mockShowAppToast: vi.fn(),
}));

vi.mock("@/components/app-toaster", () => ({
	notifyError: mockNotifyError,
	showAppToast: mockShowAppToast,
}));

const mockFetch = vi.fn();

function stackState(overrides?: {
	flags?: Partial<Record<string, boolean>>;
	chain?: string[];
}) {
	return {
		sandboxDir: "/home/tester/agent-stack-sandbox",
		flags: {
			ENABLE_UA: true,
			ENABLE_RTK: true,
			ENABLE_CAVEMAN: true,
			ENABLE_HEADROOM: true,
			ENABLE_CCR: true,
			ENABLE_DEVTOOLS: false,
			...overrides?.flags,
		},
		route: {
			target: "http://127.0.0.1:8787",
			chain: overrides?.chain ?? ["headroom:8787", "ccr:3456", "upstream"],
		},
		daemons: {
			headroom: { port: 8787, up: true },
			ccr: { port: 3456, up: false },
			devtools: { port: 3001, up: false },
		},
		upstreamKeyConfigured: false,
		activationScopedFlags: ["ENABLE_UA", "ENABLE_RTK", "ENABLE_CAVEMAN", "ENABLE_DEVTOOLS"],
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response;
}

function flush() {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function query(selector: string): HTMLElement | null {
	return document.body.querySelector<HTMLElement>(selector);
}

describe("StackControlDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockFetch.mockReset().mockResolvedValue(jsonResponse(stackState()));
		vi.stubGlobal("fetch", mockFetch);
		mockNotifyError.mockReset();
		mockShowAppToast.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		vi.unstubAllGlobals();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	async function render(open: boolean) {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<StackControlDialog open={open} onOpenChange={() => {}} />
				</TooltipProvider>,
			);
		});
		await flush();
	}

	it("loads flags only once the dialog opens", async () => {
		await render(false);
		expect(mockFetch).not.toHaveBeenCalled();

		// The parent flips `open` externally via useStackControl (no Radix Trigger),
		// so the load has to come from a `useEffect` on the `open` prop.
		await render(true);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0]?.[0]).toContain("/api/flags");
		expect(query('[data-testid="stack-flag-ENABLE_CCR"]')).not.toBeNull();
		expect(document.body.textContent).toContain("headroom:8787 → ccr:3456 → upstream");
	});

	it("keeps Save disabled until a flag actually differs from the server state", async () => {
		await render(true);

		const save = query('[data-testid="stack-save-button"]') as HTMLButtonElement | null;
		expect(save?.disabled).toBe(true);

		await act(async () => {
			query('[data-testid="stack-flag-ENABLE_HEADROOM"]')?.click();
		});
		await flush();
		expect((query('[data-testid="stack-save-button"]') as HTMLButtonElement).disabled).toBe(false);

		// Toggling back to the server value clears the dirty state again.
		await act(async () => {
			query('[data-testid="stack-flag-ENABLE_HEADROOM"]')?.click();
		});
		await flush();
		expect((query('[data-testid="stack-save-button"]') as HTMLButtonElement).disabled).toBe(true);
	});

	it("PUTs the edited flags and adopts the chain the server reports back", async () => {
		await render(true);

		mockFetch.mockResolvedValueOnce(
			jsonResponse(stackState({ flags: { ENABLE_HEADROOM: false }, chain: ["ccr:3456", "upstream"] })),
		);

		await act(async () => {
			query('[data-testid="stack-flag-ENABLE_HEADROOM"]')?.click();
		});
		await flush();
		await act(async () => {
			query('[data-testid="stack-save-button"]')?.click();
		});
		await flush();

		const putCall = mockFetch.mock.calls.at(-1);
		expect(putCall?.[1]?.method).toBe("PUT");
		expect(JSON.parse(putCall?.[1]?.body as string)).toEqual({
			flags: expect.objectContaining({ ENABLE_HEADROOM: false, ENABLE_CCR: true }),
		});
		// The server response is authoritative, so the displayed chain must follow it
		// rather than the local draft.
		expect(document.body.textContent).toContain("ccr:3456 → upstream");
		expect(mockShowAppToast).toHaveBeenCalledWith({
			intent: "success",
			message: "Stack flags saved",
		});
	});

	it("explains an offline switchboard inline instead of only toasting", async () => {
		mockFetch.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
		await render(true);

		const error = query('[data-testid="stack-control-error"]');
		expect(error).not.toBeNull();
		expect(error?.textContent).toContain("activate-stack.sh");
		// No flag rows to edit when state failed to load.
		expect(query('[data-testid="stack-flag-ENABLE_CCR"]')).toBeNull();
	});
});
