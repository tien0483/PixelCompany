import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecorderController } from '../src/httpServer.js';

// Isolated temp HOME so os.homedir() resolves inside the test sandbox
// (the routes read ~/.pixel-agents/scenarios via os.homedir()).
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER the os mock is registered.
const { PixelAgentsServer } = await import('../src/server.js');

function scenariosDir(): string {
  return path.join(tmpBase, '.pixel-agents', 'scenarios');
}

function writeScenario(name: string, kind: string): void {
  const dir = scenariosDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({ schemaVersion: 1, name, kind, events: [] }),
  );
}

/** Minimal in-memory recorder controller — no real ScenarioRecorder/store/Ollama. */
function stubRecorder(): RecorderController {
  let current: string | null = null;
  return {
    start: (name) => {
      current = name;
    },
    stop: async () => {
      current = null;
    },
    status: () => ({ recording: current !== null, name: current }),
  };
}

describe('scenario list + record routes', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-scenario-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ── GET /api/scenarios ──────────────────────────────────────

  it('returns [] when the scenarios directory is missing', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/scenarios`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('lists saved scenarios with their kind', async () => {
    writeScenario('demo', 'recording');
    writeScenario('meeting', 'roleplay');
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/scenarios`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as { name: string; kind: string }[];
    expect(list).toHaveLength(2);
    expect(list).toContainEqual({ name: 'demo', kind: 'recording' });
    expect(list).toContainEqual({ name: 'meeting', kind: 'roleplay' });
  });

  it('skips unparseable scenario files', async () => {
    writeScenario('good', 'recording');
    fs.writeFileSync(path.join(scenariosDir(), 'bad.json'), 'not json {{{');
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/scenarios`);
    const list = (await res.json()) as { name: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('good');
  });

  // ── POST /api/record/start | stop  +  GET /api/record/status ─

  it('transitions idle → recording → idle via the injected controller', async () => {
    const config = await server.start({ recorder: stubRecorder() });
    const base = `http://127.0.0.1:${config.port}`;

    // initially idle
    let res = await fetch(`${base}/api/record/status`);
    expect(await res.json()).toEqual({ recording: false, name: null });

    // start
    res = await fetch(`${base}/api/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'my-take' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recording: true, name: 'my-take' });

    // status reflects recording
    res = await fetch(`${base}/api/record/status`);
    expect(await res.json()).toEqual({ recording: true, name: 'my-take' });

    // starting again → 409
    res = await fetch(`${base}/api/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'other' }),
    });
    expect(res.status).toBe(409);

    // invalid name → 400 (checked before the already-recording guard)
    res = await fetch(`${base}/api/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad name!' }),
    });
    expect(res.status).toBe(400);

    // stop
    res = await fetch(`${base}/api/record/stop`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recording: false });

    // idle again
    res = await fetch(`${base}/api/record/status`);
    expect(await res.json()).toEqual({ recording: false, name: null });
  });

  it('reports idle status and 503 on start when no recorder is wired', async () => {
    const config = await server.start(); // no recorder option
    const base = `http://127.0.0.1:${config.port}`;

    let res = await fetch(`${base}/api/record/status`);
    expect(await res.json()).toEqual({ recording: false, name: null });

    res = await fetch(`${base}/api/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(503);
  });
});
