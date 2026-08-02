import { describe, expect, it } from "vitest";

import { detectHostEnvironment } from "../../src/core/host-environment.js";

describe("detectHostEnvironment", () => {
	it("maps darwin to mac and never reports WSL", () => {
		expect(detectHostEnvironment("darwin", {}, "")).toEqual({ platform: "mac", isWsl: false });
	});

	it("maps win32 to windows and never reports WSL", () => {
		expect(detectHostEnvironment("win32", {}, "")).toEqual({ platform: "windows", isWsl: false });
	});

	it("maps a plain Linux host to linux without WSL", () => {
		const procVersion = "Linux version 6.5.0-generic (gcc 13) #1 SMP";
		expect(detectHostEnvironment("linux", {}, procVersion)).toEqual({ platform: "linux", isWsl: false });
	});

	it("detects WSL from WSL_DISTRO_NAME even when /proc/version is unreadable", () => {
		expect(detectHostEnvironment("linux", { WSL_DISTRO_NAME: "Ubuntu" }, "")).toEqual({
			platform: "linux",
			isWsl: true,
		});
	});

	it("detects WSL from WSL_INTEROP", () => {
		expect(detectHostEnvironment("linux", { WSL_INTEROP: "/run/WSL/8_interop" }, "")).toEqual({
			platform: "linux",
			isWsl: true,
		});
	});

	it("detects WSL from /proc/version microsoft marker when env vars are stripped", () => {
		const procVersion = "Linux version 5.15.167.4-microsoft-standard-WSL2 (oe-user@oe-host)";
		expect(detectHostEnvironment("linux", {}, procVersion)).toEqual({ platform: "linux", isWsl: true });
	});

	it("does not report WSL for a mac host even if env vars leak in", () => {
		expect(detectHostEnvironment("darwin", { WSL_DISTRO_NAME: "Ubuntu" }, "")).toEqual({
			platform: "mac",
			isWsl: false,
		});
	});
});
