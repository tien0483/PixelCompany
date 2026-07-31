import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { TileType } from '../src/office/types.js';
import { ReplayTransport } from '../src/transport/replayTransport.js';

function baseLayout() {
  return {
    version: 1 as const,
    cols: 10,
    rows: 10,
    tiles: new Array(100).fill(TileType.FLOOR_1),
    tileColors: new Array(100).fill(null),
    furniture: [],
    pets: [],
    npcs: [],
  };
}

test('getDuration() returns max time from events or script', () => {
  const transport = new ReplayTransport('ws://dummy', 'test');
  
  // Recording
  transport.loadScenario({
    schemaVersion: 1,
    name: 'test1',
    kind: 'recording',
    events: [
      { tMs: 0, message: { type: 'agentCreated', id: 1, folderName: '' } as unknown as ServerMessage },
      { tMs: 2000, message: { type: 'agentClosed', id: 1 } as unknown as ServerMessage }
    ]
  });
  assert.equal(transport.getDuration(), 2000);

  // Roleplay
  transport.loadScenario({
    schemaVersion: 1,
    name: 'test2',
    kind: 'roleplay',
    cast: [{ id: 'alice', name: 'Alice', palette: 0, hueShift: 0 }],
    script: [
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 3000, actor: 'alice', action: 'despawn' }
    ]
  });
  assert.equal(transport.getDuration(), 3000);
});

test('seek(t) clears agents and dispatches events up to t', () => {
  const transport = new ReplayTransport('ws://dummy', 'test');
  const state = new OfficeState(baseLayout());
  transport.setOfficeState(state);

  transport.loadScenario({
    schemaVersion: 1,
    name: 'test1',
    kind: 'recording',
    events: [
      { tMs: 0, message: { type: 'agentCreated', id: 1, folderName: '' } as unknown as ServerMessage },
      { tMs: 1000, message: { type: 'agentToolStart', id: 1, toolName: 'test' } as unknown as ServerMessage },
      { tMs: 2000, message: { type: 'agentClosed', id: 1 } as unknown as ServerMessage }
    ]
  });

  const dispatched: ServerMessage[] = [];
  transport.onMessage((msg) => dispatched.push(msg));

  transport.seek(1500);

  // Should have received existingAgents blank slate, plus events <= 1500
  const existingAgents = dispatched.find(m => m.type === 'existingAgents');
  assert.ok(existingAgents);
  assert.equal(dispatched.filter(m => m.type === 'agentCreated').length, 1);
  assert.equal(dispatched.filter(m => m.type === 'agentToolStart').length, 1);
  assert.equal(dispatched.filter(m => m.type === 'agentClosed').length, 0);
});
