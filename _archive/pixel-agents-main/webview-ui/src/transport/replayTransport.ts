import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { Scenario } from '../../../core/src/scenario.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { RoleplayScene } from '../office/scenario/roleplayScene.js';
import type { MessageTransport, TransportState } from './types.js';
import { WebSocketTransport } from './webSocketTransport.js';

/**
 * A transport that wraps a standard WebSocket (to get initial assets/layout)
 * but replaces live agent activity with a recorded scenario timeline.
 */
export class ReplayTransport implements MessageTransport {
  private ws: WebSocketTransport;
  private scenarioName: string;
  private scenario: Scenario | null = null;
  private handlers: Array<(msg: ServerMessage) => void> = [];
  private stateHandlers: Array<(state: TransportState) => void> = [];
  private isPlaying = false;
  private virtualClockMs = 0;
  private lastFrameTime = 0;
  private timelineIndex = 0;
  private animationFrameId: number | null = null;
  private officeState: OfficeState | null = null;
  private roleplayScene: RoleplayScene | null = null;
  private maxTimeMs = 0;

  constructor(wsUrl: string, scenarioName: string) {
    this.scenarioName = scenarioName;
    this.ws = new WebSocketTransport(wsUrl);

    this.ws.onStateChange((s) => {
      for (const h of this.stateHandlers) h(s);
    });

    this.ws.onMessage((msg) => {
      // 1. Let all asset/config messages through
      if (
        msg.type === 'characterSpritesLoaded' ||
        msg.type === 'petSpritesLoaded' ||
        msg.type === 'floorTilesLoaded' ||
        msg.type === 'wallTilesLoaded' ||
        msg.type === 'carpetTilesLoaded' ||
        msg.type === 'furnitureAssetsLoaded' ||
        msg.type === 'settingsLoaded' ||
        msg.type === 'areaMappingsLoaded' ||
        msg.type === 'layoutLoaded'
      ) {
        for (const h of this.handlers) h(msg);
      }

      // 2. Block the live server's `existingAgents` to start with a blank slate,
      //    then start our replay.
      if (msg.type === 'existingAgents') {
        for (const h of this.handlers) {
          h({ type: 'existingAgents', agents: [], agentMeta: {}, folderNames: {}, externalAgents: {} });
        }
        this.fetchScenarioAndPlay();
      }
    });
  }

  public setOfficeState(os: OfficeState): void {
    this.officeState = os;
    if (this.scenario?.kind === 'roleplay' && !this.roleplayScene) {
      this.roleplayScene = new RoleplayScene(this.officeState, this.scenario);
    }
  }

  public get state(): TransportState {
    return this.ws.state;
  }

  public get ready(): Promise<void> {
    return this.ws.ready;
  }

  public connect(): void {
    this.ws.connect();
  }

  public send(message: ClientMessage): void {
    // Only send structural messages (like webviewReady) to get assets.
    // Block agent interaction requests since this is a replay.
    if (message.type === 'webviewReady') {
      this.ws.send(message);
    }
  }

  public onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  public onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  public dispose(): void {
    this.pause();
    this.ws.dispose();
    this.handlers = [];
    this.stateHandlers = [];
  }

  // ── Playback Controls ──────────────────────────────────────────

  private fetchScenarioAndPlay() {
    fetch(`/api/scenarios/${this.scenarioName}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load scenario ${this.scenarioName}`);
        return res.json();
      })
      .then((data: Scenario) => {
        this.loadScenario(data);
        this.play();
      })
      .catch((err) => {
        console.error('[ReplayTransport]', err);
      });
  }

  /** Load a scenario and compute its playback bounds. Shared by the fetch path
   *  (fetchScenarioAndPlay) and unit tests, which drive it without the network. */
  public loadScenario(data: Scenario): void {
    this.scenario = data;
    
    let minTime = 0;
    this.maxTimeMs = 0;

    if (this.scenario.kind === 'roleplay') {
      if (this.scenario.script && this.scenario.script.length > 0) {
        minTime = this.scenario.script[0].tMs;
        this.maxTimeMs = Math.max(this.maxTimeMs, ...this.scenario.script.map(s => s.tMs));
      }
      if (this.officeState) {
        this.roleplayScene = new RoleplayScene(this.officeState, this.scenario);
      }
    } else {
      if (this.scenario.events && this.scenario.events.length > 0) {
        minTime = this.scenario.events[0].tMs;
        this.maxTimeMs = Math.max(this.maxTimeMs, ...this.scenario.events.map(e => e.tMs));
      }
    }
    
    if (this.scenario.narration && this.scenario.narration.length > 0) {
      this.maxTimeMs = Math.max(this.maxTimeMs, ...this.scenario.narration.map(n => n.tMs));
    }

    this.virtualClockMs = minTime;
  }

  public play(): void {
    if (this.isPlaying || !this.scenario) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.tick();
  }

  public pause(): void {
    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public seek(tMs: number): void {
    this.virtualClockMs = tMs;
    // Fast-forward state by resetting all agents and replaying from t=0 to tMs
    if (!this.scenario) return;
    
    // Clear the current slate
    if (this.officeState) {
      this.officeState.clearAllAgents();
      // We still need to let the frontend components (like ToolOverlay, BottomToolbar)
      // know the agents are cleared, so we fire existingAgents with empty arrays.
      for (const h of this.handlers) {
        h({ type: 'existingAgents', agents: [], agentMeta: {}, folderNames: {}, externalAgents: {} });
      }
    }
    
    if (this.scenario.kind === 'roleplay' && this.roleplayScene) {
      this.roleplayScene.seek(this.virtualClockMs);
    } else {
      // Fast forward timeline up to tMs
      this.timelineIndex = 0;
      while (
        this.scenario.events &&
        this.timelineIndex < this.scenario.events.length &&
        this.scenario.events[this.timelineIndex].tMs <= this.virtualClockMs
      ) {
        const msg = this.scenario.events[this.timelineIndex].message;
        for (const h of this.handlers) h(msg);
        this.timelineIndex++;
      }
    }
  }

  public getScenario(): Scenario | null {
    return this.scenario;
  }

  public getCurrentTime(): number {
    return this.virtualClockMs;
  }

  public getDuration(): number {
    return this.maxTimeMs;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private tick = () => {
    if (!this.isPlaying || !this.scenario) return;

    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    // Advance virtual clock at 1x real-time speed
    this.virtualClockMs += dt;

    // Dispatch due events
    if (this.scenario.kind === 'roleplay') {
      if (this.roleplayScene) {
        this.roleplayScene.tick(this.virtualClockMs);
      }
    } else {
      while (
        this.scenario.events &&
        this.timelineIndex < this.scenario.events.length &&
        this.scenario.events[this.timelineIndex].tMs <= this.virtualClockMs
      ) {
        const msg = this.scenario.events[this.timelineIndex].message;
        for (const h of this.handlers) h(msg);
        this.timelineIndex++;
      }
    }

    if (this.virtualClockMs < this.maxTimeMs) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    } else {
      this.pause(); // Reached EOF
      // Freeze time at EOF so agents don't wander
      if (this.officeState) {
        this.officeState.timeScale = 0;
      }
    }
  };
}
