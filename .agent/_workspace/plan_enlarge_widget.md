# Plan (parked): enlarge / fullscreen 3D widget

Status: **removed from code, kept as an idea.** AKS-20746.

## What it was
A maximize/minimize button on WgpuCanvas that let the end-user pop the 3D widget
to a fullscreen overlay and back. Implemented then removed:

- Button toggled `isEnlarged`; host page rendered the widget's card as a
  `position:fixed; inset:0; z-index:9999` overlay, then re-fit the view after a
  100ms resize delay.
- State lived in `demo_ai_dashboard/store/useInteractionStore.ts` (a standalone
  zustand store); WgpuCanvas took `isEnlarged` / `onToggleEnlarge` props so the
  shared canvas stayed decoupled from any single app store.
- `WidgetCard` gained a `style` prop so the enlarged card could fill the overlay.

## Why removed
Judged redundant for the per-page embedded model (developer owns layout; a page
that wants a big view sizes the card itself). Removed the button, the props, the
`useInteractionStore`, the Home fullscreen overlay, and the `WidgetCard.style` prop.

Reference commits (before removal): `1d08c574` added enlarge-as-props;
removal commit follows the visibility redesign.

## How to reintroduce cleanly (if wanted later)
1. Drive it from the config JSON, consistent with the new model:
   add `ui.enlarge?: boolean` to `WidgetUiConfig` (types.tsx) — dev opts a page in.
2. Keep the toggle **host-owned**: WgpuCanvas exposes `onToggleEnlarge?` + reads
   `isEnlarged?` (props), never imports an app store. The host renders the
   fullscreen overlay and owns the state.
3. Re-fit after the layout settles — prefer a ResizeObserver on the container
   over the 100ms `setTimeout` used before.
4. Button sits in `.canvas-top-container` next to Home; icon `IconMaximize` /
   `IconMinimize`, tooltip Enlarge/Minimize.

## Do NOT
- Don't fold the fullscreen overlay into the shared library component — it's a
  host-layout concern.
- Don't reuse a global app store for the state (that coupled the shared canvas
  to `demo_ai` last time).
