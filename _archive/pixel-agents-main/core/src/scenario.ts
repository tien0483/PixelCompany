import type { ServerMessage } from './messages.js';

export interface Scenario {
  schemaVersion: number;
  name: string;
  kind: 'recording' | 'roleplay';
  /** Monotonic start time if this is a recording */
  startedAt?: number;
  /** Narration overlay lines */
  narration?: {
    tMs: number;
    text: string;
    style: 'roleplay' | 'caveman';
  }[];
  /** Raw server message stream (recordings only) */
  events?: {
    tMs: number;
    message: ServerMessage;
  }[];
  /** Explicit cast of characters (roleplay scripts only) */
  cast?: {
    id: string;
    name: string;
    palette: number;
    hueShift?: number;
    seatId?: string;
  }[];
  /** NPC animation script (roleplay scripts only) */
  script?: {
    tMs: number;
    actor: string;
    action: 'spawn' | 'walkTo' | 'sit' | 'type' | 'read' | 'say' | 'wander' | 'despawn';
    args?: Record<string, unknown>;
  }[];
}
