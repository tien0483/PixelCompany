This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

pnpm-prepublish-quirk
- `frontends/pixel_office` depends on `"kanban": "file:../../backends/runtime"` (the CLI, for e2e). Under plain `npm install`, npm never builds/checks a `file:` dep automatically. Under pnpm, a `file:` dep gets packed like a publish target, so pnpm runs `prepare` AND `prepublishOnly` for `backends/runtime` on every `pnpm install` — which chains into `npm run build && npm run check` (full tsc + vite build + biome + the entire vitest suite). This means `pnpm install` at the repo root is slow and will surface any pre-existing lint/typecheck/test breakage as an install failure, even in files nobody touched.
- Migrating this repo from npm to pnpm (2026-08-01, see root CLAUDE.md changelog) surfaced three previously-dormant bugs that `npm install` never exercised: (1) `noUncheckedIndexedAccess` violations in `officeState.port.test.ts`/`layoutSerializer.port.test.ts` (array-index access needs `!`), (2) two zod v4 versions in the tree (`4.3.6` pinned by `backends/runtime`, `4.4.3` hoisted from other deps) making `RuntimeJackedSnapshot` (a `z.infer` type) look like "two different types with this name" in `office-jacked-semantics.test.ts` — fixed by pinning a single version via `overrides: { zod: 4.4.3 }` in root `pnpm-workspace.yaml` (pnpm reads overrides from there, not `package.json`), (3) `task-worktree.integration.test.ts` hardcoded the pre-rename `.cline` path instead of importing `KANBAN_RUNTIME_HOME_DIR_NAME` from `task-worktree-path.ts` (stale since the `~/.cline` → `~/.agent` rename).
- The user has a standing `Edit(**/package.json)` deny rule (any `package.json`, repo-wide) — this is enforced by Claude Code's own permission classifier, and it also blocks equivalent Bash workarounds like `npm pkg delete`/`npm pkg set` since those "accomplish the same package.json modification through a different tool." Any dependency/manifest change (versions, scripts, "workspaces" field, etc.) needs the user to do it, or needs a workaround that lives outside `package.json` (e.g. `pnpm-workspace.yaml` supports `overrides` and `allowBuilds` directly, so pnpm-specific config never needed a `package.json` edit).

stack-daemon-args-freeze-but-flags-do-not
- `stack-flags.json` is re-read per request by `server.py`, but a daemon's argv is fixed at spawn. Headroom is the one where that gap bites: `headroom-process.ts` passes `--anthropic-api-url http://127.0.0.1:3456` only when `ENABLE_CCR` was on **at its start**. Turning CCR off afterwards changed nothing about a running headroom, and `resolve_route` targets `HEADROOM_URL` whether CCR is on or off (both branches return it — only the chain *label* differs), so every request kept crossing the disabled CCR. The switchboard cheerfully reported `ENABLE_CCR: false` while 100% of traffic still went through it.
- Symptom seen 2026-08-13: `API Error: 400 Request format not supported` on every turn, including a brand-new task's first message. That string comes from the vendored CCR's `AnthropicInputProcessor` (`claude-code-router/dist/input/anthropic/processor.js`), not from Anthropic or Kanban. CCR auto-generates `ccr-home/.claude-code-router/config-router.json` on first start with `defaultProvider: codewhisperer-primary` and no credentials, so an unconfigured CCR fails *everything* that reaches it — `logs/ccr.log` fills with `Unknown model claude-sonnet-4-6, using default` → `Failed to add authentication token`.
- Debugging rule learned the hard way: the error naming "subagent" sent three rounds of investigation at the seat/subagent path, but the give-away was the timing — it failed instantly ("Brewed for 0s"), i.e. the *main* agent's own turn died before any subagent existed. Check whether the failing request is the parent's or a subagent's before picking a path. `ps -o args -p <pid of :8787>` shows headroom's real upstream in one command and would have ended it immediately.
- Fix: whoever launches headroom now records its real upstream in `logs/headroom.chain` (`ccr` or `direct`) — `superviseStackDaemon`'s `chainState` for the runtime, an explicit `printf` in `activate-stack.sh`, cleared by both plus `stop-stack.sh`. `resolve_route` skips a headroom whose marker says `ccr` while the flag is off, surfacing `headroom:8787 (still chained to disabled ccr, skipped — restart it)` instead of silently honouring neither. A missing marker means "unknown" and keeps the old trust-the-flags behaviour, so a hand-started headroom is not misjudged.
- Two independent CCR bugs share that one error string, so fixing either alone still looks broken: (1) the chain-staleness above, and (2) the vendored CCR rejects `system` as a plain string — valid, documented Anthropic shape, and exactly what Claude Code's subagent dispatches send — accepting only an array of content blocks. `read_subagent_route` in `server.py` normalizes it for seat-routed traffic only; the direct/headroom paths accept either form and are left alone.

