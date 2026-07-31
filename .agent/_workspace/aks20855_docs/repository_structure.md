# Repository Structure

```{admonition} Author
For more information, please contact
<a href="mailto:xuanhoang.nguyen@akselos.com" target="_blank">Hoang Nguyen</a>
```

This page explains the directory layout of the Papp frontend codebase located
at `dashboard/papps/frontends/`. The `coker_dashboard` is used as the reference
example throughout.

## Top-Level Layout

```text
frontends/
├── index.html                # HTML entry point (loads selected dashboard dynamically)
├── package.json              # NPM dependencies and build scripts
├── vite.config.ts            # Vite bundler configuration
├── tsconfig.json             # Main TypeScript configuration
├── tsconfig.app.json         # TypeScript config for application code
├── tsconfig.node.json        # TypeScript config for Node.js tooling
├── tsconfig.test.json        # TypeScript config for tests
├── eslint.config.js          # ESLint linter rules
├── vitest.setup.ts           # Vitest test environment setup
├── .env                      # Environment variable (VITE_MY_APP selects the active dashboard)
├── favicon.png               # Browser favicon
├── scripts/                  # Scaffolding scripts
├── src/                      # Source code
└── __tests__/                # Unit and integration tests
```

### Entry Point

`index.html` dynamically loads the selected dashboard's entry file at build
time:

```html
<script type="module" src="/src/%VITE_MY_APP%/main.tsx"></script>
```

Vite substitutes `%VITE_MY_APP%` with the value from the `.env` file (e.g.,
`coker_dashboard`), so the app boots from `src/coker_dashboard/main.tsx`.

### Scripts

```text
scripts/
├── create-component.js       # Scaffold a new component in a dashboard
└── create-project.js         # Scaffold a new dashboard project
```

Run via `npm run create-project <name>` and `npm run create-component <project> <name>`.

## Source Directory (`src/`)

```text
src/
├── library/                          # Shared library (components, hooks, utils, charting)
├── assets/                           # Global assets (images, icons, stylesheets)
├── coker_dashboard/                  # Coker unit structural monitoring (primary)
├── jobs_dashboard/                   # Job monitoring dashboard
├── aiv_dashboard/                    # Acoustic Induced Vibration dashboard
├── reactor_3d_dashboard/            # 3D reactor visualization dashboard
├── reactor_time_series_dashboard/   # Reactor time series analysis dashboard
├── cantilever_beam_dashboard/       # Cantilever beam analysis dashboard
├── demo_ai_dashboard/               # AI assistant demo dashboard
├── example_service/                  # Minimal example/template dashboard
├── simple_wgpu_canvas_app/          # Simple WGPU canvas application
└── vite-env.d.ts                    # Vite environment type definitions
```

Each folder under `src/` (except `library/`, `assets/`, and `vite-env.d.ts`) is
a self-contained dashboard application. They all follow the same internal
structure described below.

## Shared Library (`src/library/`)

The `library/` directory contains reusable code shared across all dashboards.
Import using the `@library` path alias (e.g., `import { Header } from "@library/components"`).

```text
src/library/
├── components/               # Reusable UI components
│   ├── Header/               # Page header with title and breadcrumbs
│   ├── MenuBar/              # Sidebar navigation menu
│   ├── NavbarLinksGroup/     # Collapsible navigation link groups
│   ├── Page404/              # 404 error page
│   ├── Indicator/            # Status indicator badges
│   ├── Card/                 # Content card wrapper
│   ├── SectionHeader/        # Section title with optional actions
│   ├── Tabs/                 # Tab bar navigation
│   ├── Tooltip/              # Custom tooltip component
│   ├── ActionCombobox/       # Dropdown action selector
│   ├── AkselosImage/         # Image component with Akselos branding
│   ├── DataConnection/       # Data connection status display
│   ├── LoadingSkeleton/      # Loading placeholder skeleton
│   ├── ZoomableImage/        # Pannable/zoomable image viewer
│   ├── WgpuCanvas/           # GPU-accelerated 3D canvas (WebAssembly)
│   ├── wasm/                 # WebAssembly WGPU renderer bindings
│   ├── JobStatus.tsx         # Job status display
│   ├── RunJobForm.tsx        # Job submission form
│   └── index.ts              # Export aggregator
├── hooks/                    # Custom React hooks
│   ├── hook.tsx              # useView() — custom URL-based routing hook
│   ├── useElementSize.tsx    # Track element dimensions
│   ├── useResizableSidebar.tsx # Resizable sidebar logic
│   └── useWgpuUserControls.tsx # WGPU canvas interaction controls
├── charting/                 # ECharts-based charting library
│   ├── primitives/           # Base chart components (BaseChart, ChartCard, ChartToolbar)
│   ├── hooks/                # Chart-specific hooks (useChartLegend, useSquareResize)
│   ├── chartData.ts          # Chart data transformation utilities
│   ├── echartsCore.ts        # ECharts instance management
│   ├── presets.ts            # Chart style presets
│   ├── theme.ts              # Chart theme configuration
│   ├── types.ts              # Chart type definitions
│   └── index.ts              # Export aggregator
├── query/                    # React Query utilities
│   └── revokeBlobUrlsOnEviction.ts  # Cleanup blob URLs on cache eviction
└── utils/                    # General utility functions
    ├── navigation.ts         # navigateTo() — custom navigation function
    ├── datetime.ts           # Date/time formatting helpers (dayjs)
    └── storage.ts            # localStorage and cookie helpers
```

## Global Assets (`src/assets/`)

