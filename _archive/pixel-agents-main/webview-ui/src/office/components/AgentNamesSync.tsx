import React from 'react';

import { AGENT_NAMES_POLL_MS, API_AGENT_NAMES } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';

interface AgentNamesSyncProps {
  officeState: OfficeState;
}

/**
 * Name-file convention (standalone): polls GET /api/agent-names — a flat
 * `{ "<agentId or folderName>": "<name>" }` map read from
 * `~/.pixel-agents/agent-names.json` — and applies each name to the matching
 * LIVE agent's label (shown above the head via ToolOverlay + in the Activity
 * feed). Authored roleplay NPCs (which carry their own cast name) are skipped.
 * Renders nothing.
 */
export const AgentNamesSync: React.FC<AgentNamesSyncProps> = ({ officeState }) => {
  React.useEffect(() => {
    let cancelled = false;

    const apply = async () => {
      try {
        const res = await fetch(API_AGENT_NAMES);
        if (!res.ok) return;
        const names = (await res.json()) as Record<string, string>;
        if (cancelled) return;
        for (const [id, ch] of officeState.characters.entries()) {
          if (ch.isNpc) continue; // NPCs keep their authored cast name
          const name = names[String(id)] ?? (ch.folderName ? names[ch.folderName] : undefined);
          if (name) ch.agentName = name;
        }
      } catch {
        // Server unreachable / bad JSON — try again next tick.
      }
    };

    void apply();
    const interval = setInterval(() => void apply(), AGENT_NAMES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [officeState]);

  return null;
};
