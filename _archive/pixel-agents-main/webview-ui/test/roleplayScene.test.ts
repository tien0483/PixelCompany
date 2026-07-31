import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Scenario } from '../../core/src/scenario.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { RoleplayScene } from '../src/office/scenario/roleplayScene.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

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

function scenario(script: NonNullable<Scenario['script']>): Scenario {
  return {
    schemaVersion: 1,
    name: 'test-roleplay',
    kind: 'roleplay',
    cast: [{ id: 'alice', name: 'Alice', palette: 0, hueShift: 0 }],
    script,
  };
}

test('spawn creates an authored NPC that does not auto-wander', () => {
  const state = new OfficeState(baseLayout());
  state.isReplayMode = true;
  const scene = new RoleplayScene(state, scenario([{ tMs: 0, actor: 'alice', action: 'spawn' }]));

  scene.tick(0);

  const chars = state.getCharacters();
  assert.equal(chars.length, 1);
  assert.equal(chars[0].isNpc, true);
  // Spawned NPCs stay put until commanded, even though the FSM now allows NPC wander.
  const ch = chars[0];
  for (let i = 0; i < 10; i++) state.update(0.1);
  // Didn't auto-wander: no path was started and the wander timer never fired.
  assert.equal(ch.path.length, 0);
  assert.ok(ch.wanderTimer > 1000, `expected NPC to stay put, wanderTimer=${ch.wanderTimer}`);
});

test('walkTo drives the NPC into a WALK with a path', () => {
  const state = new OfficeState(baseLayout());
  const scene = new RoleplayScene(
    state,
    scenario([
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 100, actor: 'alice', action: 'walkTo', args: { col: 8, row: 8 } },
    ]),
  );

  scene.tick(0);
  const ch = state.getCharacters()[0];
  // Place at a known start so a path to (8,8) exists deterministically.
  ch.tileCol = 1;
  ch.tileRow = 1;

  scene.tick(100);

  assert.equal(ch.state, CharacterState.WALK);
  assert.ok(ch.path.length > 0);
});

test('wander command lets an NPC wander even in replay mode', () => {
  const state = new OfficeState(baseLayout());
  state.isReplayMode = true;
  const scene = new RoleplayScene(
    state,
    scenario([
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 100, actor: 'alice', action: 'wander' },
    ]),
  );

  scene.tick(0);
  const ch = state.getCharacters()[0];

  scene.tick(100); // wander action => state IDLE, wanderTimer 0
  assert.equal(ch.wanderTimer, 0);

  // One update: the wander block must run (NPC exempt from replay suppression),
  // which resets wanderTimer to a positive 2-20s value.
  state.update(0.1);
  assert.ok(ch.wanderTimer > 1, `expected wanderTimer reset, got ${ch.wanderTimer}`);
});

test('despawn removes the NPC', () => {
  const state = new OfficeState(baseLayout());
  const scene = new RoleplayScene(
    state,
    scenario([
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 100, actor: 'alice', action: 'despawn' },
    ]),
  );

  scene.tick(0);
  assert.equal(state.getCharacters().length, 1);

  scene.tick(100);
  assert.equal(state.getCharacters().length, 0);
});

test('say action sets speechText and does not set waiting bubble', () => {
  const state = new OfficeState(baseLayout());
  const scene = new RoleplayScene(
    state,
    scenario([
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 100, actor: 'alice', action: 'say', args: { text: 'Hello world' } },
    ]),
  );

  scene.tick(100);
  const ch = state.getCharacters()[0];
  assert.equal(ch.speechText, 'Hello world');
  assert.notEqual(ch.bubbleType, 'waiting');
});

test('seek(t) clears all NPCs and reapplies script up to tMs', () => {
  const state = new OfficeState(baseLayout());
  state.isReplayMode = true;
  const scene = new RoleplayScene(
    state,
    scenario([
      { tMs: 0, actor: 'alice', action: 'spawn' },
      { tMs: 100, actor: 'alice', action: 'say', args: { text: 'Test' } },
    ]),
  );

  scene.tick(100);
  assert.equal(state.getCharacters().length, 1);
  assert.equal(state.getCharacters()[0].speechText, 'Test');

  // Seek back to 50
  scene.seek(50);
  // Re-applied up to tMs <= 50, so Alice is spawned but hasn't spoken
  assert.equal(state.getCharacters().length, 1);
  assert.equal(state.getCharacters()[0].speechText, undefined);
});