```text
src/assets/
├── icons/                    # Icon assets (e.g., axis.png)
├── images/                   # Brand images (Akselos logos, etc.)
└── sass/
    ├── styles.scss           # Main SCSS entry point (imports all partials)
    ├── base/
    │   └── _base.scss        # Base/reset styles
    ├── components/           # Styles for shared library components
    ├── pages/                # Styles for dashboard-specific pages
    │   ├── coker/            # Coker dashboard page styles
    │   ├── aiv/              # AIV dashboard page styles
    │   └── jobs_dashboard/   # Jobs dashboard page styles
    └── themes/
        └── _variables.scss   # Sass theme variables (colors, spacing, etc.)
```

New page stylesheets should be added under `sass/pages/<dashboard_name>/` and
imported in `styles.scss`.

## Dashboard Project Structure (using `coker_dashboard`)

Every dashboard follows this standard layout. The `coker_dashboard` is the
primary active dashboard and serves as the canonical example.

```text
src/coker_dashboard/
├── main.tsx                  # Application entry point
├── App.tsx                   # Root component with routing and layout
├── assets/                   # Dashboard-specific static assets
├── components/               # Dashboard-specific reusable components
├── constants/                # Constants, metadata, and configuration
├── pages/                    # Page-level components (one per route)
├── ServerCommunication/      # API service functions
├── types/                    # TypeScript type definitions
├── utils/                    # Dashboard-specific utility functions
└── zustand/                  # Client state management
```

### `main.tsx` — Entry Point

Bootstraps the React application with the required providers:

- `QueryClientProvider` — TanStack React Query for server state
- `MantineProvider` — Mantine UI theme and component context
- `Notifications` — Toast notification system

```tsx
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MantineProvider>
      <Notifications />
      <App />
    </MantineProvider>
  </QueryClientProvider>
);
```

### `App.tsx` — Root Component

Contains the application shell and routing logic:

- Renders the `MenuBar` sidebar and `Header`
- Uses the `useView()` hook to determine the current page from the
  `?view=/path` URL query parameter
- Maps view paths to page components
- Falls back to `Page404` for unknown routes

### `pages/` — Page Components

Each page is a folder containing one or more components that make up a full
view. Pages are mapped to URL paths in `App.tsx`.

```text
pages/
├── Home/                     # Landing page with overview metrics
├── ProcessMonitoring/        # Real-time sensor data and DOW status
├── ...
```

### `components/` — Dashboard-Specific Components

Reusable components that are specific to this dashboard (not shared across
dashboards). Organized by feature area.

```text
components/
├── Charts/                   # Chart components (Gauge, LineChart, etc.)
├── Crack/                    # Crack visualization (image, table)
├── ...
```

### `ServerCommunication/` — API Layer

Centralizes all HTTP calls to the FastAPI backend. Each file groups endpoints
by domain. Uses an Axios client configured in `apiClient.ts`.

```text
ServerCommunication/
├── apiClient.ts              # Axios instance with base URL configuration
├── sensor.service.ts         # Sensor data endpoints
├── ...
```

### `types/` — Type Definitions

TypeScript interfaces and types for API responses and domain objects, organized
by feature area.

```text
types/
├── common.ts                 # Shared types used across features
├── sensor.ts                 # Sensor data types
├── ...
```

### `constants/` — Configuration

Static values, metadata definitions, and display configuration.

```text
constants/
├── assetMetadata.ts          # Asset metadata definitions
├── statusColors.ts           # Color schemes for status indicators
├── tooltips.ts               # Tooltip text content
└── index.ts                  # Re-exports all constants
```

### `utils/` — Utilities

Dashboard-specific helper functions.

```text
utils/
├── chartConfig.ts            # ECharts configuration helpers
├── dowStatus.ts              # Design Operating Window status logic
└── index.ts                  # Re-exports all utilities
```

### `zustand/` — State Management

Client-side state using Zustand with the slice pattern. Each slice manages
state for one feature area.

```text
zustand/
├── store.tsx                 # Root store combining all slices + React Query hooks
└── slices/
    ├── types.ts              # Combined state type definitions
    ├── ProcessMonitorSlice.tsx
    ├── ...
```

`store.tsx` also contains TanStack React Query hooks (`useQuery` wrappers) that
call the functions from `ServerCommunication/`.

## Test Directory (`__tests__/`)

Test files mirror the source structure. Each dashboard and shared component has
its own subfolder.

```text
__tests__/
├── create-component.test.js          # Scaffolding script tests
├── create-project.test.js            # Scaffolding script tests
├── WgpuCanvas.test.tsx               # WGPU canvas component tests
├── components/
│   └── Indicator.test.tsx
├── coker_dashboard/
│   ├── Home.test.tsx
│   └── FatigueStatus/
│       └── fatigueStatusUtils.test.ts
├── ...
```

## Summary

The key architectural principles of the repository:

1. **Build-time dashboard selection** — `VITE_MY_APP` determines which dashboard
   is compiled. Only one dashboard is bundled per build.
2. **Shared library** — Common components, hooks, charting, and utilities live
   in `src/library/` and are available to all dashboards via the `@library`
   path alias.
3. **Consistent internal structure** — Every dashboard follows the same folder
   layout: `pages/`, `components/`, `ServerCommunication/`, `types/`,
   `constants/`, `utils/`, `zustand/`.
4. **Separation of concerns** — API calls, state management, types, and UI are
   kept in separate directories within each dashboard.
5. **Backend pairing** — Each dashboard in `src/<name>/` has a corresponding
   FastAPI backend in `../backends/<name>/`. The build output goes directly
   into the backend's `dist/` folder.
