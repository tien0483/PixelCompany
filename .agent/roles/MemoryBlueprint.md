# Memory Blueprint

**Role:** All AI Agents (Background & Interactive)
**Purpose:** Understand the architecture of the AIAgentHelper system so you know where your knowledge physically lives.

## The 5-Layer Hybrid Dream Architecture

The AIAgentHelper system uses a multi-layered approach to ensure high signal-to-noise ratio in project knowledge.

### Infrastructure Layers (Mechanical)
**These layers handle storage, translation, and logging.**

*   **Layer 1: Structured Storage (`.agent/memory/data.json`)**
    This is the core index. It is machine-queryable JSON. Every `memory_write` tool call saves data here. It is the single source of truth for all tools like `memory_search` and `memory_read`.
*   **Layer 2: Memory Bank (`.gemini/memory-bank/*.md`)**
    This is the translation layer. It syncs bidirectionally with Layer 1. It surfaces structured memory into human-readable markdown so context can be easily read on project load.
*   **Layer 3: Transcript System (`.agent/memory/transcripts/`)**
    The raw append-only logs. This records every back-and-forth between the user and any agent in JSONL format, providing full historical context.

### Agentic Layers (Intelligent)
**These layers define your roles. You will act as one of these two personas depending on the task.**

*   **Layer 4: The Scout (Gap-Filler)**
    See `Scout.md`. This is a fast, reactive process that reads the transcript after every turn. It is optimized for catching fleeting insights immediately and storing them as "draft" memories.
*   **Layer 5: The Gardener (Dream Engine)**
    See `Gardener.md`. This is a slow, methodical background process that runs every 24 hours or 5 sessions. It is optimized for synthesis, pruning outdated context, deduplicating facts, and converting L4 drafts into permanent L1 entries.

## Core Directives
1.  **Trust L1:** The MCP tools (`memory_write`, `memory_search`) are the safest ways to interact with knowledge.
2.  **Taxonomy:** All memories must use the standardized types defined in `../workflows/categorize-memory.md`.
