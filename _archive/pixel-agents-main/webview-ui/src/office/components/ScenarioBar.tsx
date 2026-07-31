import React from 'react';

import {
  API_RECORD_START,
  API_RECORD_STATUS,
  API_RECORD_STOP,
  API_SCENARIOS,
  RECORD_STATUS_POLL_MS,
  SCENARIO_REPLAY_PARAM,
  SCENARIO_ROLEPLAY_PARAM,
} from '../../constants.js';
import { ScriptEditor } from './ScriptEditor.js';

interface ScenarioInfo {
  name: string;
  kind: string;
}

interface RecordStatus {
  recording: boolean;
  name: string | null;
}

/**
 * Standalone-only control bar (top-left) to RUN a saved scenario or RECORD a
 * roleplay — no URL params or env vars (FIX-10). Talks to the server over plain
 * HTTP (/api/scenarios, /api/record/*), never the WebSocket/AsyncAPI protocol.
 * Mounted from App.tsx only in the browser runtime and only when not already
 * replaying (a ReplayTransport gets ReplayControls instead).
 */
export const ScenarioBar: React.FC<{ onOpenPainter?: () => void }> = ({ onOpenPainter }) => {
  const [scenarios, setScenarios] = React.useState<ScenarioInfo[]>([]);
  const [listOpen, setListOpen] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [recordName, setRecordName] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);

  const loadScenarios = React.useCallback(async () => {
    try {
      const res = await fetch(API_SCENARIOS);
      if (!res.ok) return;
      setScenarios((await res.json()) as ScenarioInfo[]);
    } catch {
      // Server unreachable — leave the list as-is.
    }
  }, []);

  // Poll recording status so the REC indicator stays in sync (e.g. an env-var
  // recording started at boot, or a stop initiated elsewhere).
  React.useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(API_RECORD_STATUS);
        if (!res.ok) return;
        const status = (await res.json()) as RecordStatus;
        if (!cancelled) {
          setRecording(status.recording);
          setRecordName(status.name);
        }
      } catch {
        // ignore transient errors; next tick retries
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), RECORD_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleToggleList = React.useCallback(() => {
    setListOpen((open) => {
      const next = !open;
      if (next) void loadScenarios();
      return next;
    });
  }, [loadScenarios]);

  const handlePlay = React.useCallback((scenario: ScenarioInfo) => {
    const param =
      scenario.kind === 'roleplay' ? SCENARIO_ROLEPLAY_PARAM : SCENARIO_REPLAY_PARAM;
    // Navigating with the query param rebuilds the transport as a ReplayTransport.
    window.location.search = `?${param}=${encodeURIComponent(scenario.name)}`;
  }, []);

  const handleDelete = React.useCallback(
    async (name: string) => {
      if (!window.confirm(`Delete scenario "${name}"?`)) return;
      try {
        await fetch(`${API_SCENARIOS}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      } catch {
        return;
      }
      void loadScenarios();
    },
    [loadScenarios],
  );

  const handleRecordToggle = React.useCallback(async () => {
    if (recording) {
      try {
        await fetch(API_RECORD_STOP, { method: 'POST' });
      } catch {
        return;
      }
      setRecording(false);
      setRecordName(null);
      return;
    }
    const name = window.prompt('Name this recording:');
    if (!name) return;
    try {
      const res = await fetch(API_RECORD_START, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        window.alert('Could not start recording (invalid name or already recording).');
        return;
      }
      setRecording(true);
      setRecordName(name);
    } catch {
      // ignore; status poll will reconcile
    }
  }, [recording]);

  return (
    <div className="absolute top-8 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 items-center font-pixel text-text">
      <div className="flex gap-2 items-center">
        <button
          onClick={handleToggleList}
          className="bg-bg border-2 border-border rounded-none shadow-pixel px-3 py-2 text-xs text-text cursor-pointer hover:text-accent-bright"
        >
          Scenarios ▾
        </button>
        <button
          onClick={() => void handleRecordToggle()}
          className="bg-bg border-2 border-border rounded-none shadow-pixel px-3 py-2 text-xs text-text cursor-pointer hover:text-accent-bright"
        >
          {recording ? '■ Stop' : '● Record'}
        </button>
        <button
          onClick={() => setEditorOpen(true)}
          className="bg-bg border-2 border-border rounded-none shadow-pixel px-3 py-2 text-xs text-text cursor-pointer hover:text-accent-bright"
        >
          Script
        </button>
        {onOpenPainter && (
          <button
            onClick={onOpenPainter}
            title="Generate a sprite with the AI pixel painter (Texel engine)"
            className="bg-bg border-2 border-border rounded-none shadow-pixel px-3 py-2 text-xs text-accent-bright cursor-pointer hover:text-text"
          >
            Paint
          </button>
        )}
        {recording && (
          <span className="bg-bg border-2 border-border rounded-none shadow-pixel px-2 py-1 text-xs text-danger">
            ● REC{recordName ? ` ${recordName}` : ''}
          </span>
        )}
      </div>

      {listOpen && (
        <div className="bg-bg border-2 border-border rounded-none shadow-pixel w-[220px] max-h-[300px] overflow-y-auto flex flex-col">
          {scenarios.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">No scenarios found</div>
          ) : (
            scenarios.map((s) => (
              <div
                key={s.name}
                className="flex items-center border-b-2 border-border last:border-b-0"
              >
                <button
                  onClick={() => handlePlay(s)}
                  className="flex-1 text-left px-3 py-2 text-xs text-text cursor-pointer hover:text-accent-bright"
                >
                  {s.name}
                  <span className="text-text-muted"> ({s.kind})</span>
                </button>
                <button
                  onClick={() => void handleDelete(s.name)}
                  title="Delete scenario"
                  className="px-3 py-2 text-xs text-danger cursor-pointer hover:text-text"
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <ScriptEditor isOpen={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
};
