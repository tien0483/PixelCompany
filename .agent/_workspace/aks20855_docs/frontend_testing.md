# Frontend Testing

```{admonition} Author
For more information, please contact
<a href="mailto:xuanhoang.nguyen@akselos.com" target="_blank">Hoang Nguyen</a>
```

This guide covers how to write and run tests for the Papp frontend codebase.
Tests live in `dashboard/papps/frontends/__tests__/` and are powered by
[Vitest](https://vitest.dev/) with [Testing Library](https://testing-library.com/docs/react-testing-library/intro/).

## Test Stack

| Library | Purpose |
|---|---|
| [Vitest](https://vitest.dev/) 4.x | Test runner (Vite-native) |
| [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) 16.x | Component rendering and DOM queries |
| [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) 6.x | DOM matchers (`toBeInTheDocument`, `toHaveStyle`, etc.) |
| [jsdom](https://github.com/jsdom/jsdom) 28.x | Default browser environment |
| [happy-dom](https://github.com/nicedoc/happy-dom) 20.x | Alternative lightweight DOM (opt-in per file) |

## Running Tests

From the `dashboard/papps/frontends/` directory:

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file change)
npm run test:watch

# Run a specific test file
npx vitest run __tests__/coker_dashboard/Home.test.tsx

# Run tests matching a name pattern
npx vitest run -t "computeTotalDamage"

# Run all tests in a dashboard folder
npx vitest run __tests__/coker_dashboard/
```

## Test Configuration

### Vitest Config

The test configuration is defined in `vite.config.ts`:

```typescript
test: {
  environment: "jsdom",
  globals: true,
  setupFiles: "./vitest.setup.ts",
}
```

- **`environment: "jsdom"`** — simulates a browser DOM.
- **`globals: true`** — `describe`, `it`, `expect`, `vi` are available
  globally without imports.
- **`setupFiles`** — runs `vitest.setup.ts` before every test file.

### Setup File (`vitest.setup.ts`)

Loads jest-dom matchers and polyfills APIs that Mantine components require:

```typescript
import "@testing-library/jest-dom/vitest";

// Mantine's ScrollArea and responsive components need these in jsdom.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
```

### TypeScript Config (`tsconfig.test.json`)

Extends the main `tsconfig.json` and includes the `__tests__/` directory:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src", "__tests__", "vitest.setup.ts"]
}
```

## Test Directory Structure

Test files mirror the source directory layout. For each dashboard under
`src/<dashboard_name>/`, tests go in `__tests__/<dashboard_name>/`.

```text
__tests__/
├── components/                             # Shared library component tests
│   └── Indicator.test.tsx
├── coker_dashboard/                        # Coker dashboard tests
│   ├── Home.test.tsx
│   └── FatigueStatus/
│       └── fatigueStatusUtils.test.ts
├── jobs_dashboard/                         # Jobs dashboard tests
│   ├── Home.test.tsx
│   ├── JobsTable.test.tsx
│   └── LogViewerModal.test.tsx
├── reactor_time_series_dashboard/          # Reactor time series tests
│   ├── HistoryTable.test.tsx
│   └── simulation.service.test.tsx
├── demo_ai_dashboard/
│   └── messageParts.test.tsx
├── WgpuCanvas.test.tsx                     # WGPU canvas + Zustand tests
├── create-project.test.js                  # Scaffolding script tests
└── create-component.test.js                # Component scaffolding tests
```

## Writing Tests

### Pure Utility Functions

The simplest pattern. Import the real function and assert its output.

```typescript
import { describe, it, expect } from "vitest";
import { formatSummaryValue } from "src/my_dashboard/pages/Home/homeUtils";

describe("formatSummaryValue", () => {
  it("formats a finite number to two decimal places", () => {
    expect(formatSummaryValue(3.14159)).toBe("3.14");
  });

  it("returns dash for non-finite values", () => {
    expect(formatSummaryValue(NaN)).toBe("-");
    expect(formatSummaryValue(Infinity)).toBe("-");
  });
});
```

**Tips:**

- Use factory functions to build test data with sensible defaults:

  ```typescript
  function makeRow(partial: Partial<FatigueResult>): FatigueResult {
    return {
      id: "id", rank: 1, cycle_id: 1, x: 0, y: 0, z: 0,
      ...partial,
    };
  }
  ```

- Use `toBeCloseTo(n, digits)` for floating-point comparisons.
- Test edge cases: `null`, empty arrays, boundary values.

### React Components with Mocked Hooks

Most page components depend on hooks from `zustand/store.tsx`. Mock these
hooks so the component can be tested in isolation.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

// 1. Mock the store module BEFORE importing the component.
//    vi.mock() is hoisted to the top of the file by Vitest.
vi.mock("src/my_dashboard/zustand/store", () => ({
  useExampleSummary: vi.fn(),
  useHomeUi: vi.fn(),
  useHomeActions: vi.fn(),
}));

// 2. Import the mocked hooks and the component under test.
import {
  useExampleSummary,
  useHomeUi,
  useHomeActions,
} from "src/my_dashboard/zustand/store";
import Home from "src/my_dashboard/pages/Home/Home";

// 3. Get typed mock references.
const mockUseExampleSummary = vi.mocked(useExampleSummary);
const mockUseHomeUi = vi.mocked(useHomeUi);
const mockUseHomeActions = vi.mocked(useHomeActions);

// 4. Render helper — always wrap with MantineProvider.
function renderHome() {
  return render(
    <MantineProvider>
      <Home />
    </MantineProvider>,
  );
}

// 5. Set up mock return values.
function setLoadedMocks() {
  mockUseExampleSummary.mockReturnValue({
    summary: { title: "Status", value: 42, status: "ok" },
    isSummaryLoading: false,
  });
  mockUseHomeUi.mockReturnValue({ activeView: "overview" });
  mockUseHomeActions.mockReturnValue({ setActiveView: vi.fn() });
}

function setLoadingMocks() {
  mockUseExampleSummary.mockReturnValue({
    summary: { title: "", value: 0, status: "" },
    isSummaryLoading: true,
  });
  mockUseHomeUi.mockReturnValue({ activeView: "overview" });
  mockUseHomeActions.mockReturnValue({ setActiveView: vi.fn() });
}

// 6. Tests.
describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the summary value when loaded", () => {
    setLoadedMocks();
    renderHome();
    expect(screen.getByText("42.00")).toBeInTheDocument();
  });

  it("shows a placeholder while loading", () => {
    setLoadingMocks();
    renderHome();
    expect(screen.getByText("...")).toBeInTheDocument();
  });
});
```

**Key conventions:**

- `vi.mock()` calls are hoisted — place them before any imports from the
  mocked module.
- Always wrap rendered components with `<MantineProvider>`.
- Use `vi.clearAllMocks()` in `beforeEach` to reset call history.
- Create `setLoadedMocks()` / `setLoadingMocks()` helpers for readable tests.
- Use `screen.getByText()` or `screen.getByRole()` when the element must
  exist; use `screen.queryByText()` when asserting it does not exist.

### User Interactions

Use `fireEvent` for clicks, keyboard events, and input changes. Use
`waitFor` when a state update is asynchronous.

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

it("opens the modal when the button is clicked", async () => {
  setLoadedMocks();
  renderComponent();

  const button = screen.getByRole("button", { name: "View log" });
  fireEvent.click(button);

  await waitFor(() => {
    expect(screen.getByText("Log: job-123")).toBeInTheDocument();
  });
});

it("responds to keyboard navigation", () => {
  const onClick = vi.fn();
  renderComponent({ onClick });

  const card = screen.getByRole("button");
  fireEvent.keyDown(card, { key: "Enter" });
  expect(onClick).toHaveBeenCalledTimes(1);
});
```

