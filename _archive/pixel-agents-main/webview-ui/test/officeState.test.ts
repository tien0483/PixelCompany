import assert from 'node:assert/strict';

import { test } from 'vitest';

import { ACTIVITY_FEED_MAX } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedNpc } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function baseLayout(): OfficeLayout {
  return {
    version: 1,
    cols: 10,
    rows: 10,
    tiles: new Array(100).fill(TileType.FLOOR_1),
    tileColors: new Array(100).fill(null),
    furniture: [],
    pets: [],
    npcs: [],
  };
}

test('OfficeState.addNpc adds NPC to characters and syncs to layout', () => {
  const state = new OfficeState(baseLayout());
  const placedNpc: PlacedNpc = {
    id: -100000,
    palette: 0,
    hueShift: 0,
    script: [{ kind: 'wander', seconds: 5 }]
  };

  assert.equal(state.getLayout().npcs?.length, 0);

  state.addNpc(placedNpc);
  
  // Verify character is added
  const chars = state.getCharacters();
  assert.equal(chars.length, 1);
  assert.equal(chars[0].id, placedNpc.id);
  assert.equal(chars[0].isNpc, true);

  // Verify layout is synced
  const layout = state.getLayout();
  assert.ok(layout.npcs);
  assert.equal(layout.npcs.length, 1);
  assert.equal(layout.npcs[0].id, placedNpc.id);
  assert.deepEqual(layout.npcs[0].script, placedNpc.script);
});

test('OfficeState rebuilds NPCs from layout correctly', () => {
  const layout = baseLayout();
  const placedNpc: PlacedNpc = {
    id: -100001,
    palette: 2,
    hueShift: 90,
  };
  layout.npcs = [placedNpc];

  const state = new OfficeState(layout);
  
  // Verify character is created during constructor
  const chars = state.getCharacters();
  assert.equal(chars.length, 1);
  assert.equal(chars[0].id, placedNpc.id);
  assert.equal(chars[0].isNpc, true);
  assert.equal(chars[0].palette, 2);
  assert.equal(chars[0].hueShift, 90);
});

test('OfficeState removes NPC and syncs layout', () => {
  const state = new OfficeState(baseLayout());
  const placedNpc: PlacedNpc = { id: -100002, palette: 0, hueShift: 0 };
  
  state.addNpc(placedNpc);
  assert.equal(state.getLayout().npcs?.length, 1);
  
  state.removeNpc(placedNpc.id);
  
  const chars = state.getCharacters();
  assert.equal(chars.length, 0);
  assert.equal(state.getLayout().npcs?.length, 0);
});

test('NPC script scheduler loops through actions', () => {
  const layout = baseLayout();
  const state = new OfficeState(layout);
  
  const placedNpc: PlacedNpc = {
    id: -100003,
    palette: 0,
    hueShift: 0,
    script: [
      { kind: 'typeAtSeat', seconds: 0.5 },
      { kind: 'typeAtSeat', seconds: 0.5 }
    ]
  };
  state.addNpc(placedNpc);
  
  const ch = state.getCharacters()[0];
  
  // Tick 1: initializes script
  state.update(0.1);
  assert.equal(ch.scriptIndex, 0);
  assert.equal(ch.state, 'type');
  
  // Tick past 0.5s
  for (let i = 0; i < 6; i++) {
    state.update(0.1);
  }
  
  // Should now be on action 1
  assert.equal(ch.scriptIndex, 1);
  
  // Tick past another 0.5s
  for (let i = 0; i < 6; i++) {
    state.update(0.1);
  }
  
  // Should loop back to 0
  assert.equal(ch.scriptIndex, 0);
});

test('OfficeState.pushActivity dedups consecutive duplicates and drops idle/empty text', () => {
  const state = new OfficeState(baseLayout());

  // Empty / whitespace-only text is dropped.
  state.pushActivity('');
  state.pushActivity('   ');
  assert.equal(state.activityFeed.length, 0);

  // Idle / waiting text is dropped (case-insensitive substring match).
  state.pushActivity('Idle');
  state.pushActivity('Agent 3 is idle');
  state.pushActivity('Waiting for input');
  assert.equal(state.activityFeed.length, 0);

  // A meaningful line is kept.
  state.pushActivity('Alice arrived');
  assert.deepEqual(state.activityFeed, ['Alice arrived']);

  // Consecutive duplicates are collapsed (trim-insensitive).
  state.pushActivity('Alice arrived');
  state.pushActivity('  Alice arrived  ');
  assert.deepEqual(state.activityFeed, ['Alice arrived']);

  // A different line appends; the same text later (non-consecutive) is allowed.
  state.pushActivity('Bob left');
  state.pushActivity('Alice arrived');
  assert.deepEqual(state.activityFeed, ['Alice arrived', 'Bob left', 'Alice arrived']);
});

test('OfficeState.pushActivity caps the feed at ACTIVITY_FEED_MAX (oldest dropped)', () => {
  const state = new OfficeState(baseLayout());
  for (let i = 0; i < ACTIVITY_FEED_MAX + 10; i++) {
    state.pushActivity(`event ${i}`);
  }
  assert.equal(state.activityFeed.length, ACTIVITY_FEED_MAX);
  // Oldest lines were shifted off the front; newest retained at the back.
  assert.equal(state.activityFeed[0], 'event 10');
  assert.equal(
    state.activityFeed[state.activityFeed.length - 1],
    `event ${ACTIVITY_FEED_MAX + 9}`,
  );
});

test('pinned agent FSM logic overrides wander and seat-return', () => {
  const layout = baseLayout();
  const state = new OfficeState(layout);
  
  // Add a normal (non-NPC) agent
  state.addAgent(1, 0, 0, undefined, true, 'folder', 'team');
  const ch = state.characters.get(1)!;
  
  // Set position and pin them
  ch.tileCol = 2;
  ch.tileRow = 2;
  ch.pinnedTile = { col: 2, row: 2 };
  
  // They should not wander if pinned
  ch.state = 'idle'; // CharacterState.IDLE
  ch.isActive = false;
  ch.wanderTimer = 0; // ready to wander
  
  // Tick a few times
  for (let i = 0; i < 5; i++) {
    state.update(0.1);
  }
  
  // Assert they did not wander (no path generated)
  assert.equal(ch.state, 'idle');
  assert.equal(ch.tileCol, 2);
  assert.equal(ch.tileRow, 2);
  
  // Now make them active
  state.setAgentActive(1, true);
  
  // Tick again
  state.update(0.1);
  
  // Assert they transitioned directly to TYPE in place
  assert.equal(ch.state, 'type'); // CharacterState.TYPE
  assert.equal(ch.tileCol, 2);
  assert.equal(ch.tileRow, 2);
});
