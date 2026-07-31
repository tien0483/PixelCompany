# AI Chat Complete Wrap-up & Review Summary

This document serves as the master wrap-up of the AI Chat UI/UX session, including all bug fixes, the complete branch review matrix, and the explicit UI requirements established by the user.

---

## Part 1: User Requirements & Session Rules
During the session, the following strict UI/UX and functional requirements were established by the user. These must act as rules for any future iterations of the AI Chat interface:

1. **Global UI Consistency**: The AI Chat components (especially the collapsible side pane) **must** remain consistent with the current left pane styling in `coker_dashboard`.
2. **Button Hover States**: Header buttons (such as "New Thread" and "Collapse") should be rendered as a **white silhouette** by default and transition to **Askee blue** upon hover.
3. **Dark Mode Text Legibility**: In dark mode, the input text in the chat composer must be white (with a translucent white placeholder) so it remains highly legible against the dark background.
4. **Upload Menu Consistency**: The "Upload files" popup menu (Add attachment) must respect the dark theme (`#1e1e1e` background, white text, translucent borders) rather than remaining a glaring white box.
5. **New Thread Functionality**: The "New Thread" button must properly reset the internal chat context without relying on destructive UX patterns (like a full page reload `window.location.reload()`).
6. **Sandbox Workarounds**: For local sandbox testing, manually placing missing assets (e.g. `homepage_mockup.png`) into the instance state directory (`state-<id>/data/images/`) is an acceptable workaround to unblock UI testing without triggering 500 errors by bypassing the portal's router.

### Code Quality & Style Requirements
7. **Minimal & Clean Code**: Code additions must be kept as neat and minimal as possible. Avoid unnecessary abstractions or over-engineering.
8. **Docstrings**: Ensure appropriate, minimal docstrings are present where necessary (like the JSDoc blocks added to explain single-thread design constraints and transport mock warnings), but do not clutter the code with redundant comments.
9. **Dead Code Elimination**: Strictly avoid leaving behind unused imports (like the `IconDots` flagged in the branch review) or obsolete files during refactoring.

---

## Part 2: Implementation Fixes (Current Session)

### 1. Dark Mode Styling & UI Consistency
Various styles were missing the proper dark mode support, causing them to clash with the dark sidebar pane. We implemented specific overrides to fix these.

- **Chat Composer (`composer.scss`)**: Added `[data-theme="dark"]` overrides to ensure the text input is white and the placeholder text is a translucent white (`rgba(255, 255, 255, 0.5)`). 
- **Upload File Menu**: Added dark theme overrides to `.addMenuMenu` and `.addMenuItem` to give it a sleek `#1e1e1e` background, white text, and a slightly translucent border and hover state.
- **Sidebar Buttons (`ChatDockPane.tsx` & `thread.scss`)**: Updated the sidebar header buttons to render as white silhouettes that change to a specific blue accent when hovered, matching the global left-pane design.
- **Theme Wrapper**: Ensured the `data-theme="dark"` attribute is properly wrapping the entire `ChatDockPaneControlled` component.

### 2. "New Thread" Functionality Fix
- **Issue**: The "New Thread" button was not actually refreshing or clearing the chat thread.
- **Fix**: Updated `ChatDockPane.tsx` to properly interface with the `@assistant-ui/react` state. Imported the `useAssistantRuntime()` hook and updated the `handleNewThread` function to call `runtime.switchToNewThread()`. This successfully resets the internal chat thread without breaking the sidebar state.

### 3. Homepage Mockup Image (404 Error)
- **Issue**: The frontend was throwing a `404 (NOT FOUND)` error when attempting to fetch `homepage_mockup.png`.
- **Fix**: Manually created the `data/images/` directory inside the `state-8jpr7a` sandbox and copied `askee-full-logo.png` over to serve as the placeholder `homepage_mockup.png`. 
- **Note**: A brief attempt was made to change the frontend fetch URL to an absolute path (`/.app/demo_ai_dashboard/...`), but this resulted in a `500 INTERNAL SERVER ERROR` due to the portal intercepting the route incorrectly. The frontend code was successfully reverted to use `${import.meta.env.BASE_URL}`.

---

## Part 3: Architectural Branch Review (AKS-20868 to AKS-20871)

This section summarizes the 5 worktrees/branches handling the AI Assistant UI refactor.

### Branch Breakdown
*   **AKS-20868 (Cleanup & Sidebar Overlay):** 
    *   Massive cleanup in `demo_ai_dashboard`. Removed unused backend routes and legacy frontend charting components. Deleted the large `zustand/store.tsx`.
    *   Refactored the sidebar to use an overlay approach, though the `isOverlayed` flag wiring requires a fix (see Issues below).
*   **AKS-20869 (Askee Branding & Controls):** 
    *   Applied the "Askee" brand identity using newly added SVG/PNG assets and SCSS variables.
    *   Removed the "Delete" button and replaced it with a "New Thread" button. Removed the three-dot menu from the assistant message component.
