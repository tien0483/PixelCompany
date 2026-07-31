import { useState } from 'react';

import type { Scenario } from '../../../../core/src/scenario.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import {
  API_SCENARIOS,
  PALETTE_COUNT,
  ROLEPLAY_ACTIONS,
  SCENARIO_NAME_PATTERN,
  SCENARIO_ROLEPLAY_PARAM,
  SCRIPT_EDITOR_SCHEMA_VERSION,
  SCRIPT_ROW_TIME_STEP_MS,
} from '../../constants.js';

type ActionName = (typeof ROLEPLAY_ACTIONS)[number];

interface CastRow {
  id: string;
  name: string;
  palette: number;
  hueShift: number;
}

/** One editable script step. All arg fields are kept flat; only those relevant
 *  to the selected `action` are rendered and emitted. */
interface ScriptRow {
  tMs: number;
  actor: string;
  action: ActionName;
  col: number;
  row: number;
  text: string;
  seatId: string;
}

interface ScriptEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

const INITIAL_CAST: CastRow[] = [
  { id: 'alice', name: 'Alice', palette: 0, hueShift: 0 },
  { id: 'bob', name: 'Bob', palette: 3, hueShift: 0 },
];

const INITIAL_SCRIPT: ScriptRow[] = [
  { tMs: 0, actor: 'alice', action: 'spawn', col: 0, row: 0, text: '', seatId: '' },
];

const INPUT_CLASS = 'bg-bg-dark border-2 border-border rounded-none px-2 py-1 text-xs text-text';

/** Assemble the on-disk Scenario from the form rows. */
function buildScenario(name: string, cast: CastRow[], script: ScriptRow[]): Scenario {
  return {
    schemaVersion: SCRIPT_EDITOR_SCHEMA_VERSION,
    name,
    kind: 'roleplay',
    cast: cast.map((c) => ({
      id: c.id,
      name: c.name,
      palette: c.palette,
      ...(c.hueShift ? { hueShift: c.hueShift } : {}),
    })),
    script: script.map((s) => {
      const step: NonNullable<Scenario['script']>[number] = {
        tMs: s.tMs,
        actor: s.actor,
        action: s.action,
      };
      if (s.action === 'walkTo') step.args = { col: s.col, row: s.row };
      else if (s.action === 'say') step.args = { text: s.text };
      else if (s.action === 'sit' && s.seatId) step.args = { seatId: s.seatId };
      return step;
    }),
  };
}

/** Best-effort conversion of a parsed Scenario back into editable form rows. */
function scenarioToRows(s: Scenario): { cast: CastRow[]; script: ScriptRow[] } {
  const cast = (s.cast ?? []).map((c) => ({
    id: c.id ?? '',
    name: c.name ?? '',
    palette: c.palette ?? 0,
    hueShift: c.hueShift ?? 0,
  }));
  const script = (s.script ?? []).map((step) => {
    const args = (step.args ?? {}) as {
      col?: number;
      row?: number;
      text?: string;
      seatId?: string;
    };
    return {
      tMs: step.tMs ?? 0,
      actor: step.actor ?? '',
      action: (step.action ?? 'spawn') as ActionName,
      col: args.col ?? 0,
      row: args.row ?? 0,
      text: args.text ?? '',
      seatId: args.seatId ?? '',
    };
  });
  return { cast, script };
}

/** Validate a scenario + its target filename. Returns an error string, or null. */
function validateScenario(name: string, s: Scenario): string | null {
  if (!SCENARIO_NAME_PATTERN.test(name)) {
    return 'Name may contain only letters, digits, underscore and hyphen.';
  }
  if (s.kind !== 'roleplay') return 'kind must be "roleplay".';
  const cast = s.cast ?? [];
  if (cast.length === 0) return 'Add at least one cast member.';
  const ids = new Set<string>();
  for (const c of cast) {
    if (!c.id) return 'Every cast member needs an id.';
    if (ids.has(c.id)) return `Duplicate cast id "${c.id}".`;
    ids.add(c.id);
  }
  let prev = -Infinity;
  for (const step of s.script ?? []) {
    if (step.tMs < prev) return 'Script steps must be in ascending time order (tMs).';
    prev = step.tMs;
    if (!ids.has(step.actor)) return `Script actor "${step.actor}" is not in the cast.`;
  }
  return null;
}

