# Technology Stack

```{admonition} Author
For more information, please contact
<a href="mailto:xuanhoang.nguyen@akselos.com" target="_blank">Hoang Nguyen</a>
```

This page describes the technology stack used in Papp frontend development.
All Papp front ends are built from a single shared codebase located at
`dashboard/papps/frontends/`. The active dashboard is selected at build time
via the `VITE_MY_APP` environment variable.

## Build Tooling

| Tool                                          | Version | Purpose                                                 |
|-----------------------------------------------|---------|---------------------------------------------------------|
| [Vite](https://vite.dev/)                     | 6.x     | Development server with HMR, production bundler         |
| [TypeScript](https://www.typescriptlang.org/) | 5.7     | Static type checking (strict mode enabled)              |
| [ESLint](https://eslint.org/)                 | 9.x     | Code linting with React Hooks and React Refresh plugins |
| [Vitest](https://vitest.dev/)                 | 4.x     | Unit testing framework                                  |
| [Sass](https://sass-lang.com/)                | 1.x     | CSS preprocessor                                        |
| [PostCSS](https://postcss.org/)               | 8.x     | CSS transformations (with Mantine preset)               |

Vite uses the `@vitejs/plugin-react` plugin with Babel for Fast Refresh during
development. The build target is ES2022.

## UI Framework

| Library                                 | Version | Purpose                             |
|-----------------------------------------|---------|-------------------------------------|
| [React](https://react.dev/)             | 19.x    | UI component library                |
| [Mantine](https://mantine.dev/)         | 8.x     | Component library and design system |
| [Tabler Icons](https://tabler.io/icons) | 3.x     | Icon set                            |

Mantine provides the `MantineProvider` at the application root and is used for
layout, forms, notifications, and date pickers via separate packages:
`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/dates`, and
`@mantine/notifications`.

## State Management

| Library                                             | Version | Purpose                                         |
|-----------------------------------------------------|---------|-------------------------------------------------|
| [Zustand](https://zustand.docs.pmnd.rs/)            | 5.x     | Client-side state management                    |
| [Immer](https://immerjs.github.io/immer/)           | 10.x    | Immutable state updates                         |
| [TanStack React Query](https://tanstack.com/query/) | 5.x     | Server/async state management and data fetching |

Client state is managed with Zustand using the slice pattern. All mutations use
Immer's `produce()` for immutability. Redux DevTools middleware is enabled in
development mode for debugging.

Server state and data fetching are handled by TanStack React Query, which
provides caching, background refetching, and query invalidation out of the box.

## Data Visualization

| Library                                                          | Version | Purpose                         |
|------------------------------------------------------------------|---------|---------------------------------|
| [ECharts](https://echarts.apache.org/)                           | 5.x     | Charting and data visualization |
| [echarts-for-react](https://github.com/hustcc/echarts-for-react) | 3.x     | React wrapper for ECharts       |

## HTTP & Utilities

| Library                          | Version | Purpose                           |
|----------------------------------|---------|-----------------------------------|
| [Axios](https://axios-http.com/) | 1.x     | HTTP client for API communication |
| [dayjs](https://day.js.org/)     | 1.x     | Date formatting and manipulation  |

API functions are centralized in a `ServerCommunication/` directory within each
dashboard. The front end communicates with its corresponding FastAPI backend
using relative URL paths.

## Routing

Papp front ends do **not** use React Router. Instead, a custom `useView()` hook
reads a `?view=/path` query parameter from the URL. Navigation is performed via
a `navigateTo(href)` utility that pushes browser history state and dispatches a
custom `locationchange` event. This approach exists because the app runs inside
the Portal, which does not support WebSockets required by client-side routers.

## Styling

Styles are written in Sass/SCSS with a forwarding pattern. A central
`src/assets/sass/styles.scss` file imports all page-specific and shared
stylesheets. Mantine's PostCSS preset (`postcss-preset-mantine`) and
`postcss-simple-vars` are used for Mantine-specific CSS variable handling.

## TypeScript Configuration

TypeScript is configured with strict mode and the following key settings:

- **Target**: ESNext (Vite handles browser compatibility)
- **Module resolution**: `bundler` (modern standard for Vite)
- **Strict checks**: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **Path aliases**: `src/*` maps to `./src/*`, `@library/*` maps to `./src/library/*`

## Testing

Tests are powered by Vitest with jsdom as the test environment. Testing
utilities include `@testing-library/react` and `@testing-library/jest-dom`.
Test files are located in the `__tests__/` directory and are picked up
automatically by file extension (`.test.js` or `.test.ts`).

```bash
# Single run
npm test

# Watch mode
npm run test:watch
```

## Build Commands

```bash
npm run dev          # Start Vite dev server with HMR
npm run build        # TypeScript check + production build
npm run build:dev    # Continuous watch mode build
npm run lint         # ESLint validation
npm run preview      # Preview production build locally
```

The build output is written directly to the corresponding backend's `dist/`
folder at `../backends/<VITE_MY_APP>/dist`.
