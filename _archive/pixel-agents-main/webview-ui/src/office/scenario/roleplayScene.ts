import type { Scenario } from '../../../../core/src/scenario.js';
import { SPEECH_BUBBLE_DURATION_SEC } from '../../constants.js';
import { OfficeState } from '../engine/officeState.js';
import { setProviderCapabilities } from '../toolUtils.js';
import { CharacterState } from '../types.js';

export class RoleplayScene {
  private officeState: OfficeState;
  private scenario: Scenario;
  private timelineIndex = 0;
  private actorToId: Map<string, number> = new Map();
  private nextNpcId = -1000;

  constructor(officeState: OfficeState, scenario: Scenario) {
    this.officeState = officeState;
    this.scenario = scenario;
    // Inject default capabilities so roleplay scripts can trigger reading animations
    setProviderCapabilities({
      readingTools: ['Read'],
      subagentToolNames: [],
    });
  }

  public tick(virtualClockMs: number) {
    if (!this.scenario.script) return;

    while (
      this.timelineIndex < this.scenario.script.length &&
      this.scenario.script[this.timelineIndex].tMs <= virtualClockMs
    ) {
      const step = this.scenario.script[this.timelineIndex];
      this.executeAction(step);
      this.timelineIndex++;
    }
  }

  private executeAction(step: NonNullable<Scenario['script']>[0]) {
    let npcId = this.actorToId.get(step.actor);

    if (step.action === 'spawn') {
      if (!npcId) {
        npcId = this.nextNpcId--;
        this.actorToId.set(step.actor, npcId);
      }
      
      const castMember = this.scenario.cast?.find((c) => c.id === step.actor);
      if (!castMember) return;

      // Ensure the NPC doesn't already exist (idempotent spawn)
      if (!this.officeState.characters.has(npcId)) {
        this.officeState.addNpc({
          id: npcId,
          palette: castMember.palette,
          hueShift: castMember.hueShift ?? 0,
          seatId: castMember.seatId || null,
        });
        // Idle roleplay NPCs stay put until a 'wander' action commands otherwise
        // (the FSM wander guard now allows NPCs even in replay mode).
        const spawned = this.officeState.characters.get(npcId);
        if (spawned) {
          spawned.wanderTimer = Number.MAX_SAFE_INTEGER;
          // Show the cast name above the NPC's head (rendered by SpeechOverlay).
          spawned.agentName = castMember.name;
        }
        this.officeState.pushActivity(`${castMember.name} joined the office`);
      }
      return;
    }

    if (!npcId) return; // Ignore action if actor is not spawned
    const ch = this.officeState.characters.get(npcId);
    if (!ch) return;

    // Dismiss any sprite bubble (permission/waiting) on a new action. Speech
    // text is not touched here — it fades on its own speechTimer — and `say`
    // is exempt so it can set the next line without self-clearing.
    if (step.action !== 'say') {
      this.officeState.dismissBubble(npcId);
    }

    switch (step.action) {
      case 'walkTo': {
        const args = step.args as { col?: number; row?: number } | undefined;
        if (args && args.col !== undefined && args.row !== undefined) {
          this.officeState.walkToTile(npcId, args.col, args.row);
        }
        break;
      }
      case 'sit': {
        const args = step.args as { seatId?: string } | undefined;
        if (args?.seatId) {
          this.officeState.reassignSeat(npcId, args.seatId);
        } else {
          this.officeState.sendToSeat(npcId);
        }
        break;
      }
      case 'type':
      case 'read': {
        ch.state = CharacterState.TYPE;
        // The sprite getter uses `isReadingTool(tool)` which checks provider caps. 
        // We set a recognizable string here; `Read` is standard for reading.
        ch.currentTool = step.action === 'read' ? 'Read' : 'Write';
        // Clear any old pinned tile or path
        ch.path = [];
        break;
      }
      case 'say': {
        const args = step.args as { text?: string; to?: string } | undefined;
        // `to` targets another actor → draws a conversation tether between them.
        ch.talkingToId = args?.to ? this.actorToId.get(args.to) : undefined;
        if (args?.text) {
          this.officeState.showSpeech(npcId, args.text, SPEECH_BUBBLE_DURATION_SEC);
          const who = this.scenario.cast?.find((c) => c.id === step.actor)?.name ?? step.actor;
          this.officeState.pushActivity(`${who}: ${args.text}`);
        }
        break;
      }
      case 'wander': {
        ch.state = CharacterState.IDLE;
        ch.wanderTimer = 0; // immediate step
        break;
      }
      case 'despawn': {
        const who = this.scenario.cast?.find((c) => c.id === step.actor)?.name ?? step.actor;
        this.officeState.pushActivity(`${who} left`);
        this.officeState.removeNpc(npcId);
        this.actorToId.delete(step.actor);
        break;
      }
    }
  }

  public seek(virtualClockMs: number) {
    this.timelineIndex = 0;
    this.actorToId.clear();
    this.nextNpcId = -1000;

    // Remove all NPCs added by this roleplay scene (they have negative IDs in this scene scheduler)
    const toDelete: number[] = [];
    for (const [id, ch] of this.officeState.characters) {
      if (ch.isNpc && id <= -1000) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.officeState.removeNpc(id);
    }

    // Fast-forward script up to virtualClockMs
    if (!this.scenario.script) return;
    while (
      this.timelineIndex < this.scenario.script.length &&
      this.scenario.script[this.timelineIndex].tMs <= virtualClockMs
    ) {
      const step = this.scenario.script[this.timelineIndex];
      this.executeAction(step);
      this.timelineIndex++;
    }
  }
}
