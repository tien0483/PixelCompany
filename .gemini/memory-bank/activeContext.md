# Active Context

## ⚠️ MANDATORY SESSION INIT

At the start of EVERY SINGLE SESSION, you MUST execute the following tool call to restore your context:

> **Action Required:** Call `memory_search({ query: "recent progress active context", limit: 5 })` immediately.

## Project Memory System

### AIAgentHelper (REQUIRED SYSTEM)

This project relies entirely on the `AIAgentHelper` MCP tools for persistent knowledge management across sessions. You do not have a continuous memory otherwise.

#### Active Skills (Enabled by Default)

*   **🦖 CAVEMAN:FULL**
    By default, you operate in Caveman Full mode:
    - Terse, high-signal language.
    - Code and identifiers stay byte-for-byte identical.
    - Reference: **[.agent/skills/caveman/SKILL.md](file:///.agent/skills/caveman/SKILL.md)**.

#### Available MCP Tools
- `memory_search({ query, tags, type, limit })` - Search memories  
- `memory_write({ key, type, content, tags })` - Save memory
- `memory_read({ key })` - Get specific memory

#### Required Development Pattern
1. **Restore Context:** ALWAYS search memory at the start of a session.
2. **Query First:** `memory_search()` before writing code or modifying architecture.
3. **Document Always:** `memory_write()` immediately after making a significant decision, fixing a bug, or completing a feature.

**FAILURE TO USE THESE TOOLS MEANS YOUR WORK WILL BE LOST.**
