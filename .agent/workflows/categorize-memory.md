---
description: How to categorize memories into the standard taxonomy.
---
# Categorize Memory Taxonomy

Whenever you use the `memory_write` tool, or extract a draft memory, you MUST assign one of the following exactly matching `type` strings. Use this decision tree:

## 1. `bug`
*   **Description:** A defect, error, crash, or unexpected behavior, and how it was resolved.
*   **Criteria:** Does this describe a problem that was fixed? Includes root causes and workarounds.

## 2. `architecture`
*   **Description:** High-level system design, cross-component structural flows, or foundational data models.
*   **Criteria:** Does this affect how multiple parts of the system talk to each other?

## 3. `pattern`
*   **Description:** Reusable code solutions, conventions, or standard practices specific to this repository.
*   **Criteria:** Is this a "how-to" guide for writing future code? (e.g., "Use this specific React hook for data fetching").

## 4. `decision`
*   **Description:** Trade-offs, tool selections, and the "Why" behind an approach.
*   **Criteria:** Explain why X was chosen over Y. Key considerations and rationales.

## 5. `api`
*   **Description:** Contracts, endpoint definitions, data schemas, or interface boundaries.
*   **Criteria:** Does this define how external clients or internal modules invoke resources?

## 6. `feature`
*   **Description:** Functional capabilities, user stories, or product behavior.
*   **Criteria:** If it describes what the user sees or does, or a product requirement, use this.

---
**Note:** Do NOT invent new types. Stick strictly to these 6 strings for the `type` field. Use the `tags` array field for more granular sub-categorization (e.g., `["frontend", "react", "navbar"]`).
