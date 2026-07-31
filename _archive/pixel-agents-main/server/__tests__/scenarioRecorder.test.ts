import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scenario } from '../../core/src/scenario.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { ScenarioRecorder } from '../src/scenarioRecorder.js';

// Keep the recorder's stop() offline: don't reach out to Ollama for narration.
vi.mock('../src/scenarioNarrator.js', () => ({
  generateNarrationForScenario: vi.fn().mockResolvedValue([]),
}));

describe('ScenarioRecorder', () => {
  const TEST_SCENARIO_NAME = 'test_recording';

  let tempHome: string;
  let originalHome: string | undefined;
  let scenarioFile: string;
  let store: AgentStateStore;
  let recorder: ScenarioRecorder;

  beforeEach(() => {
    // Isolate ~/.pixel-agents to a throwaway home (os.homedir() honors HOME via
    // vitest.setup.homedir.ts, cross-platform).
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-recorder-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    scenarioFile = path.join(tempHome, '.pixel-agents', 'scenarios', `${TEST_SCENARIO_NAME}.json`);

    store = new AgentStateStore();
    recorder = new ScenarioRecorder(store, TEST_SCENARIO_NAME);
  });

  afterEach(async () => {
    await recorder.stop();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('records agent activity and excludes asset messages', async () => {
    // Wait briefly to ensure file is written by initial save
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // Simulate agent add
    store.set(1, {
      folderName: 'test-folder',
      isExternal: false,
    } as any);

    // Simulate tool start
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 'tool-1',
      status: 'working',
    });

    // Simulate ignored asset message
    store.broadcast({
      type: 'characterSpritesLoaded',
      characters: [],
    });

    // Simulate agent remove
    store.delete(1);

    // Flush explicitly
    await recorder.stop();

    // Read the file
    expect(fs.existsSync(scenarioFile)).toBe(true);
    const data = fs.readFileSync(scenarioFile, 'utf-8');
    const scenario: Scenario = JSON.parse(data);

    expect(scenario.name).toBe(TEST_SCENARIO_NAME);
    expect(scenario.kind).toBe('recording');
    expect(scenario.events).toBeDefined();
    
    // Should have 3 events (add, tool start, remove)
    // The asset message should be ignored
    expect(scenario.events!.length).toBe(3);

    // Check mapping correctness
    expect(scenario.events![0].message.type).toBe('agentCreated');
    expect((scenario.events![0].message as any).id).toBe(1);
    
    expect(scenario.events![1].message.type).toBe('agentToolStart');
    
    expect(scenario.events![2].message.type).toBe('agentClosed');
    
    // Check monotonic timestamps
    expect(scenario.events![0].tMs).toBeGreaterThanOrEqual(0);
    expect(scenario.events![1].tMs).toBeGreaterThanOrEqual(scenario.events![0].tMs);
    expect(scenario.events![2].tMs).toBeGreaterThanOrEqual(scenario.events![1].tMs);
  });
});
