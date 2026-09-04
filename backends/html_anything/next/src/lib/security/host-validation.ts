/**
 * Host-header validator for the Next.js API surface.
 *
 * Threat model:
 *   `next dev` and `next start` bind to `0.0.0.0` by default. Even with the
 *   server bound to loopback only, a malicious page in the user's browser can
 *   DNS-rebind an attacker-controlled name (`attacker.example` → `127.0.0.1`)
 *   and POST to `/api/convert`, `/api/deploy`, `/api/deploy/config`, etc.
 *   `/api/convert` spawns the user's local coding-agent CLI with maximally
 *   permissive flags (`--permission-mode bypassPermissions`, `--yolo`,
 *   `--allow-all-tools`, `--dangerously-skip-permissions`, …), so a successful
 *   POST is unauthenticated RCE on the user's machine via the agent.
 *
 *   The browser blocks attackers from forging `Host` to `localhost`, so a
 *   Host-header allowlist is the canonical defense: the browser sends the
 *   hostname it dialed (`attacker.example`), we reject it, the request never
 *   reaches the handler. Origin / CSRF tokens are not sufficient on their own
 *   because no-cors POSTs with `Content-Type: text/plain` skip preflight.
 *
 * Defaults:
 *   loopback IPv4 + loopback IPv6 + literal `localhost`, on any port.
 *
 * Operator extensibility:
 *   `HTML_ANYTHING_ALLOWED_HOSTS` — comma-separated list (e.g. for a LAN-host
 *      setup or a `.local` mDNS name). Each entry matches case-insensitively
 *      against the bare hostname; port is ignored.
 *   `HTML_ANYTHING_ALLOW_ANY_HOST=1` — opt-out wildcard, intended for behind
 *      a trusted reverse proxy that terminates Host itself. Loudly insecure;
 *      not the default.
 */

// `0.0.0.0` is intentionally NOT on the allowlist: on macOS/Linux it routes
// to the local machine, and pre-fix Chrome (< 128) lets a public page fetch
// `http://0.0.0.0:<port>` directly — that path bypasses DNS rebinding entirely
// and would still reach the API if we accepted `Host: 0.0.0.0`. The Playwright
// suite dials `127.0.0.1` (see `e2e/playwright.config.ts`), so removing it
// breaks no test.
//
// `::1` (bare) is also omitted: `stripPort("::1")` produces `":"` (the
// last-colon-trailing-digit branch), so a bare unbracketed `::1` can never
// match anyway. Browsers and HTTP/2 `:authority` always bracket IPv6 literals,
// so a bare `::1` doesn't appear in real Host headers either.
const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

/**
 * Strip the optional port from a Host header value. Handles both IPv4 / DNS
 * (`example.com:3000`) and IPv6 (`[::1]:3000`).
 */
export function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  // IPv6 — `[::1]:3000` or `[::1]`
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return trimmed; // malformed; fail in isAllowedHost
    return trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1) return trimmed;
  // Bare IPv6 with multiple colons but no brackets isn't valid in a Host
  // header per RFC 7230, but be defensive: only strip when the part after the
  // last colon is purely digits.
  const after = trimmed.slice(colon + 1);
  if (after.length > 0 && /^\d+$/.test(after)) return trimmed.slice(0, colon);
  return trimmed;
}

/**
 * Parse `HTML_ANYTHING_ALLOWED_HOSTS` into a normalized, lowercased set. Empty
 * entries and whitespace are tolerated.
 */
export function parseAllowedHosts(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if (v) out.add(stripPort(v));
  }
  return out;
}

export type HostValidationOptions = {
  /** Operator-extended allowlist, in addition to the loopback defaults. */
  extraAllowed?: Set<string> | string[];
  /** When true, bypass the allowlist entirely. Driven by env opt-out. */
  allowAny?: boolean;
};

/**
 * Return true iff the `Host` header is one of: a loopback variant, an entry
 * in the operator-extended allowlist, or `*` is enabled via env.
 *
 * `null` / empty host is treated as not allowed — HTTP/1.1 requires a Host
 * header and HTTP/2 maps `:authority` to it, so an empty value is anomalous.
 */
