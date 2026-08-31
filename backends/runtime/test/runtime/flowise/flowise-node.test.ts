import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MIN_STUDIO_NODE_MAJOR, resolveStudioNodeBinary } from "../../../src/flowise/flowise-node";

const ENV_KEY = "PIXELOFFICE_FLOWISE_NODE";
let previous: string | undefined;

afterEach(() => {
	if (previous === undefined) {
		delete process.env[ENV_KEY];
	} else {
		process.env[ENV_KEY] = previous;
	}
	previous = undefined;
});

function fakeNvmHome(versions: string[]): string {
	const home = mkdtempSync(join(tmpdir(), "flowise-nvm-"));
	for (const version of versions) {
		const binDir = join(home, ".nvm", "versions", "node", version, "bin");
		mkdirSync(binDir, { recursive: true });
		const path = join(binDir, "node");
		writeFileSync(path, "#!/bin/sh\n", "utf8");
		chmodSync(path, 0o755);
	}
	return home;
}

describe("resolveStudioNodeBinary", () => {
	it("prefers an explicit binary over everything else", () => {
		previous = process.env[ENV_KEY];
		process.env[ENV_KEY] = "/opt/node24/bin/node";
		expect(resolveStudioNodeBinary({ home: fakeNvmHome(["v24.20.0"]) })).toEqual({
			path: "/opt/node24/bin/node",
			satisfiesMinimum: true,
		});
	});

	it("uses the runtime's own node when it is new enough", () => {
		// minMajor 0 stands in for "this runtime already satisfies the studio".
		expect(resolveStudioNodeBinary({ minMajor: 0, home: fakeNvmHome(["v24.20.0"]) })).toEqual({
			path: process.execPath,
			satisfiesMinimum: true,
		});
	});

	it("picks the newest qualifying nvm install when the runtime's node is too old", () => {
		const home = fakeNvmHome(["v20.20.2", "v22.22.1", "v24.9.0", "v24.20.0", "v25.1.0"]);
		const resolved = resolveStudioNodeBinary({ minMajor: 99, home });
		// minMajor 99 excludes every install, so nothing qualifies — the guard below is what
		// proves the version sort, using the real minimum.
		expect(resolved.satisfiesMinimum).toBe(false);

		const withRealMinimum = resolveStudioNodeBinary({ minMajor: MIN_STUDIO_NODE_MAJOR, home });
		expect(withRealMinimum.satisfiesMinimum).toBe(true);
		expect(withRealMinimum.path).toBe(join(home, ".nvm", "versions", "node", "v25.1.0", "bin", "node"));
	});

	it("ignores nvm installs below the minimum", () => {
		const home = fakeNvmHome(["v20.20.2", "v22.22.1"]);
		expect(resolveStudioNodeBinary({ minMajor: MIN_STUDIO_NODE_MAJOR, home })).toEqual({
			path: process.execPath,
			satisfiesMinimum: false,
		});
	});

	it("falls back to the runtime's node when there is no nvm at all", () => {
		const home = mkdtempSync(join(tmpdir(), "flowise-nonvm-"));
		expect(resolveStudioNodeBinary({ minMajor: MIN_STUDIO_NODE_MAJOR, home })).toEqual({
			path: process.execPath,
			satisfiesMinimum: false,
		});
	});
});
