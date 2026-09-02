import { afterEach, describe, expect, it, vi } from "vitest";

import {
	bootstrapOptionalSidecars,
	closeSidecarBundle,
	createNoopSidecarBundle,
} from "../../src/sidecar-bootstrap";

const noopProcess = () => ({
	pid: null,
	spawned: false,
	ready: Promise.resolve(false),
	close: vi.fn(async () => {}),
});

const slowDelayMs = 2_000;
let slowStarterStarted = false;

vi.mock("../../src/omniroute/omniroute-process.js", () => ({
	startOmniRouteProcess: vi.fn(async () => {
		slowStarterStarted = true;
		await new Promise((resolve) => setTimeout(resolve, slowDelayMs));
		return noopProcess();
	}),
}));

vi.mock("../../src/html/html-process.js", () => ({
	startHtmlProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/stack/stack-process.js", () => ({
	startStackProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/stack/headroom-process.js", () => ({
	startHeadroomProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/stack/stack-extra-daemons.js", () => ({
	startCcrProcess: vi.fn(async () => noopProcess()),
	startDevToolsProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/doc-skill/doc-skill-process.js", () => ({
	startDocSkillProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/flowise/flowise-process.js", () => ({
	startFlowiseProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/openmaic/openmaic-process.js", () => ({
	startOpenmaicProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/orchestrator/orchestrator-process.js", () => ({
	startOrchestratorProcess: vi.fn(async () => noopProcess()),
}));

vi.mock("../../src/stack/link-stack-skills-runtime.js", () => ({
	linkStackSkillsAtStartup: vi.fn(async () => {}),
}));

describe("bootstrapOptionalSidecars", () => {
	afterEach(async () => {
		slowStarterStarted = false;
		vi.clearAllMocks();
	});

	it("returns before a slow starter finishes so listen-first callers are not blocked", async () => {
		const listenAt = Date.now();
		let bootstrapSettled = false;
		const bootstrapPromise = bootstrapOptionalSidecars({
			warn: () => {},
			log: () => {},
		}).then((bundle) => {
			bootstrapSettled = true;
			return bundle;
		});

		const deadline = Date.now() + 3_000;
		while (!slowStarterStarted && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(slowStarterStarted).toBe(true);
		expect(bootstrapSettled).toBe(false);
		expect(Date.now() - listenAt).toBeLessThan(slowDelayMs);

		const bundle = await bootstrapPromise;
		await closeSidecarBundle(bundle);
	});

	it("closeSidecarBundle is a no-op on the placeholder bundle", async () => {
		await expect(closeSidecarBundle(createNoopSidecarBundle())).resolves.toBeUndefined();
	});
});