export function isAllowedHost(
  headerHost: string | null | undefined,
  opts: HostValidationOptions = {},
): boolean {
  if (opts.allowAny) return true;
  if (!headerHost) return false;
  const host = stripPort(headerHost);
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  const extras =
    opts.extraAllowed instanceof Set
      ? opts.extraAllowed
      : new Set((opts.extraAllowed ?? []).map((h) => stripPort(h.toLowerCase())));
  return extras.has(host);
}

/**
 * Convenience wrapper that reads the two env-vars and the request's Host
 * header. Intended for use from `middleware.ts` so policy lives in one place.
 */
export function isRequestHostAllowed(req: { headers: { get(name: string): string | null } }): boolean {
  return isAllowedHost(req.headers.get("host"), {
    extraAllowed: parseAllowedHosts(process.env.HTML_ANYTHING_ALLOWED_HOSTS),
    allowAny: process.env.HTML_ANYTHING_ALLOW_ANY_HOST === "1",
  });
}

/** Methods that can change state, and so need the cross-site check below. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuse a JSON endpoint that was called with anything but `application/json`.
 *
 * `Request.json()` parses the body whatever the `Content-Type` says, so without
 * this a caller can pick one of the three CORS-simple types (`text/plain`,
 * `application/x-www-form-urlencoded`, `multipart/form-data`) and skip preflight
 * entirely. The `Origin` check above is the primary defence; this closes the
 * preflight-free shape so a future route that forgets it is not the whole story.
 *
 * Returns a 415 `Response` to send, or `null` when the request is acceptable.
 */
export function requireJsonContentType(req: {
  headers: { get(name: string): string | null };
}): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.trim().toLowerCase().startsWith("application/json")) {
    return null;
  }
  return Response.json(
    {
      error: "Unsupported Media Type",
      hint: "This endpoint requires Content-Type: application/json.",
    },
    { status: 415 },
  );
}

/**
 * Return true iff a browser `Origin` may issue a state-changing request.
 *
 * The host allowlist above stops DNS rebinding and nothing else. It cannot stop
 * plain CSRF, because a cross-origin `no-cors` POST to `http://127.0.0.1:<port>`
 * carries `Host: 127.0.0.1:<port>` — the *allowed* host — and skips preflight
 * whenever its `Content-Type` is CORS-simple. What distinguishes that request is
 * the `Origin` header, which browsers attach to every cross-origin POST
 * including `no-cors` ones. So the two checks cover different attacks and both
 * are required; this is the same pairing `manager/api/security.py` uses.
 *
 * The origin's hostname is matched against the same allowlist as `Host`, so an
 * operator who widened one has widened both and the UI's own (loopback, or
 * allow-listed) origin keeps working.
 *
 * The literal string `"null"` is NOT allowed: that is an opaque origin, i.e. a
 * sandboxed iframe or a `data:`/`blob:` document. No first-party caller sends
 * it, and treating it as trusted is what lets sandboxed content out of its box.
 */
export function isAllowedOrigin(
  originHeader: string | null | undefined,
  opts: HostValidationOptions = {},
): boolean {
  if (opts.allowAny) return true;
  if (!originHeader) return false;
  const trimmed = originHeader.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return false;
  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  // `LOOPBACK_HOSTS` stores IPv6 in the bracketed `[::1]` form. Node's
  // `URL.hostname` already returns IPv6 bracketed, so only a bare colon-bearing
  // host needs wrapping — bracketing an already-bracketed one yields `[[::1]]`,
  // which matches nothing.
  const bracketed =
    hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return isAllowedHost(bracketed, opts);
}

/**
 * True when this request is a state-changing call carrying a foreign `Origin`,
 * i.e. it must be refused. A request with no `Origin` at all is same-origin or
 * a non-browser client (curl, the runtime's own server-side fetch) and is left
 * alone — matching the Host gate's own posture that reachability is the boundary
 * for local callers.
 */
export function isRequestCrossSiteWrite(req: {
  method: string;
  headers: { get(name: string): string | null };
}): boolean {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return !isAllowedOrigin(origin, {
    extraAllowed: parseAllowedHosts(process.env.HTML_ANYTHING_ALLOWED_HOSTS),
    allowAny: process.env.HTML_ANYTHING_ALLOW_ANY_HOST === "1",
  });
}
