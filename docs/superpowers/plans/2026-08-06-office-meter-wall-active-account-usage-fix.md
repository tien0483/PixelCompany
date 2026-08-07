# Fix Office meter-wall card: wrong header label + wrong-account usage bar

## Context

Screenshot shows the Office pane's lower-right overlay card ("Jacked meter wall"). Bold header says **"Claude"**, followed by a red usage bar, the active email (`trongphuoc.huynh@akselos.com`), and a `Shift:` line. User expects it to reflect *their* account/usage, not a generic "Claude" label.

Root cause, confirmed by reading the actual component chain:

- **Component:** `frontends/pixel_office/src/office/jacked/office-meter-wall.tsx` (`OfficeMeterWall`), mounted from `frontends/pixel_office/src/office/office-view.tsx:198-204`.
- **Bug 1 — header is a hardcoded brand label, not the user's identity.**
  `office-meter-wall.tsx:88` renders `{meter.label}` in bold as the card header. `meter.label` comes from `deriveOfficeJackedSemantics()` in `frontends/pixel_office/src/office/jacked/office-jacked-semantics.ts:53-58,91`, which sets it to the static `PROVIDER_LABELS.claude = "Claude"` — i.e. always literally "Claude" regardless of which account is signed in. The real identity (`account.displayName` / email) is only shown two lines down, in small tertiary text (`meter.activeEmail`, line 102-104).
- **Bug 2 — the usage bar can reflect the wrong account.**
  `office-jacked-semantics.ts:88`: `const pressure = accounts.reduce((worst, account) => Math.max(worst, account.pressure), 0)`. This takes the **worst pressure across every Claude account** (e.g. both `hoangtien.nguyen@...` and `trongphuoc.huynh@...`), not the pressure of the specific account shown as `activeEmail` right below it. So the red bar can be driven by a *different* account's usage than the one displayed — exactly the "does not show correct usage of user" symptom, since the swap history shows a prior shift from another email.

Both bugs live in the same two files and should be fixed together so the header, bar, and email line all describe the same account consistently.

## Fix

**`frontends/pixel_office/src/office/jacked/office-jacked-semantics.ts`**
- In the `PROVIDER_ORDER` loop (~line 82-97), find the active account the same way it already does (`active = accounts.find(a => a.id === jacked.activeAccountId) ?? accounts[0]`).
- Change `pressure` to `active?.pressure ?? 0` (the active account's own pressure), not the max across all accounts.
- Add the active account's identity to `ProviderMeter` (e.g. `accountLabel: active?.displayName ?? active?.email ?? null`), reusing the same `displayName ?? email` fallback pattern already used in `jacked-accounts-view.tsx:92`.
- Keep `label` (`"Claude"`) on the interface for the provider badge, but it stops being the primary heading.

**`frontends/pixel_office/src/office/jacked/office-meter-wall.tsx`**
- Swap the header content (line ~88): primary bold text becomes `meter.accountLabel ?? meter.activeEmail ?? meter.label` (the actual person/account), with `meter.label` ("Claude") demoted to a small secondary badge next to the existing "manual" badge — analogous to how `AccountRow` in `jacked-accounts-view.tsx` shows the account name bold and "Claude" as a small caption underneath (line 91-120).
- No structural change to the `Shift:` line or vault/night-shift lines.

## Verification

- Update/extend `frontends/pixel_office/src/office/jacked/office-jacked-semantics.test.ts`: add a case with two `claude` accounts where the *inactive* one has higher pressure, and assert `semantics.meters[0].pressure` equals the *active* account's pressure (not the max), and `accountLabel` matches the active account's `displayName`/email.
- Run `frontends/pixel_office` unit tests for this file (vitest) to confirm no regressions.
- Manually sanity check in the Office pane (or via the existing e2e harness `office-e2e-harness.tsx`) that with a fixture where `trongphuoc.huynh@akselos.com` is active, the card header now shows that identity and the bar reflects that account's own `pressure`, not another account's.
