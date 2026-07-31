import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ServerMessage } from '../../core/src/messages.js';
import type { Scenario } from '../../core/src/scenario.js';
import type { AgentStateStore } from './agentStateStore.js';
import { storeEventToMessage } from './httpServer.js';
import { generateNarrationForScenario } from './scenarioNarrator.js';

const SCENARIOS_DIR = '.pixel-agents/scenarios';

export class ScenarioRecorder {
  private scenario: Scenario;
  private filePath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private isWriting = false;
  private needsSave = false;

  private onAgentAdded: (id: number, agent: any) => void;
  private onAgentRemoved: (id: number) => void;
  private onBroadcast: (message: Record<string, unknown>) => void;

  constructor(
    private store: AgentStateStore,
    public name: string,
  ) {
    this.scenario = {
      schemaVersion: 1,
      name,
      kind: 'recording',
      startedAt: Date.now(),
      events: [],
    };

    const dir = path.join(os.homedir(), SCENARIOS_DIR);
    this.filePath = path.join(dir, `${name}.json`);
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.onAgentAdded = (id: number, agent: any) => {
      const msg = storeEventToMessage('agentAdded', id, agent);
      if (msg) this.recordEvent(msg as unknown as ServerMessage);
    };

    this.onAgentRemoved = (id: number) => {
      const msg = storeEventToMessage('agentRemoved', id);
      if (msg) this.recordEvent(msg as unknown as ServerMessage);
    };

    this.onBroadcast = (message: Record<string, unknown>) => {
      const msg = storeEventToMessage('broadcast', message);
      if (msg) this.recordEvent(msg as unknown as ServerMessage);
    };

    store.on('agentAdded', this.onAgentAdded);
    store.on('agentRemoved', this.onAgentRemoved);
    store.on('broadcast', this.onBroadcast);

    // Snapshot agents that ALREADY exist when recording starts, so a replay
    // reconstructs the scene. Without this the recording misses their
    // `agentCreated` events (only later broadcasts are captured) and plays back
    // to an empty office with no characters and no narration.
    for (const [id, agent] of store) {
      const msg = storeEventToMessage('agentAdded', id, agent);
      if (msg) this.recordEvent(msg as unknown as ServerMessage);
    }
    
    console.log(`[ScenarioRecorder] Started recording '${name}' to ${this.filePath}`);
    
    // Initial save
    this.scheduleSave();
  }

  public async stop(): Promise<void> {
    this.store.off('agentAdded', this.onAgentAdded);
    this.store.off('agentRemoved', this.onAgentRemoved);
    this.store.off('broadcast', this.onBroadcast);
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    console.log(`[ScenarioRecorder] Generating narration for '${this.name}'...`);
    try {
      this.scenario.narration = await generateNarrationForScenario(this.scenario);
    } catch (err) {
      console.error(`[ScenarioRecorder] Failed to generate narration:`, err);
    }

    // Final synchronous flush
    this.flush();
    console.log(`[ScenarioRecorder] Stopped recording '${this.name}'`);
  }

  private recordEvent(message: ServerMessage): void {
    // Exclude static asset loading messages
    const ignoredTypes = [
      'characterSpritesLoaded',
      'petSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'carpetTilesLoaded',
      'furnitureAssetsLoaded',
    ];

    if (ignoredTypes.includes(message.type)) {
      return;
    }

    this.scenario.events!.push({
      tMs: Date.now() - this.scenario.startedAt!,
      message,
    });

    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.isWriting) {
      this.needsSave = true;
      return;
    }
    
    if (!this.saveTimeout) {
      this.saveTimeout = setTimeout(() => {
        this.saveTimeout = null;
        this.flush();
      }, 1000); // Batch saves every 1s
    }
  }

  private flush(): void {
    if (this.isWriting) return;
    this.isWriting = true;
    this.needsSave = false;

    try {
      const json = JSON.stringify(this.scenario, null, 2);
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error(`[ScenarioRecorder] Failed to write scenario ${this.name}:`, err);
    } finally {
      this.isWriting = false;
      if (this.needsSave) {
        this.scheduleSave();
      }
    }
  }
}
