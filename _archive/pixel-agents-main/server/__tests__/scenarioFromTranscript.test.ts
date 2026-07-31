import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scenario } from '../../core/src/scenario.js';
import { convertTranscriptToScenario } from '../src/scenarioFromTranscript.js';

// The importer's ScenarioRecorder.stop() would otherwise call Ollama for narration.
vi.mock('../src/scenarioNarrator.js', () => ({
  generateNarrationForScenario: vi.fn().mockResolvedValue([]),
}));

describe('convertTranscriptToScenario', () => {
  const tmpDir = path.join(os.tmpdir(), 'pixel-agents-test-transcript');
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // os.homedir() honors HOME via vitest.setup.homedir.ts (cross-platform).
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-transcript-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('virtualizes time and generates a scenario with monotonic tMs from a JSONL file', async () => {
    const SCENARIOS_DIR = path.join(os.homedir(), '.pixel-agents', 'scenarios');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const testJsonl = path.join(tmpDir, 'test-session.jsonl');
    const t0 = new Date('2023-01-01T12:00:00Z');
    const t1 = new Date(t0.getTime() + 5000); // +5s
    const t2 = new Date(t0.getTime() + 10000); // +10s

    const lines = [
      JSON.stringify({
        timestamp: t0.toISOString(),
        type: 'user',
        message: { content: 'hello' }
      }),
      JSON.stringify({
        timestamp: t1.toISOString(),
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'thinking' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }
          ]
        }
      }),
      JSON.stringify({
        timestamp: t2.toISOString(),
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'file.txt' }
          ]
        }
      }),
    ];

    fs.writeFileSync(testJsonl, lines.join('\n') + '\n', 'utf-8');

    const scenarioName = 'test-transcript-scenario';
    await convertTranscriptToScenario(testJsonl, scenarioName);

    const outPath = path.join(SCENARIOS_DIR, `${scenarioName}.json`);
    expect(fs.existsSync(outPath)).toBe(true);

    const scenario: Scenario = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(scenario.name).toBe(scenarioName);
    expect(scenario.kind).toBe('recording');
    expect(scenario.events).toBeDefined();

    // Verify events
    const events = scenario.events!;
    expect(events.length).toBeGreaterThan(0);
    
    // Check that tMs are monotonic and somewhat match the delta
    let lastTMs = -1;
    for (const evt of events) {
      expect(evt.tMs).toBeGreaterThanOrEqual(lastTMs);
      lastTMs = evt.tMs;
    }

    // Since t2 is +10s and tool-done delay is +1.5s, the max time should be around 11500
    const maxTMs = events[events.length - 1].tMs;
    expect(maxTMs).toBeGreaterThanOrEqual(10000);
    expect(maxTMs).toBeLessThanOrEqual(12000);

    // Clean up
    fs.rmSync(outPath);
  });
});
