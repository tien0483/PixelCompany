import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getKanbanRuntimePort } from "../../../src/core/runtime-endpoint";
import { resolveSiteFilePath, startSiteServer } from "../../../src/site/site-server";

let root: string | null = null;

function makeSite(): string {
	root = mkdtempSync(join(tmpdir(), "kanban-site-"));
	writeFileSync(join(root, "index.html"), "<html>home</html>", "utf8");
	mkdirSync(join(root, "docs", "getting-started"), { recursive: true });
	writeFileSync(join(root, "docs", "getting-started", "index.html"), "<html>docs</html>", "utf8");
	mkdirSync(join(root, "_astro"), { recursive: true });
	writeFileSync(join(root, "_astro", "app.css"), "body{}", "utf8");
	writeFileSync(join(root, "404.html"), "<html>missing</html>", "utf8");
	return root;
}

afterEach(() => {
	if (root) {
		rmSync(root, { recursive: true, force: true });
		root = null;
	}
});

describe("resolveSiteFilePath", () => {
	it("maps a directory path to its index.html, matching Astro's output shape", () => {
		const dist = makeSite();
		expect(resolveSiteFilePath(dist, "/docs/getting-started")).toBe(
			join(dist, "docs", "getting-started", "index.html"),
		);
		expect(resolveSiteFilePath(dist, "/")).toBe(join(dist, "index.html"));
		expect(resolveSiteFilePath(dist, "/docs/install/")).toBe(join(dist, "docs", "install", "index.html"));
	});

	it("serves files with an extension verbatim and ignores the query string", () => {
		const dist = makeSite();
		expect(resolveSiteFilePath(dist, "/_astro/app.css")).toBe(join(dist, "_astro", "app.css"));
		expect(resolveSiteFilePath(dist, "/_astro/app.css?v=2")).toBe(join(dist, "_astro", "app.css"));
	});

	it("keeps every request inside the dist root", () => {
		const dist = makeSite();
		// A leading slash makes `..` segments collapse against the root rather than escape,
		// so these stay contained (and simply 404) instead of reaching the filesystem.
		expect(resolveSiteFilePath(dist, "/../../etc/passwd")).toBe(
			join(dist, "etc", "passwd", "index.html"),
		);
		expect(resolveSiteFilePath(dist, "/docs/../../../secret.txt")).toBe(join(dist, "secret.txt"));
		// A relative path has nothing to collapse against, so the guard is what stops it.
		expect(resolveSiteFilePath(dist, "../secret.txt")).toBeNull();
		expect(resolveSiteFilePath(dist, "%2e%2e/%2e%2e/secret.txt")).toBeNull();
	});
});

describe("startSiteServer", () => {
	it("is a no-op when the site was not built", async () => {
		const messages: string[] = [];
		const server = await startSiteServer({ distDir: null, log: (m) => messages.push(m) });
		expect(server.port).toBeNull();
		expect(messages.join("\n")).toContain("pnpm --filter pixtiel-site build");
		await server.close();
	});

	it("serves pages and assets, frames only PIXTiel, and 404s through Astro's page", async () => {
		const dist = makeSite();
		// Port 0 lets the OS choose, so the test never collides with a running instance.
		const server = await startSiteServer({ distDir: dist, port: 0 });
		expect(server.port).not.toBeNull();
		const base = `http://127.0.0.1:${server.port}`;

		try {
			const docs = await fetch(`${base}/docs/getting-started`);
			expect(docs.status).toBe(200);
			expect(await docs.text()).toContain("docs");
			expect(docs.headers.get("content-type")).toContain("text/html");
			// Frameable by this PIXTiel and nothing else: no X-Frame-Options, scoped CSP.
			expect(docs.headers.get("x-frame-options")).toBeNull();
			expect(docs.headers.get("content-security-policy")).toContain("frame-ancestors");
			// Built from the runtime's bound port, so a board on a non-default port can still
			// frame it (regression: this used to read the env default and block the frame).
			expect(docs.headers.get("content-security-policy")).toContain(
				`http://127.0.0.1:${getKanbanRuntimePort()}`,
			);

			const asset = await fetch(`${base}/_astro/app.css`);
			expect(asset.status).toBe(200);
			expect(asset.headers.get("content-type")).toContain("text/css");

			const missing = await fetch(`${base}/nope`);
			expect(missing.status).toBe(404);
			expect(await missing.text()).toContain("missing");

			const posted = await fetch(`${base}/`, { method: "POST" });
			expect(posted.status).toBe(405);
		} finally {
			await server.close();
		}
	});
});
