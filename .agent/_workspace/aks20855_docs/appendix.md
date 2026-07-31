# Appendix

```{admonition} Author
For more information, please contact
<a href="mailto:xuanhoang.nguyen@akselos.com" target="_blank">Hoang Nguyen</a>
```

## Installing new Frontend Dependencies

Every new dependency should be examined before allowing its usage. Please follow the procedure described [here](/src/guidelines/dependencies.md#add-a-new-python-package) to get a new dependency approved.

### Install the Package

Once approved, install the dependency from the ``dashboard/papps/frontends/``
directory:

```bash
# Production dependency
npm install <package_name>

# Development-only dependency (test tools, linters, type stubs, etc.)
npm install --save-dev <package_name>
```

Commit both ``package.json`` and ``package-lock.json`` together in the same
commit.

## Scaffolding a Component with ``create-component``

The ``create-component`` script generates a ready-to-use React component
inside an existing dashboard project. It creates the component file and a
barrel ``index.ts`` so imports stay stable even if the internal file is
renamed later.

### Usage

From the ``dashboard/papps/frontends/`` directory:

```bash
npm run create-component <project_name> <ComponentName>
```

For example:

```bash
npm run create-component coker_dashboard StatusBanner
```

### Naming Rules

- The **project name** is the snake_case dashboard folder under ``src/``
  (e.g. ``coker_dashboard``). The project must already exist.
- The **component name** must be **PascalCase**: start with an uppercase
  letter, followed by letters or digits only.
  Pattern: ``^[A-Z][A-Za-z0-9]*$``.

Valid examples: ``StatusBanner``, ``DataTable``, ``Chart3D``

Invalid examples: ``status_banner``, ``dataTable``, ``my-component``

### Generated Files

The script creates a folder under ``src/<project>/components/``:

```text
src/<project>/components/<ComponentName>/
├── <ComponentName>.tsx     # Default-exported React.FC with a Props interface
└── index.ts                # Barrel: export { default as <ComponentName> } from "./<ComponentName>"
```

**``<ComponentName>.tsx``** — a minimal functional component with an optional
``className`` prop:

```tsx
import React from "react";

interface StatusBannerProps {
  className?: string;
}

const StatusBanner: React.FC<StatusBannerProps> = ({ className }) => {
  return <div className={className}>StatusBanner</div>;
};

export default StatusBanner;
```

**``index.ts``** — barrel export so consumers import by folder name:

```typescript
export { default as StatusBanner } from "./StatusBanner";
```

### Importing the Component

Use the barrel export for a stable import path:

```typescript
import { StatusBanner } from "../../components/StatusBanner";
```

### When Not to Use This Script

If a component is only used by a single page, co-locate it next to that page
under ``pages/<Page>/`` instead of creating a shared component. Reserve the
``components/`` directory for widgets reused across multiple pages.