export function ScriptEditor({ isOpen, onClose }: ScriptEditorProps) {
  const [name, setName] = useState('my-scene');
  const [cast, setCast] = useState<CastRow[]>(INITIAL_CAST);
  const [script, setScript] = useState<ScriptRow[]>(INITIAL_SCRIPT);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  if (!isOpen) return null;

  const updateCast = (i: number, patch: Partial<CastRow>) =>
    setCast((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateScript = (i: number, patch: Partial<ScriptRow>) =>
    setScript((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addCast = () =>
    setCast((rows) => [...rows, { id: '', name: '', palette: 0, hueShift: 0 }]);
  const removeCast = (i: number) => setCast((rows) => rows.filter((_, idx) => idx !== i));

  const addScript = () =>
    setScript((rows) => {
      const lastMs = rows.length > 0 ? rows[rows.length - 1].tMs : 0;
      return [
        ...rows,
        {
          tMs: rows.length > 0 ? lastMs + SCRIPT_ROW_TIME_STEP_MS : 0,
          actor: cast[0]?.id ?? '',
          action: 'spawn',
          col: 0,
          row: 0,
          text: '',
          seatId: '',
        },
      ];
    });
  const removeScript = (i: number) => setScript((rows) => rows.filter((_, idx) => idx !== i));

  // Toggle between the form and the raw-JSON power path, syncing state across.
  const toggleRaw = () => {
    setError('');
    if (!rawMode) {
      setRawText(JSON.stringify(buildScenario(name, cast, script), null, 2));
      setRawMode(true);
      return;
    }
    try {
      const parsed = JSON.parse(rawText) as Scenario;
      const rows = scenarioToRows(parsed);
      if (typeof parsed.name === 'string' && parsed.name) setName(parsed.name);
      setCast(rows.cast);
      setScript(rows.script);
      setRawMode(false);
    } catch {
      setError('Raw JSON is not valid — fix it before switching back to the form.');
    }
  };

  const handleSave = async () => {
    setError('');
    setSavedName(null);

    let scenario: Scenario;
    let saveName = name;
    if (rawMode) {
      try {
        scenario = JSON.parse(rawText) as Scenario;
      } catch {
        setError('Raw JSON is not valid JSON.');
        return;
      }
      if (typeof scenario.name === 'string' && scenario.name) saveName = scenario.name;
    } else {
      scenario = buildScenario(name, cast, script);
    }

    const err = validateScenario(saveName, scenario);
    if (err) {
      setError(err);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_SCENARIOS}/${encodeURIComponent(saveName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario),
      });
      if (!res.ok) {
        setError(`Save failed (HTTP ${res.status}).`);
        return;
      }
      setSavedName(saveName);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handlePlay = () => {
    if (!savedName) return;
    window.location.search = `?${SCENARIO_ROLEPLAY_PARAM}=${encodeURIComponent(savedName)}`;
  };

  const paletteOptions = Array.from({ length: PALETTE_COUNT }, (_, i) => i);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Roleplay Script Editor" zIndex={60}>
      <div className="flex flex-col gap-4 w-[560px] max-h-[70vh] overflow-y-auto p-2 font-pixel text-text">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Name</label>
          <input
            className={`${INPUT_CLASS} flex-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-scene"
          />
          <Button variant={rawMode ? 'active' : 'default'} size="sm" onClick={toggleRaw}>
            {rawMode ? 'Form' : 'Raw JSON'}
          </Button>
        </div>

        {rawMode ? (
          <textarea
            className={`${INPUT_CLASS} h-[50vh] resize-none font-mono`}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <>
            {/* ── Cast ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-accent-bright text-sm">Cast</span>
                <Button variant="default" size="sm" onClick={addCast}>
                  + Add cast
                </Button>
              </div>
              {cast.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={`${INPUT_CLASS} w-20`}
                    value={c.id}
                    onChange={(e) => updateCast(i, { id: e.target.value })}
                    placeholder="id"
                  />
                  <input
                    className={`${INPUT_CLASS} flex-1`}
                    value={c.name}
                    onChange={(e) => updateCast(i, { name: e.target.value })}
                    placeholder="name"
                  />
                  <label className="text-xs text-text-muted">pal</label>
                  <select
                    className={INPUT_CLASS}
                    value={c.palette}
                    onChange={(e) => updateCast(i, { palette: Number(e.target.value) })}
                  >
                    {paletteOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <label className="text-xs text-text-muted">hue</label>
                  <input
                    type="number"
                    className={`${INPUT_CLASS} w-16`}
                    value={c.hueShift}
                    onChange={(e) => updateCast(i, { hueShift: Number(e.target.value) })}
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeCast(i)}>
                    x
                  </Button>
                </div>
              ))}
            </div>

            {/* ── Script timeline ──────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-accent-bright text-sm">Script</span>
                <Button variant="default" size="sm" onClick={addScript}>
                  + Add step
                </Button>
              </div>
              {script.map((s, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    className={`${INPUT_CLASS} w-20`}
                    value={s.tMs}
                    onChange={(e) => updateScript(i, { tMs: Number(e.target.value) })}
                    placeholder="tMs"
                  />
                  <select
                    className={INPUT_CLASS}
                    value={s.actor}
                    onChange={(e) => updateScript(i, { actor: e.target.value })}
                  >
                    <option value="">(actor)</option>
                    {cast.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                      </option>
                    ))}
                  </select>
                  <select
                    className={INPUT_CLASS}
                    value={s.action}
                    onChange={(e) => updateScript(i, { action: e.target.value as ActionName })}
                  >
                    {ROLEPLAY_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  {s.action === 'walkTo' && (
                    <>
                      <input
                        type="number"
                        className={`${INPUT_CLASS} w-16`}
                        value={s.col}
                        onChange={(e) => updateScript(i, { col: Number(e.target.value) })}
                        placeholder="col"
                      />
                      <input
                        type="number"
                        className={`${INPUT_CLASS} w-16`}
                        value={s.row}
                        onChange={(e) => updateScript(i, { row: Number(e.target.value) })}
                        placeholder="row"
                      />
                    </>
                  )}
                  {s.action === 'say' && (
                    <input
                      className={`${INPUT_CLASS} flex-1 min-w-[120px]`}
                      value={s.text}
                      onChange={(e) => updateScript(i, { text: e.target.value })}
                      placeholder="text"
                    />
                  )}
                  {s.action === 'sit' && (
                    <input
                      className={`${INPUT_CLASS} flex-1 min-w-[120px]`}
                      value={s.seatId}
                      onChange={(e) => updateScript(i, { seatId: e.target.value })}
                      placeholder="seatId (optional)"
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => removeScript(i)}>
                    x
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <div className="text-xs text-danger">{error}</div>}
        {savedName && (
          <div className="text-xs text-accent-bright">Saved “{savedName}”.</div>
        )}

        <div className="flex items-center justify-end gap-2 border-t-2 border-border pt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {savedName && (
            <Button variant="active" size="sm" onClick={handlePlay}>
              ▶ Play
            </Button>
          )}
          <Button
            variant="accent"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
