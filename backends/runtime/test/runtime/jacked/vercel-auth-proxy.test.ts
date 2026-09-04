import { describe, expect, it } from "vitest";
import { normalizeFormUrl } from "../../../src/manager/vercel-auth-proxy";

const BASE = "https://pixel-office-usage.vercel.app";
const SESSION = "sess-abc";

describe("normalizeFormUrl", () => {
	it("passes through a form URL already on the configured base origin", () => {
		const url = `${BASE}/?sessionId=${SESSION}`;
		expect(normalizeFormUrl(url, BASE, SESSION)).toBe(url);
	});

	it("keeps a same-origin path and extra query untouched", () => {
		const url = `${BASE}/authorize?sessionId=${SESSION}&step=2`;
		expect(normalizeFormUrl(url, BASE, SESSION)).toBe(url);
	});

	// Pre-existing behaviour: some Vercel envs mint the link against localhost,
	// which is useless in an email.
	it("rewrites a localhost form URL onto the public base, preserving its sessionId", () => {
		const result = normalizeFormUrl("http://localhost:3000/?sessionId=from-broker", BASE, SESSION);
		expect(result).toBe(`${BASE}/?sessionId=from-broker`);
	});

	it("falls back to the known sessionId when the localhost URL carries none", () => {
		expect(normalizeFormUrl("http://127.0.0.1:3000/", BASE, SESSION)).toBe(
			`${BASE}/?sessionId=${SESSION}`,
		);
	});

	// This value is returned by the remote broker and then goes into an email the
	// *user* sends under their own name, so an off-origin link must never survive:
	// a compromised or typosquatted broker would otherwise choose what a colleague
	// is told to open.
	it("refuses an off-origin form URL and rebuilds it from the configured base", () => {
		for (const hostile of [
			"https://attacker.example/?sessionId=sess-abc",
			"https://pixel-office-usage.vercel.app.attacker.example/?sessionId=sess-abc",
			"http://pixel-office-usage.vercel.app/?sessionId=sess-abc", // scheme downgrade
			"https://pixel-office-usage.vercel.app:8443/?sessionId=sess-abc", // port swap
		]) {
			expect(normalizeFormUrl(hostile, BASE, SESSION)).toBe(`${BASE}/?sessionId=${SESSION}`);
		}
	});

	it("rebuilds using the broker's sessionId when the origin is wrong but the id is present", () => {
		expect(normalizeFormUrl("https://attacker.example/?sessionId=other-id", BASE, SESSION)).toBe(
			`${BASE}/?sessionId=other-id`,
		);
	});

	it("returns the input unchanged when either URL is unparseable", () => {
		expect(normalizeFormUrl("not a url", BASE, SESSION)).toBe("not a url");
		expect(normalizeFormUrl(`${BASE}/`, "not a url", SESSION)).toBe(`${BASE}/`);
	});
});
