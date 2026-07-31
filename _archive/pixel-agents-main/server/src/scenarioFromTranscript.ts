import * as fs from 'fs';
import * as readline from 'readline';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentStateStore } from './agentStateStore.js';
import { ScenarioRecorder } from './scenarioRecorder.js';
import { processTranscriptLine, setHookProvider } from './transcriptParser.js';
import type { AgentState } from './types.js';

export async function convertTranscriptToScenario(
  jsonlPath: string,
  scenarioName: string,
): Promise<void> {
  // Use a throwaway store + recorder
  const store = new AgentStateStore();
  const recorder = new ScenarioRecorder(store, scenarioName);

  // Virtual clock — install BEFORE any store mutation so every recorded event
  // (including the initial agent registration below) is stamped on the virtual
  // timeline starting at 0. Otherwise the first event gets a real-clock tMs and
  // breaks monotonicity relative to the transcript-derived events.
  const originalDateNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let virtualTimeMs = 0;
  Date.now = () => virtualTimeMs;
  (recorder as unknown as { scenario: { startedAt: number } }).scenario.startedAt = 0;

  // Create a mock agent for the transcript to map to
  const agentId = 1;
  const mockAgent: AgentState = {
    id: agentId,
    sessionId: 'transcript',
    projectDir: 'mock-workspace',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    seenUnknownRecordTypes: new Set(),
    linesProcessed: 0,
    lastDataAt: 0,
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    isExternal: true,
    jsonlFile: 'transcript',
    fileOffset: 0,
    lineBuffer: '',
  };
  store.set(agentId, mockAgent);

  // We need a dummy hook provider so processTranscriptLine formats tool statuses correctly
  const dummyHookProvider: HookProvider = {
    name: 'dummy',
    permissionExemptTools: new Set(['ls', 'cat', 'cd', 'echo']),
    subagentToolNames: new Set(['Task', 'Agent', 'Architect']),
    formatToolStatus: (toolName: string, _input: any) => `Using ${toolName}`,
    installHooks: async () => {},
    uninstallHooks: async () => {},
    getSessionDirs: () => [],
    isSessionActive: () => true,
    team: {
      isTeammateSpawnCall: () => false,
      extractTeamMetadataFromRecord: () => null,
    } as any,
  } as unknown as HookProvider;
  setHookProvider(dummyHookProvider);

  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // Timer virtualization (Date.now already overridden above).
  let firstTimestamp: Date | null = null;

  interface Timer {
    id: number;
    executeAt: number;
    callback: () => void;
  }
  let timerIdCounter = 0;
  const activeTimers = new Map<number, Timer>();

  Date.now = () => virtualTimeMs;
  (global as any).setTimeout = (cb: () => void, delay: number) => {
    const id = timerIdCounter++;
    activeTimers.set(id, { id, executeAt: virtualTimeMs + delay, callback: cb });
    return id as any;
  };
  (global as any).clearTimeout = (id: number) => {
    activeTimers.delete(id);
  };

  const advanceTimeTo = (targetTimeMs: number) => {
    while (true) {
      let nextTimer: Timer | null = null;
      for (const t of activeTimers.values()) {
        if (t.executeAt <= targetTimeMs) {
          if (!nextTimer || t.executeAt < nextTimer.executeAt) {
            nextTimer = t;
          }
        }
      }
      if (!nextTimer) break;
      
      virtualTimeMs = nextTimer.executeAt;
      activeTimers.delete(nextTimer.id);
      nextTimer.callback();
    }
    virtualTimeMs = targetTimeMs;
  };

  try {
    const fileStream = fs.createReadStream(jsonlPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const record = JSON.parse(line);
        if (record.timestamp) {
          const ts = new Date(record.timestamp);
          if (!firstTimestamp) {
            firstTimestamp = ts;
            // The ScenarioRecorder captures Date.now() when started
            // We need to re-initialize its startedAt now that we have the true first timestamp
            (recorder as any).scenario.startedAt = 0; 
            virtualTimeMs = 0; // align 0 to the first timestamp
          } else {
            const targetTimeMs = ts.getTime() - firstTimestamp.getTime();
            advanceTimeTo(targetTimeMs);
          }
        }
      } catch (err) {
        // ignore parse error for this line
      }

      processTranscriptLine(agentId, line, store, waitingTimers, permissionTimers);
    }

    // Advance enough time to clear any pending timers (like TOOL_DONE_DELAY_MS = 1500ms)
    advanceTimeTo(virtualTimeMs + 10000);

  } finally {
    // Restore globals
    Date.now = originalDateNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  // Gracefully stop recorder and flush to disk
  await recorder.stop();
  
  // Clean up store
  store.delete(agentId);
}
