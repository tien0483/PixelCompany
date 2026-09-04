import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedHost,
  isAllowedOrigin,
  isRequestCrossSiteWrite,
  isRequestHostAllowed,
  parseAllowedHosts,
  requireJsonContentType,
  stripPort,
} from "./host-validation";

describe("stripPort", () => {
  it("preserves bare hostnames", () => {
    expect(stripPort("localhost")).toBe("localhost");
    expect(stripPort("127.0.0.1")).toBe("127.0.0.1");
    expect(stripPort("daemon.mirage.local")).toBe("daemon.mirage.local");
  });
  it("strips ipv4 + dns ports", () => {
    expect(stripPort("localhost:3000")).toBe("localhost");
    expect(stripPort("127.0.0.1:3317")).toBe("127.0.0.1");
    expect(stripPort("example.com:443")).toBe("example.com");
  });
  it("strips ipv6 ports while keeping brackets", () => {
    expect(stripPort("[::1]:3000")).toBe("[::1]");
    expect(stripPort("[::1]")).toBe("[::1]");
  });
  it("lower-cases", () => {
    expect(stripPort("LOCALHOST:3000")).toBe("localhost");
  });
  it("does not strip when the trailing chunk is not a port", () => {
    expect(stripPort("not-a-port:abc")).toBe("not-a-port:abc");
  });
  // Documents the fact that bare unbracketed `::1` is mangled by the
  // `last-colon-trailing-digit` branch — the last colon is index 1 and the
  // trailing "1" is all digits, so the slice returns ":". A bare `::1` can
  // therefore never match anything in `LOOPBACK_HOSTS`, which is why only
  // the bracketed `[::1]` form is on the allowlist.
  it("mangles bare ::1 to ':' (only [::1] is a real Host header anyway)", () => {
    expect(stripPort("::1")).toBe(":");
  });
});

describe("parseAllowedHosts", () => {
  it("returns an empty set for undefined / empty input", () => {
    expect(parseAllowedHosts(undefined).size).toBe(0);
    expect(parseAllowedHosts("").size).toBe(0);
    expect(parseAllowedHosts("  ,  ,").size).toBe(0);
  });
  it("splits + trims + lowercases + strips ports", () => {
    const set = parseAllowedHosts("Daemon.mirage.local, HOST-A:8080 , host-b");
    expect([...set].sort()).toEqual(["daemon.mirage.local", "host-a", "host-b"]);
  });
});

describe("isAllowedHost (defaults — loopback only)", () => {
  it("accepts loopback variants on any port", () => {
    expect(isAllowedHost("127.0.0.1")).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHost("localhost")).toBe(true);
    expect(isAllowedHost("LOCALHOST:3317")).toBe(true);
    expect(isAllowedHost("[::1]:3000")).toBe(true);
    expect(isAllowedHost("[::1]")).toBe(true);
  });
  it("rejects attacker hosts", () => {
    expect(isAllowedHost("attacker.example")).toBe(false);
    expect(isAllowedHost("attacker.example:80")).toBe(false);
    expect(isAllowedHost("evil.local")).toBe(false);
    // Adjacent loopback aliases that aren't on the allowlist — keep strict
    expect(isAllowedHost("127.0.0.2")).toBe(false);
    expect(isAllowedHost("localhost.attacker.example")).toBe(false);
  });
  // `0.0.0.0` is reachable from a public page on pre-fix Chrome (< 128) — it
  // routes to the local machine on macOS/Linux without needing DNS rebinding.
  // Must be rejected so the gate covers that sibling vector.
  it("rejects 0.0.0.0 (sidesteps DNS rebinding via 0.0.0.0-day vector)", () => {
    expect(isAllowedHost("0.0.0.0")).toBe(false);
    expect(isAllowedHost("0.0.0.0:3317")).toBe(false);
  });
  // Bare unbracketed `::1` is mangled by stripPort (see stripPort tests) and
  // browsers / HTTP/2 always bracket IPv6 in the Host / :authority field.
  it("rejects bare unbracketed ::1 (only [::1] is a real Host header)", () => {
    expect(isAllowedHost("::1")).toBe(false);
  });
  it("rejects empty / missing host", () => {
    expect(isAllowedHost(null)).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost("")).toBe(false);
    expect(isAllowedHost("   ")).toBe(false);
  });
});

