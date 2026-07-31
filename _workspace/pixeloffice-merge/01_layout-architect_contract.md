# PixelOffice three-pane layout contract

## ASCII

```text
┌────────────────┬──────────────────────────────┬────────────────────┐
│ LEFT SIDEBAR   │ CENTER (~3/4)                │ RIGHT (~1/4)       │
│ Projects|Agent │   KANBAN BOARD               │ UPPER: Accounts    │
│ |Jacked        │   (or Git History alternate) │ LOWER: PixelOffice │
│ ────────────── │                              │                    │
│ Jacked config  │                              │                    │
└────────────────┴──────────────────────────────┴────────────────────┘
```

## Components

| Slot | Component |
|------|-----------|
| Shell | `HomeTriplePane` in `kanban/web-ui/src/components/home-triple-pane.tsx` |
| Watch / Accounts | `JackedAccountsView` in `kanban/web-ui/src/jacked/jacked-accounts-view.tsx` (full Accounts main surface; not compact user-watch) |
| Config | `JackedSidebarConfig` in `kanban/web-ui/src/jacked/jacked-sidebar-config.tsx` |
| Office | existing `OfficeView` (no Jacked iframe) |
| Resize | `use-home-right-column-layout.ts` |

## Storage

- `LocalStorageKey.HomeRightColumnWidth`
- `LocalStorageKey.HomeRightSplitRatio`
- Reuse office open persistence for right-column visibility (`useOfficeViewState` → `isRightColumnOpen` semantics via existing `isOfficeOpen`)

## TopBar

Office button toggles right column open/closed. Default: open when project selected (migrate prior `office-view-open` true → column open; if false, column closed but board still visible).