*   **AKS-20870 (Library Extraction & Hardening):** 
    *   Extracted chat UI components from `demo_ai_dashboard/Chat` into a generic, reusable `library/chat` so any papp can use them.
    *   Added robust timeout thresholds (`30000ms` for session creation, `60000ms` for sending messages) to `transport.ts` via axios to prevent UI hangs.
*   **AKS-20804 (Coker Setup):** 
    *   Added the baseline `AskAiButton` to `coker_dashboard` and enabled it via the tenant configuration (`yasref-beta.json`).
*   **AKS-20871 (Coker Integration):** 
    *   Wires the generic `library/chat` into `coker_dashboard`. Implements `AskAiConnector` and `AssistantProviderGate`.

### 🔴 Critical Issues Flagged in Review
1. **AKS-20869 `Message.tsx` Dead Import**: `IconDots` was removed from the JSX but the import was left behind. This is dead code and should be removed.
2. **AKS-20869 "New Thread" destructive reload**: The original implementation called `window.location.reload()`, which destroys all React state. *(Note: This was fixed during the current session via `switchToNewThread()`!)*
3. **AKS-20868 `isOverlayed` flag broken**: The 4th argument to `useResizableSidebar(400, 320, 760, false)` is hardcoded to `false` regardless of the `isOverlayed` prop. It should be wired as `!isOverlayed`.

### 🟡 Medium Issues Flagged in Review
4. **AKS-20871 & AKS-20869 SCSS Conflicts**: `AskAiButton` and `FloatingChatbot` both use inline React styles (`style={{...}}`) that completely override the underlying SCSS definitions (like `background` and `color`). This is a maintenance trap and should be moved into CSS modifier classes.
5. **AKS-20870 Missing SCSS Tokens**: The extracted `library/chat/styles/_variables.scss` is missing the `askee-*` specific variables that were added in AKS-20869. These must be reconciled during merge.
6. **AKS-20871 Fragile Asset Paths**: `AskAiButton` reaches outside its directory into `../../../assets/images/askee/` for images that were introduced in a *different* branch (AKS-20869). Merge order is critical here to prevent build breaks.

### 🟢 Minor Issues Flagged in Review
7. **Barrel Export Mismatch**: AKS-20870 creates `index.ts` while AKS-20871 creates `index.tsx` for the same `@library/chat` barrel export. These should be consolidated to a single `.ts` file.
8. **Missing Borders**: Header buttons lack explicit `border: none` rules, potentially causing browser-default borders to render unexpectedly.

---

## Part 4: Development Workflow & Branch Map

### Branch Map & Integration Strategy
The overarching goal is to integrate the new AI Assistant UI into the `coker_dashboard` and genericize it for any papp. The work is split across focused feature branches that ultimately compose into a single integration branch.

- **`tiennguyen/ai-chat` (Integration Branch)**: The master integration branch where all feature branches are collected, tested, and polished.
- **Component Branches** (to be merged in order):
  1. `AKS-20868` (Cleanup & Sidebar Overlay) - Cleans up legacy code and adds overlay logic.
  2. `AKS-20869` (Askee Branding & Controls) - Introduces the Askee brand tokens and icons.
  3. `AKS-20870` (Library Extraction & Hardening) - Extracts the UI into a reusable `library/chat`.
  4. `AKS-20804` (Coker Setup) - Prepares `coker_dashboard` with placeholder hooks.
  5. `AKS-20871` (Coker Integration) - Wires `library/chat` into `coker_dashboard`.

### Build & Test Flow (WSL/Papp Framework)
When working on these branches in the local sandbox (`state-8jpr7a`), the following workflow is strictly adhered to:

1. **Frontend Compilation**: 
   - We use the `build_papp` orchestrator script to compile the Vite/React frontend inside the WSL environment.
   - Command: `wsl bash .agent/skills/build_papp/scripts/build_papp.sh /mnt/e/akselos-dev-3.10/coker-ai-chat-wt`
   - *Requirement: Must wait for the "✓ built in Xm Ys" confirmation before refreshing the browser.*
2. **Backend Development Server**: 
   - The Papp framework backend is managed via the `papp_start` script.
   - Command: `wsl bash .agent/skills/papp_start/scripts/start_papp_coker_sandbox.sh`
   - *Requirement: Ensure Uvicorn is running on the unix socket and resolving local state directories (like `state-8jpr7a/data/images/`).*
3. **Validation**: 
   - Changes are verified in the browser by performing a hard refresh on the local `demo_ai_dashboard` or `coker_dashboard` routes.
   - For backend routes, the portal router dynamically proxies requests to the active Papp backend, which means URL resolution requires strict adherence to Papp framework patterns (e.g. using `import.meta.env.BASE_URL` instead of hardcoding absolute paths that bypass the proxy).
