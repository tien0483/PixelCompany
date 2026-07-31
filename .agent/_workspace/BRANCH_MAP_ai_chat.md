# AI-Chat Wave — Branch Map (LIVE)

> Read before touching the coker/demo_ai AI-chat UI branches. Source of truth for what each
> branch owns and how they compose. Keep current on every branch change.

## Model: 4 INDEPENDENT branches off `master`, not stacked
Each branch forks current `master` directly and is MR-able to `master` on its own (Strategy A —
no stacking). They have a logical review/merge ORDER because of real code deps, but git-wise each
is based on `master`. De-duplicated 2026-07-26: the old branches carried whole cross-branch commits
+ a re-committed `_tokens.scss` block on all four + a throwaway `library/components/chat/index.tsx`
stub — all removed. Each rebuilt as ONE neat squashed commit on `master ff04458652`.

Logical order (deps): `AKS-20869 → AKS-20804 → AKS-20870 → AKS-20871`. A downstream branch won't
build standalone until its deps merge (accepted); the full set is verified via the hub.

## Branches (LIVE tips)
| Branch | Tip | Owns | Deps |
|--------|-----|------|------|
| `AKS-20869` | b670810746 | ASKEE design system: brand assets (`chatbot-full-logo.png` + `chatbot-fav.png` only), `themes/_chat.scss` (navy `$chat-*` chrome + brand tokens) + `themes/_tokens.scss` `$token-color-*` set (SOLE owner), BEM chat SCSS PARTIALS with the STATIC-navy theme split (`.chat-sidebar` root navy; page light; `.chat-sidebar &` scope for dock overrides). NOT `chat.module.scss` (owned by 20870). No tsx. | master |
| `AKS-20804` | 22a96a88aa | Shared `library/components/AskAiButton` (floating round navy-disc launcher using `chatbot-fav.png`, `onClick` prop) + `ask_ai_button.module.scss` + barrel export + coker `App.tsx` base integration (Header rightSlot behind `ai-agent` flag). 4 files. | 20869 (fav asset) |
| `AKS-20870` | e34cc56387 | Extract chat to `library/components/chat/*` (+ `chat.module.scss` aggregator [SOLE owner], transport 30s/60s timeouts, `index.ts` barrel exporting makeAxiosTransport/artifactsToImageParts/isSessionGoneError, `transport.test.ts`), delete old `demo_ai_dashboard/Chat/*`, new `demo_ai_dashboard/components/FloatingChatbot`. ChatDockPane's collapsed launcher REUSES `AskAiButton`; header = **New Chat** (`chat:new-chat` event) + collapse (no delete). 28 files. | 20869 (scss/logo), 20804 (AskAiButton) |
| `AKS-20871` | b81d28308e | `library/components/AskAi/AskAiConnector` (owns the PERSISTENT lazy `AssistantProvider` wrapping only the chat pane; no `transport=` prop — uses the provider's memoized default) + coker `App.tsx` wiring (rightSlot → `AskAiConnector`; shell NOT wrapped). 3 files. | 20804 (button), 20870 (chat lib), 20869 (assets) |
| `tiennguyen-ai-chat` (hub) | 267c23aac2 | Composed merge of all four (order above). Builds. | all |

## Ownership rules (no dup)
- `$token-color-*` design tokens + `_chat.scss` live ONLY on 20869. Others reference, never re-commit.
- `AskAiButton.tsx` / `ask_ai_button.module.scss` live ONLY on 20804. 20871 does NOT touch them.
- BEM: every chat SCSS class nested under its `&` block. Dark mode via `[data-mantine-color-scheme='dark'] &`.
- Single launcher: the shared `AskAiButton`. No per-component launcher (dropped `.chat-launcher`).
- Assets shipped: only `chatbot-full-logo.png` + `chatbot-fav-blue.png` are used in the final tree.

## Verification (2026-07-26)
- `tsc -b` clean (0 errors) with wasm present.
- `vite build` green: coker_dashboard ✓ + demo_ai_dashboard ✓ (composed hub).
- No conflict markers; no dangling refs to deleted `demo_ai/Chat/*`; no old `askee-*` asset refs;
  no refs to removed tokens/mixin (`flex-center`, `chatbot-midnight/outline`, `chatbot-wordmark-gradient`,
  `$token-color-bg-hover`, 4 unused chrome tokens, `chatbot-fav.png/-grey/-reveal.svg`).
- `git rerere` on: resolutions recorded for `chat.module.scss` (union w/ popup), `index.ts` (union of
  AskAiButton + AskAiConnector + AssistantProviderGate exports), coker `App.tsx` (20871 wiring).

## Safety / rollback
- Originals: tags `backup/AKS-2080{4}-orig`, `backup/AKS-2086{9}-orig`, `backup/AKS-2087{0,1}-orig`,
  `backup/tiennguyen-ai-chat-orig`. Restore a branch: `git branch -f <b> backup/<b>-orig`.
- Hub WIP that was folded in (ChatDockPane→AskAiButton, launcher bottom-right) saved at
  `.agent/_workspace/ai_chat_landing/hub_wip_uncommitted.patch`.

## Known / deferred (from adversarial review)
- FIXED 2026-07-26: the old `AssistantProviderGate` wrapped `shell` in `<Suspense fallback={shell}>` →
  fallback→content swap on chat-chunk load remounted the whole shell (re-downloaded the FatigueStatus
  mesh) on every page load. Removed the gate; the persistent lazy `AssistantProvider` now lives inside
  `AskAiConnector`, wrapping ONLY the chat pane (nothing else consumes the runtime). Shell never enters a
  lazy boundary → no remount; chat chunk now loads on first OPEN, not on page load; conversation persists
  because the provider stays mounted after first open (`everOpened`) while `open` just toggles the pane.
- **FIXED 2026-07-26 (user confirmed navy)** — restored the static-navy theme split: `.chat-sidebar` root
  is navy (`background:$chat-bg` = $main-color, `color:$chat-text`, `--mantine-color-text` white);
  composer/message/thread keep a LIGHT base (used by the `/ai-chat` page = `.chat-page`, static white) and
  get navy overrides under a static `.chat-sidebar &` descendant scope; dead `[data-mantine-color-scheme='dark']`
  branches removed. SCSS token dedup folded in: `$ink`/`$surface`/`$brand-hover` locals dropped → reference
  `v.$chat-ink`/`v.$chat-surface-muted`/`v.$brand-blue-hover` from `_chat.scss`.
- Pre-existing questions left for the author (not defects): `New Thread` re-shows the ToS IntroGate
  (`started=false`); reset via global `window` `chat:clear-thread` event is unscoped (2 chat surfaces would
  both reset); `Message.tsx` ships Edit/Reload but the transport only sends last-message+sessionId (confirm
  backend session semantics); inline styles in `ImagePart`/`CodeHeader` vs `cls`.
- Downstream branches (20804/20870/20871) don't type-check/build standalone off master until their deps
  merge — inherent to independent-off-master with real deps; accepted. Order is load-bearing: `20869→20804→20870→20871`.

## For the next reviewer — build & run
- Review skill: `AKS-20946-2/.claude/skills/review-papp` (checklist `checklists/frontend-review.md` +
  standards `_shared/papp-standards/frontend-standards.md`). AKS-20855 rules extracted at
  `.agent/_workspace/aks20855_docs/`. Scope: `git diff master...tiennguyen-ai-chat -- dashboard/papps/frontends`.
- Build (WSL): `MSYS_NO_PATHCONV=1 wsl bash -c 'bash /mnt/e/akselos-dev-3.10/akselos-dev-2/.agent/skills/build_papp/scripts/build_papp.sh /mnt/e/akselos-dev-3.10/coker-ai-chat-wt <coker_dashboard|demo_ai_dashboard>'`
  (fresh worktrees need the gitignored wgpu wasm copied from akselos-dev-2 `src/library/components/wasm/`).
- Type-check: `npx tsc -b` from `<wt>/dashboard/papps/frontends` (WSL node v22).
- Tests: `npx vitest run transport.test messageParts.test --pool=threads` (forks pool times out in WSL;
  the barrel drags the heavy assistant-ui chain, so transport.test imports the `transport` module directly).
- Run live (user-gated, touches real collections/secrets): `start-papp` skill / `start_papp_coker_sandbox.sh`.

## Status log
- 2026-07-26 (user UI feedback): restored the NAVY docked sidebar (was rendering white — see FIXED above):
  `.chat-sidebar` static navy, `/ai-chat` page light, dock overrides via `.chat-sidebar &`, BEM kept,
  dead dark-attr branches gone, SCSS token dedup folded in (20869). Header buttons = **New Chat** (was
  "New Thread") + collapse; event `chat:clear-thread`→`chat:new-chat`; no delete-chat (none existed).
  Launcher icon → `chatbot-fav.png` (full-colour cube) instead of the blue variant; removed unused
  `chatbot-fav-blue.png` + `chatbot-fav-grey.png` (assets now: `chatbot-full-logo.png` + `chatbot-fav.png`).
  Tips: 20804 22a96a88aa, 20869 b670810746, 20870 e34cc56387, 20871 b81d28308e, hub 267c23aac2.
- 2026-07-26 (review-papp fan-out + fixes): ran the AKS-20946 review-papp skill (3 domain subagents:
  arch/perf, SCSS/BEM+AKS-20855, types/testing) on the composed diff. Fixed everything actionable:
  dropped redundant `transport=` prop in AskAiConnector (identity churn); removed dead `ChatPopup`+
  `popup.scss`+`cls.popup`, unused `Button` export, `ChatDockPane as ChatSidebar` alias, inert `threadKey`;
  barrel now exports `artifactsToImageParts`/`isSessionGoneError` (ServerCommunication imports via barrel);
  deep `../../../assets` imports → `src/*` alias; `ChatReply.artifacts` non-optional; added
  `__tests__/library/components/chat/transport.test.ts` (8/8) + fixed messageParts test import (5/5);
  `useCopyToClipboard` timeout cleanup. Tips: 20804 35ccbaf363, 20870 254c5c545e, 20871 6044a92295,
  hub a56772a4fe. tsc clean; coker+demo_ai builds green. Navy dock-pane + SCSS dedup left OPEN (above).
- 2026-07-26 (review round): adversarial review → fixed real de-dup gaps: repointed broken
  `__tests__/demo_ai_dashboard/messageParts.test.tsx` imports to `library/components/chat` (5/5 pass);
  made `chat.module.scss` single-owner (20870, dropped 20869's copy); removed now-dead `$token-color-primary`
  + `$token-spacing-sm`; wired orphan `.chat-sidebar__actions` (added `cls.sidebar.actions`, replaced
  ChatDockPane inline style); removed unused `introGate.sparkle` cls + `&__sparkle` scss block. Re-composed
  hub → efe75001ce; tsc clean + coker/demo_ai builds green. New tips: 20869 cf3aecfafc, 20870 f9562f4d2f.
- 2026-07-26: De-duplicated + rebuilt all four off master (squashed), removed unused SCSS tokens,
  BEM-nested all chat SCSS, folded the hub's ChatDockPane→AskAiButton de-dup (20869 re-scoped to a
  pure design-system branch; controls now live in 20870's library). Composed hub builds (coker +
  demo_ai) + tsc clean. Landed onto the live `AKS-*` + `tiennguyen-ai-chat` refs. Not pushed.