### API Service Functions

Mock the Axios client to test service functions without making real HTTP
calls.

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock the axios instance BEFORE importing the service.
vi.mock("src/my_dashboard/ServerCommunication/apiClient", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from "src/my_dashboard/ServerCommunication/apiClient";
import { fetchExampleSummary } from "src/my_dashboard/ServerCommunication/example.service";

const mockGet = vi.mocked(apiClient.get);

describe("fetchExampleSummary", () => {
  it("calls the correct endpoint and unwraps .data", async () => {
    const data = { title: "Status", value: 42, status: "ok" };
    mockGet.mockResolvedValue({ data } as never);

    const result = await fetchExampleSummary();

    expect(mockGet).toHaveBeenCalledWith("example/summary");
    expect(result).toEqual(data);
  });
});
```

### Zustand Store State

Test Zustand stores by calling actions and asserting on state directly. Wrap
state mutations in `act()`.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useAppStore } from "src/my_dashboard/zustand/store";

describe("HomeSlice", () => {
  beforeEach(() => {
    // Reset state between tests.
    useAppStore.setState({ activeView: "overview" });
  });

  it("updates activeView via setActiveView", () => {
    act(() => {
      useAppStore.getState().homeActions.setActiveView("details");
    });
    expect(useAppStore.getState().activeView).toBe("details");
  });
});
```

### Shared Library Components

Components from `src/library/` are imported via the `@library` alias.

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Indicator } from "@library/components";

function renderIndicator(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("Indicator", () => {
  it("renders the title", () => {
    renderIndicator(<Indicator title="TEMPERATURE" />);
    expect(screen.getByText("TEMPERATURE")).toBeInTheDocument();
  });

  it("applies color as inline style on Value", () => {
    renderIndicator(
      <Indicator title="STATUS">
        <Indicator.Value color="#e89d22">WARNING</Indicator.Value>
      </Indicator>,
    );
    expect(screen.getByText("WARNING")).toHaveStyle({ color: "#e89d22" });
  });
});
```

## Path Aliases in Tests

The Vite path aliases work inside test files. Use the same import paths as
production code:

```typescript
// Source alias
import Home from "src/coker_dashboard/pages/Home/Home";

// Library alias
import { Header } from "@library/components";
```

## Using happy-dom Per File

To opt a single test file into happy-dom instead of jsdom, add a comment at
the top of the file:

```typescript
// @vitest-environment happy-dom
```

## Quick Reference

### Available Matchers

**Vitest core:**

- `toBe()`, `toEqual()`, `toStrictEqual()`
- `toBeCloseTo(n, digits)` for floats
- `toContain()`, `toHaveLength()`
- `toThrow()`, `toMatch(regex)`
- `.not` for negation

**jest-dom (loaded in setup):**

- `toBeInTheDocument()`
- `toHaveTextContent(text)`
- `toHaveAttribute(attr, value)`
- `toBeVisible()`, `toBeDisabled()`
- `toHaveStyle({ color: "red" })`

### Mocking

```typescript
vi.fn()                           // Create a mock function
vi.mock("module/path", () => ({}))// Mock an entire module
vi.mocked(fn)                     // Get a typed mock reference
vi.spyOn(obj, "method")           // Spy on an object method
vi.clearAllMocks()                // Reset call history for all mocks
mockFn.mockReturnValue(val)       // Set synchronous return value
mockFn.mockResolvedValue(val)     // Set async return value (Promise.resolve)
```
