import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { mockSiteStatus } = vi.hoisted(() => ({ mockSiteStatus: vi.fn() }));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		site: { status: { query: mockSiteStatus } },
	}),
}));

import { alignEmbedHostForBrowser } from "./site-embed-url";
import { SiteDocsView } from "./site-docs-view";

const ONLINE = {
	built: true,
	online: true,
	baseUrl: "http://127.0.0.1:3030",
	docsPath: "/docs/getting-started",
	buildCommand: "pnpm --filter pixtiel-site build",
};

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("SiteDocsView", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockSiteStatus.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
	});

	async function render(): Promise<void> {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<SiteDocsView workspaceId={null} onClose={() => {}} />
				</TooltipProvider>,
			);
			await flush();
		});
	}

	it("frames the docs entry point once the site is built and listening", async () => {
		mockSiteStatus.mockResolvedValue(ONLINE);
		await render();

		const frame = container.querySelector("iframe");
		expect(frame).not.toBeNull();
		expect(frame?.getAttribute("src")).toBe("http://localhost:3030/docs/getting-started");
		// No X-Frame-Options to satisfy; the site's own CSP scopes who may frame it.
		expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
	});

	it("explains how to build it instead of framing a dead port", async () => {
		mockSiteStatus.mockResolvedValue({ ...ONLINE, built: false, online: false });
		await render();

		expect(container.querySelector("iframe")).toBeNull();
		expect(container.textContent).toContain("has not been built yet");
		expect(container.textContent).toContain("pnpm --filter pixtiel-site build");
	});

	it("distinguishes built-but-not-listening from not built", async () => {
		mockSiteStatus.mockResolvedValue({ ...ONLINE, online: false });
		await render();

		expect(container.querySelector("iframe")).toBeNull();
		expect(container.textContent).toContain("Waiting for the documentation server");
		expect(container.textContent).toContain("--restart");
	});
});

describe("alignEmbedHostForBrowser", () => {
	it("swaps loopback for the host the page was loaded from", () => {
		// jsdom serves the page from localhost, so a reported 127.0.0.1 follows it.
		expect(alignEmbedHostForBrowser("http://127.0.0.1:3030")).toBe("http://localhost:3030");
	});

	it("leaves a non-loopback host and an empty value alone", () => {
		expect(alignEmbedHostForBrowser("http://192.168.1.5:3030")).toBe("http://192.168.1.5:3030");
		expect(alignEmbedHostForBrowser("")).toBe("");
	});
});