worktree-hooks-fire-before-symlinks
- Task worktrees are created with `git worktree add --detach` in `src/workspace/task-worktree.ts:534`. The runtime symlinks gitignored deps (`node_modules`, `backends/jacked/.venv`, `frontends/pixel_office/dist`) into the new worktree only AFTER `worktree add` returns, via `prepareNewTaskWorktree` (line 551). But `git worktree add` performs a checkout, which fires the repo's `post-checkout` hook (`core.hooksPath=.githooks`) synchronously — so any hook runs against a worktree that has NO deps yet.
- If a hook exits non-zero, `git worktree add` reports failure, the runtime returns the hook's stderr as the task error (task-worktree.ts:535-543), and `prepareNewTaskWorktree` never runs — the worktree is left registered but symlink-less, so every subsequent task in it also fails. Symptom seen 2026-08-01: `.githooks/post-checkout` → `scripts/rebuild-ui-if-changed.sh` ran `npx vite build` with no `node_modules`, dying with `ERR_MODULE_NOT_FOUND: Cannot find package '@tailwindcss/vite'`. Looks like a pnpm/dependency problem (three prior sessions chased it as one) but is not — there is no per-worktree install step by design; deps arrive via symlinks the hook failure prevents.
- Rule: any repo git hook that could fire during `worktree add` must guard for absent deps (e.g. `[ -d node_modules ] || exit 0`) and must not hard-fail on a fresh worktree. Fix applied: `scripts/rebuild-ui-if-changed.sh` early-exits when `frontends/pixel_office/node_modules` is missing.

TypeScript principles
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- Prefer SDK-provided types, schemas, helpers, and model metadata over local redefinitions. For things like Cline SDK reasoning settings, use the SDK's source of truth whenever possible instead of recreating unions, support checks, or shapes in Kanban.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Code quality
- Write production-quality code, not prototypes
- Break components into small, single-responsibility files. 
- Extract shared logic into hooks and utilities. 
- Prioritize maintainability and clean architecture over speed. 
- Follow DRY principles and maintain clean architecture with clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible
- Before adding custom utility code, evaluate whether a well-maintained third-party package can reduce complexity and long-term maintenance cost.

Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

Git guardrails
- NEVER commit unless user asks.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

web-ui Stack
- Kanban web-ui uses Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, and Lucide React for icons.
- Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn utility).
- Toast notifications use `sonner`. Import `{ toast }` from `"sonner"` or use `showAppToast` from `@/components/app-toaster`.

Styling mental model
- Use Tailwind utility classes as the primary styling system. Prefer `className` over inline `style={{}}`.
- Prefer Tailwind classes over adding custom CSS in `globals.css` when possible. Conditional Tailwind classes via `cn()` are better than CSS overrides for state-driven styling (e.g. selected/active variants). Reserve `globals.css` for things Tailwind can't express: complex selectors (sibling combinators, attribute selectors), app-level layout glue, or styles that genuinely need to cascade.
- Only use inline `style={{}}` for truly dynamic values (colors from props/variables, computed positions from drag-and-drop, runtime-dependent dimensions).
- The design system tokens are defined in `globals.css` inside `@theme { ... }`. Use Tailwind utilities that reference them: `bg-surface-0`, `text-text-primary`, `border-border`, etc.

