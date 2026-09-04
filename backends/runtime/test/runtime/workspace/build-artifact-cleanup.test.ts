import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanBuildArtifacts, scanBuildArtifacts } from "../../../src/workspace/build-artifact-cleanup";
import { createTempDir } from "../../utilities/temp-dir";

function write(path: string, contents = "x") {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, contents);
}

/** Every ignore rule is explicit, so the fixture can also hold a *tracked* `dist`. */
const GITIGNORE = [
	"/app/dist/",
	"/nested/.build/",
	"/site/.next/",
	"/pkg/.turbo/",
	"/loose/dist/",
	"/frontends/pixel_office/dist/",
	"",
].join("\n");

describe("build-artifact-cleanup", () => {
	let cleanup: (() => void) | null = null;
	let projectPath = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-build-artifacts-");
		cleanup = temp.cleanup;
		projectPath = join(temp.path, "project");
		mkdirSync(projectPath, { recursive: true });
		execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
		write(join(projectPath, ".gitignore"), GITIGNORE);

		// Plain, gitignored build output.
		write(join(projectPath, "app", "dist", "asset.js"), "0123456789");

		// Vendored and tracked: the guard that must refuse it is the ignore check.
		write(join(projectPath, "public", "semantic", "dist", "semantic.min.css"), "0123456789");

		// Next dist directory whose `distDir` was moved a level down.
		write(join(projectPath, "nested", ".build", "next", "BUILD_ID"), "abc");
		write(join(projectPath, "nested", ".build", "next", "server", "page.js"), "0123456789");
		write(join(projectPath, "nested", ".build", "next", "cache", "blob"), "0123456789");
		write(join(projectPath, "nested", ".build", "next", "dev", "blob"), "0123456789");

		// Next dist directory at the match itself.
		write(join(projectPath, "site", ".next", "BUILD_ID"), "abc");
		write(join(projectPath, "site", ".next", "static", "app.js"), "0123456789");
		write(join(projectPath, "site", ".next", "cache", "blob"), "0123456789");

		// Cache by name, wherever it appears.
		write(join(projectPath, "pkg", ".turbo", "turbo-build.log"), "0123456789");

		// A hand-written `cache` directory inside a non-Next `dist`.
		write(join(projectPath, "loose", "dist", "nodes", "cache", "Cache.js"), "0123456789");

		// Symlinked output, as `syncIgnoredPathsIntoWorktree` leaves in every worktree.
		mkdirSync(join(projectPath, "sym"), { recursive: true });
		symlinkSync(join(projectPath, "app", "dist"), join(projectPath, "sym", "dist"));

		// Marks the fixture as a PixelOffice checkout, which protects the served output.
		write(join(projectPath, "frontends", "pixel_office", "package.json"), "{}");
		write(join(projectPath, "frontends", "pixel_office", "dist", "index.html"), "0123456789");
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	function reasonFor(scan: Awaited<ReturnType<typeof scanBuildArtifacts>>, suffix: string): string | undefined {
		return scan.skipped.find((item) => item.path.endsWith(suffix))?.reason;
	}

	it("collects gitignored build output and refuses a tracked one", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		expect(scan.artifacts.some((artifact) => artifact.path === join(projectPath, "app", "dist"))).toBe(true);
		expect(reasonFor(scan, join("semantic", "dist"))).toBe("Tracked by git — not a build artifact.");
		expect(scan.artifacts.some((artifact) => artifact.path.includes(join("semantic", "dist")))).toBe(false);
	});

	it("never collects or follows a symlinked output directory", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		expect(scan.artifacts.some((artifact) => artifact.path === join(projectPath, "sym", "dist"))).toBe(false);
		expect(scan.skipped.some((item) => item.path === join(projectPath, "sym", "dist"))).toBe(false);
	});

	it("splits a Next dist directory into caches and output without double-counting", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		const nextRoot = join(projectPath, "nested", ".build");
		const cacheEntries = scan.artifacts.filter(
			(artifact) => artifact.tier === "build-cache" && artifact.path.startsWith(nextRoot),
		);
		const outputEntry = scan.artifacts.find((artifact) => artifact.path === nextRoot);

		expect(cacheEntries.map((entry) => entry.path).sort()).toEqual([
			join(nextRoot, "next", "cache"),
			join(nextRoot, "next", "dev"),
		]);
		expect(outputEntry?.tier).toBe("build-output");
		// `server/page.js` (10 bytes) and `BUILD_ID` (3), with both caches carved out.
		expect(outputEntry?.sizeBytes).toBe(13);
		expect(cacheEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0)).toBe(20);
	});

	it("does not treat a cache directory as a cache without a Next marker above it", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		const loose = join(projectPath, "loose", "dist");
		expect(scan.artifacts.some((artifact) => artifact.path === join(loose, "nodes", "cache"))).toBe(false);
		const outputEntry = scan.artifacts.find((artifact) => artifact.path === loose);
		expect(outputEntry?.tier).toBe("build-output");
		expect(outputEntry?.sizeBytes).toBe(10);
	});

	it("withholds a served output while still offering its cache", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		const servedDist = join(projectPath, "frontends", "pixel_office", "dist");
		expect(scan.artifacts.some((artifact) => artifact.path === servedDist)).toBe(false);
		expect(reasonFor(scan, join("pixel_office", "dist"))).toContain("pnpm build");
		// The Learning-tab shape: protection covers `.next`, never `.next/cache`.
		expect(
			scan.artifacts.some(
				(artifact) =>
					artifact.path === join(projectPath, "site", ".next", "cache") && artifact.tier === "build-cache",
			),
		).toBe(true);
	});

	it("classifies a cache-named directory as cache wherever it appears", async () => {
		const scan = await scanBuildArtifacts({ roots: [projectPath] });
		const turbo = scan.artifacts.find((artifact) => artifact.path === join(projectPath, "pkg", ".turbo"));
		expect(turbo?.tier).toBe("build-cache");
	});

	it("deletes nothing on a dry run", async () => {
		const result = await cleanBuildArtifacts({
			dryRun: true,
			disposeMode: "delete",
			includeBuildCaches: true,
			includeBuildOutputs: true,
			roots: [projectPath],
		});
		expect(result.cleaned.length).toBeGreaterThan(0);
		expect(existsSync(join(projectPath, "app", "dist", "asset.js"))).toBe(true);
		expect(existsSync(join(projectPath, "nested", ".build", "next", "cache", "blob"))).toBe(true);
	});

	it("removes caches without touching outputs when only caches are requested", async () => {
		const result = await cleanBuildArtifacts({
			dryRun: false,
			disposeMode: "delete",
			includeBuildCaches: true,
			roots: [projectPath],
		});
		expect(result.cleaned.every((item) => item.tier === "build-cache")).toBe(true);
		expect(existsSync(join(projectPath, "nested", ".build", "next", "cache"))).toBe(false);
		expect(existsSync(join(projectPath, "nested", ".build", "next", "dev"))).toBe(false);
		expect(existsSync(join(projectPath, "nested", ".build", "next", "server", "page.js"))).toBe(true);
		expect(existsSync(join(projectPath, "app", "dist", "asset.js"))).toBe(true);
	});

	it("reports what the guards withheld, so the dialog can show a Kept list", async () => {
		const result = await cleanBuildArtifacts({
			dryRun: true,
			disposeMode: "delete",
			includeBuildCaches: true,
			includeBuildOutputs: true,
			roots: [projectPath],
		});
		const reasons = result.skipped.map((item) => `${item.path}: ${item.reason}`);
		expect(reasons.some((reason) => reason.includes("semantic") && reason.includes("Tracked by git"))).toBe(true);
		expect(reasons.some((reason) => reason.includes("pixel_office") && reason.includes("pnpm build"))).toBe(true);
	});

	it("refuses a served output even when outputs are requested", async () => {
		await cleanBuildArtifacts({
			dryRun: false,
			disposeMode: "delete",
			includeBuildOutputs: true,
			roots: [projectPath],
		});
		expect(existsSync(join(projectPath, "frontends", "pixel_office", "dist", "index.html"))).toBe(true);
		expect(existsSync(join(projectPath, "public", "semantic", "dist", "semantic.min.css"))).toBe(true);
		expect(existsSync(join(projectPath, "app", "dist"))).toBe(false);
	});
});
