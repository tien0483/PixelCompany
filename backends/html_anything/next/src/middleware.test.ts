import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "./middleware";

/*
 * Two gates share one middleware: the Host allowlist on `/api/*` (rebinding defence) and
 * `HTML_ANYTHING_API_ONLY`, which hides the HTML Anything editor UI when this service is
 * embedded as a pure backend. Neither may swallow the other.
 *
 * The request is a structural stub rather than a real `NextRequest`, matching
 * `lib/security/host-validation.test.ts`: `Host` is a forbidden header name, so a
 * `new NextRequest(url, { headers: { host } })` silently arrives with no Host at all and
 * every case would collapse into the default-deny 403.
 */

function request(path: string, host: string | null = "127.0.0.1:8422"): NextRequest {
  return {
    nextUrl: { pathname: path },
    headers: { get: (name: string) => (name.toLowerCase() === "host" ? host : null) },
  } as unknown as NextRequest;
}

/** `NextResponse.next()` is signalled by this internal header, not by a status. */
function isPassThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

afterEach(() => {
  delete process.env.HTML_ANYTHING_API_ONLY;
});

describe("middleware", () => {
  it("serves the page tree when the API-only flag is unset", () => {
    expect(isPassThrough(middleware(request("/")))).toBe(true);
    expect(isPassThrough(middleware(request("/favicon.ico")))).toBe(true);
  });

  it("404s the page tree when the API-only flag is set", () => {
    process.env.HTML_ANYTHING_API_ONLY = "1";

    expect(middleware(request("/")).status).toBe(404);
    expect(middleware(request("/favicon.ico")).status).toBe(404);
  });

  it("keeps serving the API under the API-only flag", () => {
    process.env.HTML_ANYTHING_API_ONLY = "1";

    expect(isPassThrough(middleware(request("/api/templates")))).toBe(true);
    expect(isPassThrough(middleware(request("/api/build-id")))).toBe(true);
  });

  it("still refuses a foreign Host on the API, flag or no flag", () => {
    expect(middleware(request("/api/templates", "evil.example.com")).status).toBe(403);

    process.env.HTML_ANYTHING_API_ONLY = "1";
    expect(middleware(request("/api/templates", "evil.example.com")).status).toBe(403);
  });

  it("does not let the API-only flag turn a foreign-Host API call into a 404", () => {
    process.env.HTML_ANYTHING_API_ONLY = "1";

    // A 404 here would hide the reason the call was refused.
    expect(middleware(request("/api/prompt", "attacker.test")).status).toBe(403);
  });
});