describe("isAllowedHost — operator-extended allowlist", () => {
  const extras = parseAllowedHosts("daemon.mirage.local,html.anything.lan");
  it("accepts entries from extraAllowed (case + port insensitive)", () => {
    expect(isAllowedHost("daemon.mirage.local", { extraAllowed: extras })).toBe(true);
    expect(isAllowedHost("DAEMON.MIRAGE.LOCAL:3000", { extraAllowed: extras })).toBe(true);
    expect(isAllowedHost("html.anything.lan:8080", { extraAllowed: extras })).toBe(true);
  });
  it("still rejects non-listed hosts even when extras are configured", () => {
    expect(isAllowedHost("attacker.example", { extraAllowed: extras })).toBe(false);
  });
  it("accepts a string[] form for extraAllowed (not just Set)", () => {
    expect(
      isAllowedHost("daemon.mirage.local", { extraAllowed: ["daemon.mirage.local"] }),
    ).toBe(true);
  });
});

describe("isAllowedHost — wildcard opt-out", () => {
  it("allowAny=true accepts any host (reverse-proxy mode)", () => {
    expect(isAllowedHost("attacker.example", { allowAny: true })).toBe(true);
    expect(isAllowedHost(null, { allowAny: true })).toBe(true);
    expect(isAllowedHost("", { allowAny: true })).toBe(true);
  });
});

describe("isRequestHostAllowed (env-driven wrapper)", () => {
  const make = (host: string | null) => ({
    headers: {
      get(name: string) {
        return name.toLowerCase() === "host" ? host : null;
      },
    },
  });

  afterEach(() => {
    delete process.env.HTML_ANYTHING_ALLOWED_HOSTS;
    delete process.env.HTML_ANYTHING_ALLOW_ANY_HOST;
  });

  it("respects defaults when no env is set", () => {
    expect(isRequestHostAllowed(make("127.0.0.1:3317"))).toBe(true);
    expect(isRequestHostAllowed(make("attacker.example"))).toBe(false);
    expect(isRequestHostAllowed(make(null))).toBe(false);
  });
  it("extends allowlist via HTML_ANYTHING_ALLOWED_HOSTS", () => {
    process.env.HTML_ANYTHING_ALLOWED_HOSTS = "html.anything.lan";
    expect(isRequestHostAllowed(make("html.anything.lan:3000"))).toBe(true);
    expect(isRequestHostAllowed(make("attacker.example"))).toBe(false);
  });
  it("opt-out wildcard via HTML_ANYTHING_ALLOW_ANY_HOST=1 accepts everything", () => {
    process.env.HTML_ANYTHING_ALLOW_ANY_HOST = "1";
    expect(isRequestHostAllowed(make("attacker.example"))).toBe(true);
  });
  it("envVar=0 stays strict (only '1' opts out)", () => {
    process.env.HTML_ANYTHING_ALLOW_ANY_HOST = "0";
    expect(isRequestHostAllowed(make("attacker.example"))).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts loopback origins on any port and scheme", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3317")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:3317")).toBe(true);
  });
  it("rejects foreign origins", () => {
    expect(isAllowedOrigin("https://attacker.example")).toBe(false);
    expect(isAllowedOrigin("http://attacker.example:3317")).toBe(false);
    // The classic prefix trick — must not match on substring.
    expect(isAllowedOrigin("http://127.0.0.1.attacker.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost.attacker.example")).toBe(false);
  });
  // The whole point of F2's sibling finding: an opaque origin is a sandboxed
  // iframe, which is the thing being contained, not a caller to trust.
  it("rejects the literal opaque origin 'null'", () => {
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("NULL")).toBe(false);
    expect(isAllowedOrigin(" null ")).toBe(false);
  });
  it("rejects empty / missing / unparseable origins", () => {
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("file://")).toBe(false);
  });
  it("ignores userinfo when reading the host", () => {
    expect(isAllowedOrigin("http://user:pw@127.0.0.1:3317")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1@attacker.example")).toBe(false);
  });
  it("honours the operator allowlist and the wildcard opt-out", () => {
    const extras = parseAllowedHosts("html.anything.lan");
    expect(isAllowedOrigin("http://html.anything.lan:3000", { extraAllowed: extras })).toBe(true);
    expect(isAllowedOrigin("https://attacker.example", { extraAllowed: extras })).toBe(false);
    expect(isAllowedOrigin("https://attacker.example", { allowAny: true })).toBe(true);
  });
});

