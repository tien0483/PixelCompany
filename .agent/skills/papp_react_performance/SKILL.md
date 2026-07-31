---
name: papp_react_performance
description: React performance optimization guidelines for Papp frontend (Vite/React). This skill should be used when writing, reviewing, or refactoring React code to ensure optimal performance patterns. Triggers on tasks involving React components, data fetching, or performance improvements in Papp.
license: MIT
metadata:
  version: "1.0.0"
---

# Papp React Performance Best Practices

Comprehensive performance optimization guide for React applications built with Vite in the Papp framework. Contains rules prioritized by impact to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:
- Writing new React components for Papp frontend
- Implementing client-side data fetching
- Reviewing code for performance issues
- Refactoring existing React code
- Optimizing bundle size or load times
- Structuring components according to AKS-20855 guidelines

## Papp Frontend Structural Rules (AKS-20855)

The structural integrity of Papp applications relies on strict separation between dashboard-specific components and shared library components.

For concrete coding examples showing correct file locations, styling conventions, and module exports according to AKS-20855, please refer to:
👉 `rules/architecture-aks-20855.md`

## Rule Categories by Priority

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Client-Side Data Fetching | HIGH |
| 2 | Re-render Optimization | MEDIUM |
| 3 | Rendering Performance | MEDIUM |
| 4 | JavaScript Performance | LOW-MEDIUM |

## How to Use

Read the individual rule files located in the `rules/` subdirectory for detailed explanations and code examples.

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

You must strictly follow the rules in the `rules/` directory when performing React UI refactoring for Papps.
