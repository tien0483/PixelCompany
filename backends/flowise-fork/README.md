# Flowise fork — the Agents tab's studio

`backends/flowise` is a git submodule pointing at a **private** fork of
[FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise) (archived 2026-08-13, pinned at
**v3.1.4**). This directory holds what PixelOffice needs to reproduce that fork: the patch
set, and the reasoning behind each decision.

## Why a fork at all, and why private

- Upstream is archived. No CVE fix will ever land, so the studio is internal tooling on
  loopback — never exposed, never tunnelled.
- The theme and the embed behaviour have to be patched for the canvas to read as a
  PixelOffice surface rather than a foreign product in an iframe.
- **The fork must be private.** `packages/server/src/enterprise/**` and
  `packages/server/src/IdentityManager.ts` are under FlowiseAI's Commercial License, which
  permits copying and modifying *"for development and testing purposes, without requiring a
  subscription"* but states it is *"forbidden to copy, merge, publish, distribute"*. A private
  repo is a dev/testing copy; a public fork would be publishing. Production use needs a
  subscription — that call is the repo owner's, not this document's.

## Why the enterprise directory is kept, not stripped

The obvious plan — delete the commercial code and stub its auth — was measured against the
actual tree and rejected. `enterprise/` owns the **schema**, not just the login:

- `packages/server/src/database/entities/index.ts` imports `User`, `Organization`,
  `Workspace`, `Role`, `LoginMethod`, `LoginSession`, `WorkspaceUser(s)`, `WorkspaceShared`
  from `enterprise/database/entities/`.
- `packages/server/src/database/migrations/{sqlite,mysql,mariadb,postgres}/index.ts` import
  ~12 enterprise migrations, several of which alter **core** tables:
  `LinkWorkspaceId`, `LinkOrganizationId`, `AddWorkspaceIdToCustomTemplate`,
  `ExecutionLinkWorkspaceId`, `AddApiKeyPermission` (which references `Role`).
- 64 Apache-side files import from `enterprise/` in total (29 routes, 10 services,
  9 database, 7 utils, 5 controllers, plus `index.ts`).

Deleting it therefore breaks the migration chain and requires re-authoring the schema —
weeks of work, permanently owned, against a dead upstream. Instead the fork keeps
`packages/server/**` byte-identical to v3.1.4 apart from three small additions listed below,
and Flowise runs in its open-source mode: with no `FLOWISE_EE_LICENSE_KEY`, `IdentityManager`
sets `licenseValid = false` and `Platform.OPEN_SOURCE`, and local email/password accounts work
with no key.

## Setting the fork up

```bash
# 1. Fork FlowiseAI/Flowise on GitHub as a PRIVATE repo, then:
git -C <PixelCompany> submodule add git@github.com:<you>/<your-flowise-fork>.git backends/flowise
cd <PixelCompany>/backends/flowise
git checkout -b pixeloffice v3.1.4

# 2. Apply the PixelOffice patches (two commits keep the upstream diff readable)
git apply ../flowise-fork/patches/0001-pixeloffice-ui-theme-and-embed.patch
git commit -am "feat(pixeloffice): theme the studio and add embed mode"
git apply ../flowise-fork/patches/0002-pixeloffice-embed-credential-route.patch
git commit -am "feat(pixeloffice): serve the seeded embed credential to loopback"

# 3. Install and build — needs node 24 and pnpm 10.26, not this repo's node 22 / pnpm 11
nvm install 24                       # PixelOffice keeps running on its own node
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
npx --yes pnpm@10.26.0 install --no-frozen-lockfile
npx --yes pnpm@10.26.0 build
```

**The toolchain is not negotiable.** `engines` in Flowise's manifest says `node: ^24`,
`pnpm: ^10.26.0`, and pnpm 11 enforces it: every install under node 22 dies with
`ERR_PNPM_UNSUPPORTED_ENGINE`, and the `engine-strict = false` already present in Flowise's
own `.npmrc` does **not** suppress it (pnpm 11 moved that setting out of `.npmrc`).
`--config.engine-strict=false` does not help either.

The runtime therefore does not hand the studio its own `process.execPath`:
`backends/runtime/src/flowise/flowise-node.ts` resolves a node 24+ binary — from
`PIXELOFFICE_FLOWISE_NODE`, else the runtime's own node if new enough, else the newest
qualifying `~/.nvm/versions/node/v*` install — and warns with install hints when it finds
none.

Then start PixelOffice normally — `startFlowiseProcess` finds the built submodule and brings
the studio up on **3010**. Until step 3 completes, the Agents tab reports "not installed" and
nothing else changes.

## What the patches do

`0001` — `packages/ui` only, 7 files:

| File | Change |
|---|---|
| `assets/scss/_themes-vars.module.scss` | the 20 dark variables remapped onto PixelOffice tokens (`surface-0 #1F2428`, `border #30363D`, `accent #0084FF`, …). Variable names untouched, so the whole MUI theme follows. |
| `themes/index.js` | dark `divider` uses the border token instead of the background, which is invisible against the remapped surfaces. |
| `pixeloffice/embed.js` | **new.** `isEmbedded()` — reads `?embed=1` and latches it into `sessionStorage` (the studio uses `BrowserRouter`, so internal navigation drops the query). Also forces dark mode as an import side effect. |
| `index.jsx` | imports `pixeloffice/embed` **first**, before any store import, so the force-dark write lands before `customizationReducer` reads `isDarkMode` for its initial state. |
| `layout/MainLayout/index.jsx` | when embedded: no AppBar, no drawer, no announcement banner, and none of the margins they reserve — the tab supplies its own chrome. |
| `pixeloffice/EmbedAutoLogin.jsx` | **new.** When embedded and unauthenticated, fetches the credential and performs the normal login, dispatching upstream's `loginSuccess`. One attempt only, then it gets out of the way. |
| `App.jsx` | wraps `<Routes>` in `EmbedAutoLogin`. |

`0002` — `packages/server`, 3 files:

| File | Change |
|---|---|
| `pixeloffice/embed-credential-route.ts` | **new.** `GET /api/v1/pixeloffice-embed/credential` returns the seeded `{email, password}` — but only when `PIXELOFFICE_EMBED=1` **and** the request comes from loopback **and** the file exists. Otherwise 404/503. |
| `routes/index.ts` | mounts it at `/pixeloffice-embed`. |
| `utils/constants.ts` | whitelists `/api/v1/pixeloffice-embed/` from the API-key/JWT gate — requiring auth on the route that *provides* auth would be circular. |

Nothing in either patch touches `enterprise/` or `IdentityManager.ts`.

## Who writes the credential

PixelOffice's runtime, not the studio: `backends/runtime/src/flowise/flowise-credential.ts`
writes `backends/flowise/.flowise/embed-credential.json` (mode 0600, gitignored) and registers
the account via `POST /api/v1/account/register` once the port answers. Success is judged by a
`POST /api/v1/auth/login` probe, because registering an already-registered email fails
upstream. The generated password carries a fixed `Px1!` prefix so it always satisfies the
studio's lower + upper + digit + special rule.

## Security posture

With no login in front of the canvas and Flowise's Custom Function nodes executing arbitrary
code by design, the entire boundary is:

1. the studio binds **127.0.0.1** only;
2. `CORS_ORIGINS` and `IFRAME_ORIGINS` name the PixelOffice origin and nothing else;
3. `PIXELOFFICE_EMBED=1` plus a loopback check gate the credential route.

Do not widen any of the three, and do not put this behind a tunnel or a reverse proxy that
adds a non-loopback source address.
