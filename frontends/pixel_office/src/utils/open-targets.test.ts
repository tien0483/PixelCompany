import { describe, expect, it } from "vitest";
import {
	buildOpenCommand,
	getOpenTargetOption,
	getOpenTargetOptions,
	normalizeOpenPlatformOverride,
	resolveEffectiveOpenPlatform,
} from "@/utils/open-targets";

describe("open-targets", () => {
	it("filters unsupported options on windows", () => {
		const windowsOptions = getOpenTargetOptions("windows");
		expect(windowsOptions.some((option) => option.id === "iterm2")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "xcode")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "vscode-insiders")).toBe(true);
		expect(windowsOptions.some((option) => option.id === "finder")).toBe(true);
	});

	it("places VS Code Insiders as second from bottom on macOS", () => {
		const macOptions = getOpenTargetOptions("mac");
		expect(macOptions.at(-2)?.id).toBe("vscode-insiders");
	});

	it("falls back to default option when selected target is unsupported on platform", () => {
		const selected = getOpenTargetOption("iterm2", "linux");
		expect(selected.id).toBe("vscode");
	});

	it("builds a macOS app-open command", () => {
		expect(buildOpenCommand("vscode", "/tmp/repo", "mac")).toBe("open -a 'Visual Studio Code' '/tmp/repo'");
	});

	it("builds a linux file manager command", () => {
		expect(buildOpenCommand("finder", "/tmp/my repo", "linux")).toBe("xdg-open '/tmp/my repo'");
	});

	it("builds a macOS VS Code Insiders command", () => {
		expect(buildOpenCommand("vscode-insiders", "/tmp/repo", "mac")).toBe(
			"open -a 'Visual Studio Code - Insiders' '/tmp/repo'",
		);
	});

	it("builds a windows file explorer command", () => {
		expect(buildOpenCommand("finder", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'explorer "C:\\Users\\dev\\my repo"',
		);
	});

	it("builds a windows VS Code Insiders command", () => {
		expect(buildOpenCommand("vscode-insiders", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'code-insiders "C:\\Users\\dev\\my repo"',
		);
	});

	it("falls back to default command when target is unsupported on windows", () => {
		expect(buildOpenCommand("iterm2", "C:\\Users\\dev\\my repo", "windows")).toBe('code "C:\\Users\\dev\\my repo"');
	});

	it("opens editors on WSL with the Linux remote CLI form", () => {
		expect(buildOpenCommand("vscode", "/home/dev/my repo", "wsl")).toBe("code '/home/dev/my repo'");
		expect(buildOpenCommand("cursor", "/home/dev/repo", "wsl")).toBe("cursor '/home/dev/repo'");
	});

	it("opens the WSL file manager via explorer.exe with a wslpath-translated path", () => {
		expect(buildOpenCommand("finder", "/home/dev/my repo", "wsl")).toBe(
			`explorer.exe "$(wslpath -w '/home/dev/my repo')"`,
		);
	});

	it("labels the WSL file manager as File Explorer", () => {
		expect(getOpenTargetOption("finder", "wsl").label).toBe("File Explorer");
	});

	it("normalizes unknown override values to auto", () => {
		expect(normalizeOpenPlatformOverride("wsl")).toBe("wsl");
		expect(normalizeOpenPlatformOverride("bogus")).toBe("auto");
		expect(normalizeOpenPlatformOverride(null)).toBe("auto");
		// "other" is a fallback platform, never a selectable override.
		expect(normalizeOpenPlatformOverride("other")).toBe("auto");
	});

	it("resolves effective platform with override precedence over host and navigator", () => {
		expect(resolveEffectiveOpenPlatform("windows", "wsl", "linux")).toBe("windows");
		expect(resolveEffectiveOpenPlatform("auto", "wsl", "windows")).toBe("wsl");
		expect(resolveEffectiveOpenPlatform("auto", null, "mac")).toBe("mac");
	});
});