describe("isRequestCrossSiteWrite", () => {
  const make = (method: string, origin: string | null) => ({
    method,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "origin" ? origin : null;
      },
    },
  });

  afterEach(() => {
    delete process.env.HTML_ANYTHING_ALLOWED_HOSTS;
    delete process.env.HTML_ANYTHING_ALLOW_ANY_HOST;
  });

  it("blocks a state-changing request from a foreign origin", () => {
    expect(isRequestCrossSiteWrite(make("POST", "https://attacker.example"))).toBe(true);
    expect(isRequestCrossSiteWrite(make("post", "https://attacker.example"))).toBe(true);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(isRequestCrossSiteWrite(make(method, "https://attacker.example"))).toBe(true);
    }
  });
  it("blocks a state-changing request from an opaque (sandboxed-iframe) origin", () => {
    expect(isRequestCrossSiteWrite(make("POST", "null"))).toBe(true);
  });
  it("allows the same-origin editor UI", () => {
    expect(isRequestCrossSiteWrite(make("POST", "http://127.0.0.1:3317"))).toBe(false);
    expect(isRequestCrossSiteWrite(make("POST", "http://localhost:3000"))).toBe(false);
  });
  // The runtime proxies every sidecar call server-side (`/api/html-proxy/*`), so
  // the legitimate path carries no Origin at all. Blocking that would take the
  // whole HTML tab down.
  it("allows a request with no Origin header (server-side / curl)", () => {
    expect(isRequestCrossSiteWrite(make("POST", null))).toBe(false);
  });
  it("leaves safe methods alone whatever the origin", () => {
    expect(isRequestCrossSiteWrite(make("GET", "https://attacker.example"))).toBe(false);
    expect(isRequestCrossSiteWrite(make("HEAD", "null"))).toBe(false);
    expect(isRequestCrossSiteWrite(make("OPTIONS", "https://attacker.example"))).toBe(false);
  });
  it("honours the env knobs", () => {
    process.env.HTML_ANYTHING_ALLOWED_HOSTS = "html.anything.lan";
    expect(isRequestCrossSiteWrite(make("POST", "http://html.anything.lan:3000"))).toBe(false);
    delete process.env.HTML_ANYTHING_ALLOWED_HOSTS;
    process.env.HTML_ANYTHING_ALLOW_ANY_HOST = "1";
    expect(isRequestCrossSiteWrite(make("POST", "https://attacker.example"))).toBe(false);
  });
});

describe("requireJsonContentType", () => {
  const make = (contentType: string | null) => ({
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
  });

  it("passes application/json, with or without parameters", () => {
    expect(requireJsonContentType(make("application/json"))).toBeNull();
    expect(requireJsonContentType(make("application/json; charset=utf-8"))).toBeNull();
    expect(requireJsonContentType(make("APPLICATION/JSON"))).toBeNull();
    expect(requireJsonContentType(make(" application/json "))).toBeNull();
  });
  // The three CORS-simple types are exactly what makes a preflight-free
  // cross-site POST possible, so each has to be refused.
  it("refuses the CORS-simple content types with 415", () => {
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      const response = requireJsonContentType(make(contentType));
      expect(response?.status).toBe(415);
    }
  });
  it("refuses a missing content type", () => {
    expect(requireJsonContentType(make(null))?.status).toBe(415);
    expect(requireJsonContentType(make(""))?.status).toBe(415);
  });
});
