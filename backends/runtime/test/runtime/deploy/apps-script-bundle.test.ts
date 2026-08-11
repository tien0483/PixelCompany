import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
	APPS_SCRIPT_CODE_FILE,
	APPS_SCRIPT_MANIFEST_FILE,
	APPS_SCRIPT_PAGE_FILE,
	buildAppsScriptManifest,
	CLASP_PROJECT_FILE,
	inlinePlanHtmlAssets,
	writeAppsScriptBundle,
} from "../../../src/deploy/apps-script-bundle";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("apps-script bundle", () => {
	let planDir = "";

	beforeEach(async () => {
		planDir = await mkdtemp(join(tmpdir(), "kanban-deploy-bundle-"));
		await mkdir(join(planDir, "roadmap.assets"), { recursive: true });
		await writeFile(join(planDir, "roadmap.assets", "hero.png"), PNG_BYTES);
	});

	it("inlines a relative asset reference as a data URI", async () => {
		const result = await inlinePlanHtmlAssets('<img src="roadmap.assets/hero.png" alt="hero">', planDir);

		expect(result.inlined).toEqual(["roadmap.assets/hero.png"]);
		expect(result.skipped).toEqual([]);
		expect(result.html).toContain(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
		expect(result.html).not.toContain("roadmap.assets/hero.png");
	});

	it("inlines a CSS url() reference and a single-quoted attribute", async () => {
		const result = await inlinePlanHtmlAssets(
			`<style>.hero{background:url(roadmap.assets/hero.png)}</style><img src='roadmap.assets/hero.png'>`,
			planDir,
		);

		expect(result.inlined).toEqual(["roadmap.assets/hero.png"]);
		expect(result.html).not.toContain("url(roadmap.assets");
		expect(result.html.match(/data:image\/png;base64,/g)).toHaveLength(2);
	});

	it("leaves remote, data and anchor references alone", async () => {
		const html = [
			'<img src="https://example.com/a.png">',
			'<img src="//cdn.example.com/b.png">',
			'<img src="data:image/gif;base64,AAAA">',
			'<a href="#section">jump</a>',
			'<a href="mailto:someone@example.com">mail</a>',
		].join("");

		const result = await inlinePlanHtmlAssets(html, planDir);

		expect(result.inlined).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.html).toBe(html);
	});

	it("reports a relative reference it cannot read instead of failing the page", async () => {
		const result = await inlinePlanHtmlAssets('<img src="roadmap.assets/missing.png">', planDir);

		expect(result.inlined).toEqual([]);
		expect(result.skipped).toEqual(["roadmap.assets/missing.png"]);
		expect(result.html).toContain("roadmap.assets/missing.png");
	});

	it("refuses a reference that escapes the plan directory", async () => {
		const result = await inlinePlanHtmlAssets('<img src="../outside.png">', planDir);

		expect(result.inlined).toEqual([]);
		expect(result.skipped).toEqual(["../outside.png"]);
	});

	it("writes the project files and records the script id for a re-deploy", async () => {
		const bundleDir = await mkdtemp(join(tmpdir(), "kanban-deploy-out-"));
		// `clasp create` seeds this; ours would collide with it.
		await writeFile(join(bundleDir, "Code.js"), "function doGet() {}", "utf8");

		const result = await writeAppsScriptBundle({
			dir: bundleDir,
			html: '<html><body><img src="roadmap.assets/hero.png"></body></html>',
			planDir,
			title: "Roadmap",
			timeZone: "Etc/UTC",
			scriptId: "script-123",
		});

		expect(result.inlined).toEqual(["roadmap.assets/hero.png"]);
		expect(await readFile(join(bundleDir, APPS_SCRIPT_PAGE_FILE), "utf8")).toContain("data:image/png;base64,");
		expect(await readFile(join(bundleDir, APPS_SCRIPT_CODE_FILE), "utf8")).toContain('.setTitle("Roadmap")');
		expect(JSON.parse(await readFile(join(bundleDir, CLASP_PROJECT_FILE), "utf8"))).toEqual({
			scriptId: "script-123",
		});
		await expect(readFile(join(bundleDir, "Code.js"), "utf8")).rejects.toThrow();
	});

	it("rejects a page that is too large once its assets are inlined", async () => {
		const bundleDir = await mkdtemp(join(tmpdir(), "kanban-deploy-out-"));
		await writeFile(join(planDir, "roadmap.assets", "huge.png"), Buffer.alloc(9 * 1024 * 1024, 1));

		await expect(
			writeAppsScriptBundle({
				dir: bundleDir,
				html: '<img src="roadmap.assets/huge.png">',
				planDir,
				title: "Roadmap",
				timeZone: "Etc/UTC",
			}),
		).rejects.toThrow(/over the 10 MB deploy limit/);
	});

	it("restricts the web app to the workspace domain", () => {
		const manifest: unknown = JSON.parse(buildAppsScriptManifest({ timeZone: "Etc/UTC" }));

		expect(manifest).toMatchObject({
			runtimeVersion: "V8",
			webapp: { executeAs: "USER_DEPLOYING", access: "DOMAIN" },
		});
	});

	it("names the manifest file as Apps Script expects", async () => {
		const bundleDir = await mkdtemp(join(tmpdir(), "kanban-deploy-out-"));
		await writeAppsScriptBundle({
			dir: bundleDir,
			html: "<html></html>",
			planDir,
			title: "Roadmap",
			timeZone: "Etc/UTC",
		});

		expect(APPS_SCRIPT_MANIFEST_FILE).toBe("appsscript.json");
		expect(await readFile(join(bundleDir, APPS_SCRIPT_MANIFEST_FILE), "utf8")).toContain('"timeZone": "Etc/UTC"');
	});
});
