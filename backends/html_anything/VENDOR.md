# html-anything vendor notes

Upstream: [nexu-io/html-anything](https://github.com/nexu-io/html-anything) (Apache-2.0).

Vendored tree: `next/`, plus root `LICENSE` and `README.md`. Excluded: `cli/`, `e2e/`, `docs/`.

## Fork delta

| Change | Why |
|--------|-----|
| Deleted `next/src/app/api/convert/` | CLI-spawn entry point used `--permission-mode bypassPermissions`; unsafe on a listening port. |
| Deleted `next/src/app/api/deploy/` | Vercel deploy tokens; unused in PixelOffice. |
| Deleted `next/src/app/api/marketplace/` | Network fetch of GitHub tarballs (SSRF surface); out of scope. |
| Added `next/src/app/api/prompt/route.ts` | Steps 1–4 of convert without `invokeAgent` — template + prompt service only. |
| Added `next/src/lib/templates/build-edit-prompt.ts` | Lifted from deleted `convert/route.ts` for the diff-edit path. |
| Patched `next/src/lib/templates/loader.ts` | Dropped `@/lib/skills/registry` marketplace merge (only coupling to deleted marketplace). |
| Patched `next/src/lib/parsers/file.ts` | Narrow cast for `pdf.destroy` — unpdf typings omit it; blocks `next build` typecheck. |

Apache-2.0 §4: `LICENSE` retained; this file marks modified/deleted paths.

## Runtime contract

- Sidecar is supervised by `backends/runtime` on loopback (default port **8322**).
- Agent invocation lives in the runtime (`runAgentOneShot`), not this package.
- `SKILLS_DIR` resolves via `process.cwd()` → spawn cwd must be `backends/html_anything/next`.
