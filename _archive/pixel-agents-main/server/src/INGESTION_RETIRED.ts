/**
 * RETIRED — Pixel Agents agent-activity ingestion.
 *
 * Kanban is now the single source of truth for agent activity. The office view
 * reads RuntimeTaskSessionSummary from Kanban's state stream; it does not watch
 * Claude Code JSONL transcripts or install its own hooks.
 *
 * These modules are kept only as historical reference and must not be started:
 * - providers/hook/claude/*
 * - fileWatcher.ts
 * - transcriptParser.ts
 * - sessionRouter.ts
 *
 * claude-jacked's additive hooks (session_account_tracker, memory_capture,
 * memory_recall, qa_suggest) remain installed alongside Kanban's hooks.ingest
 * commands. See kanban/src/doctor/hooks-coexistence.ts.
 */
export const PIXEL_AGENTS_INGESTION_RETIRED = true;
