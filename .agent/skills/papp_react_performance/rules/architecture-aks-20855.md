---
title: AKS-20855 & AKS-20924 Frontend Architecture & Styling
impact: CRITICAL
impactDescription: Ensures consistency, maintainability, and scalability across Papp frontends.
tags: architecture, aks-20855, aks-20924, styling, components, mvvm, bem
---

## AKS-20855 & AKS-20924 Frontend Architecture & Styling

To align with modern Design System standards and improve scalability, Papp frontends must adhere to a strict structural and styling architecture.

**Exceptions (AKS-20924):** No architectural/styling changes should be made to `AKS-20924_coker-home-page` or `AKS-20924_coker-fatigueStatus-page`. These pages are exempt but all other pages must match this style and rule.

### 1. Styling Architecture (Tokens, Mixins & BEM)

Avoid scattered hardcoded values, inconsistent class naming, and deep nesting that compromises maintainability.
- **Design Tokens:** All values (colors, spacing, typography) must use tokens from `assets/sass/themes/_tokens.scss`.
- **Mixins:** Use Sass mixins from `assets/sass/themes/_mixins.scss` for clean encapsulation.
- **BEM Methodology:** Use `block__element--modifier` (kebab-case) for naming conventions to manage parent-child relationships easily.

**Correct Styling Example:**
```scss
// assets/sass/components/ask_ai_button.module.scss
@use 'assets/sass/themes/tokens' as *;
@use 'assets/sass/themes/mixins' as *;

.ask-ai-button {
  @include flex-center; // from mixins
  background-color: $token-color-primary;

  &__icon {
    margin-right: $token-spacing-sm;
  }

  &--disabled {
    opacity: 0.5;
  }
}
```

### 2. Page Architecture: MVVM 3-File Pattern

Each page must follow a strict Model-View-ViewModel (MVVM) separation. Do not create empty placeholder files—only create them when there is actual content.

- `{Page}.tsx` (Humble View): Renders the view-model. Contains NO business logic and NO static inline styles.
- `use{Page}.ts` (ViewModel): Orchestrates all data hooks and derives all display values for the View.
- `{page}Utils.ts` (Model/Utils): Contains pure functions only. No hooks, no side effects. Must be unit-testable.

**Example Page Structure:**
```text
dashboard/papps/frontends/src/coker_dashboard/pages/ProcessMonitoring/
 ├── ProcessMonitoring.tsx
 ├── useProcessMonitoring.ts
 └── processMonitoringUtils.ts
```

### 3. Component Separation & Promotion

Dashboard-specific components must be kept entirely separate from shared, reusable library components.

**A. Sub-components (Page Level):**
- Small render-only helpers should stay within the page folder.
- Promote to `coker_dashboard/components/{Page}/...` ONLY when the component is reused across multiple pages or complex enough to require its own utils/tests.

**B. Dashboard-Specific vs Library:**
- **Dashboard-specific:** `dashboard/papps/frontends/src/coker_dashboard/components/...`
- **Reusable Library:** `src/library/components/<ComponentName>` (Must be exported via the components barrel: `src/library/components/index.tsx`).

**Incorrect (Tight Coupling & Bad Styling):**
```tsx
// ❌ WRONG LOCATION: src/library/components/Chat/FloatingChatbot.tsx
// ❌ WRONG STYLING: using generic global class names, inline styles, no BEM
import './chatbot-global.css'

export function FloatingChatbot() {
  return <div style={{ color: 'red' }} className="chat-container">...</div>
}
```

**Correct (Separation of Concerns):**
```tsx
// ✅ CORRECT LOCATION: dashboard/papps/frontends/src/coker_dashboard/components/FloatingChatbot/FloatingChatbot.tsx
import { AskAiButton } from '@library/components'

export function FloatingChatbot() {
  return <div><AskAiButton /></div>
}
```
