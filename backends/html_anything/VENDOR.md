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
| Added `next/src/app/api/build-id/route.ts` | Reports the build this *process* serves, so the runtime can spot an orphaned sidecar still holding the port after a rebuild. |
| Patched `next/next.config.ts` | `generateBuildId` + `env.HTML_ANYTHING_BUILD_ID` so `/api/build-id` and `.next/BUILD_ID` carry the same value for that comparison. |
| Patched `next/src/lib/templates/shared.ts` — narrowed the tool ban | Upstream forbids "任何文件系统工具", which bans `Read` too, so a plan's pasted screenshot could never be looked at and annotated redesigns silently ignored the image. Now only write/exec tools are banned, and `Read` is allowed strictly on the paths the caller appends (`backends/runtime/src/html/html-prompt-augment.ts`). |
| Patched `next/src/lib/templates/shared.ts` — `data:` images | The output-side ban on external image URLs also blocked embedding the user's own reference image. Inline base64 `data:` URIs are now allowed; arbitrary external URLs stay banned, and the artifact stays a self-contained single file. |

Apache-2.0 §4: `LICENSE` retained; this file marks modified/deleted paths.

## Runtime contract

- Sidecar is supervised by `backends/runtime` on loopback (default port **8322**).
- Agent invocation lives in the runtime (`runAgentOneShot`), not this package.
- `SKILLS_DIR` resolves via `process.cwd()` → spawn cwd must be `backends/html_anything/next`.