Design tokens (defined in globals.css @theme)
- Surface hierarchy: `surface-0` (#1F2428, app bg / columns), `surface-1` (#24292E, navbar / project col / raised), `surface-2` (#2D3339, cards/inputs), `surface-3` (#353C43, hover), `surface-4` (#3E464E, pressed/scrollbars)
- Borders: `border` (#30363D, default), `border-bright` (#444C56, more visible), `border-focus` (#0084FF, focus rings)
- Text: `text-primary` (#E6EDF3), `text-secondary` (#8B949E), `text-tertiary` (#6E7681)
- Accent: `accent` (#0084FF), `accent-hover` (#339DFF)
- Status: `status-blue` (#4C9AFF), `status-green` (#3FB950), `status-orange` (#D29922), `status-red` (#F85149), `status-purple` (#A371F7), `status-gold` (#D4A72C)
- Border radius: `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px), `rounded-xl` (12px)

UI primitives (src/components/ui/)
- `Button` from `@/components/ui/button`: `variant="default"|"primary"|"danger"|"ghost"`, `size="sm"|"md"`, `icon={<LucideIcon />}`, `fill`, children for text content.
- `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter` from `@/components/ui/dialog`: For modals. `DialogHeader` takes a `title` string.
- `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/dialog`: For destructive confirmations.
- `Tooltip` from `@/components/ui/tooltip`: `<Tooltip content="text"><trigger/></Tooltip>`.
- `Spinner` from `@/components/ui/spinner`: `size` (number), `className`.
- `Kbd` from `@/components/ui/kbd`: Keyboard shortcut display.
- `cn` from `@/components/ui/cn`: Utility for conditional className joining.

Icons
- Use `lucide-react` for all icons. Import individual icons: `import { Settings, Plus, Play } from "lucide-react"`.
- Standard icon sizes: 14px for small buttons, 16px for default contexts.
- Pass icons as JSX elements to button `icon` prop: `icon={<Settings size={16} />}`.

Radix UI primitives
- Use Radix directly for headless behavior: `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch`, `@radix-ui/react-collapsible`, `@radix-ui/react-select`.
- Style Radix components with Tailwind classes. Use `data-[state=checked]:` for state-driven styling.

Dark theme
- The app is always in dark theme. Colors are set via CSS custom properties in `globals.css`.
- Surface hierarchy: `bg-surface-0` (app background) -> `bg-surface-1` (raised panels) -> `bg-surface-2` (cards/inputs) -> `bg-surface-3` (hover) -> `bg-surface-4` (pressed).
- Do NOT use Blueprint, Tailwind's light-mode defaults, or any `dark:` prefix. The theme is always dark.

Misc. tribal knowledge
- Kanban's native Cline agent is powered by the installed `@clinebot/core` and `@clinebot/llms` packages plus the local `src/cline-sdk/` boundary layer, so when Cline behavior is unclear, inspect those packages and `src/cline-sdk/` for the real implementation details.
- Kanban is launched from the user's shell and inherits its environment. For agent detection and task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths. On setups with heavy shell init like `conda` or `nvm`, doing that per task can freeze the runtime and even make new Terminal.app windows feel hung when several tasks start at once. It's fine to use an actual interactive shell for explicit shell terminals, not for normal agent session work.
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess or SDK-host startup path before assuming a slow test body. Read `.plan/docs/node22-ci-hanging-tests-investigation.md` before repeating that investigation. `test/runtime/cline-sdk/cline-task-session-service.test.ts` was the big prior culprit because a unit-style suite was still booting the real Cline SDK host.
- When Kanban runs on a headless remote Linux instance (for example over SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat this as a normal remote-runtime limitation and use manual path entry fallback instead of requiring desktop packages.
