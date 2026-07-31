import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import type { AgentState } from './types.js';

/**
 * Runtime recording controller injected by the standalone CLI. Lets the plain
 * HTTP record endpoints (/api/record/*) create and stop a ScenarioRecorder
 * without any AsyncAPI/WebSocket protocol change. Optional: absent in embedded
 * (VS Code) mode, where recording is not offered.
 */
export interface RecorderController {
  /** Begin recording to `<name>.json`. Caller has already validated the name. */
  start(name: string): void;
  /** Stop the active recording (flushes + generates narration). No-op if idle. */
  stop(): Promise<void>;
  /** Current recording state for the REC indicator / status polling. */
  status(): { recording: boolean; name: string | null };
}

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** Recording controller (standalone only). Wires the /api/record/* endpoints to a ScenarioRecorder. */
  recorder?: RecorderController;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);
  registerScenariosRoute(app);
  registerRecordRoutes(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── Scenarios ──────────────────────────────────────────────────

function registerScenariosRoute(app: FastifyInstance): void {
  // List saved scenarios as [{ name, kind }]. Mirrors the single-scenario route's
  // os.homedir() path; returns an empty array if the directory does not exist and
  // skips any file that fails to parse.
  app.get('/api/scenarios', async (_request, reply) => {
    const scenariosDir = path.join(os.homedir(), '.pixel-agents', 'scenarios');
    let files: string[];
    try {
      files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith('.json'));
    } catch {
      reply.send([]);
      return;
    }

    const scenarios: { name: string; kind: string }[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(scenariosDir, file), 'utf8');
        const parsed = JSON.parse(raw) as { kind?: string };
        scenarios.push({ name: file.replace(/\.json$/, ''), kind: parsed.kind ?? 'recording' });
      } catch {
        // Skip unparseable / partially-written scenario files.
      }
    }
    reply.send(scenarios);
  });

  app.get<{ Params: { name: string } }>(
    '/api/scenarios/:name',
    async (request, reply) => {
      const { name } = request.params;
      // Basic validation to prevent path traversal
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        reply.code(400).send('Invalid scenario name');
        return;
      }

      const scenariosDir = path.join(os.homedir(), '.pixel-agents', 'scenarios');
      const scenarioPath = path.join(scenariosDir, `${name}.json`);

      if (!fs.existsSync(scenarioPath)) {
        reply.code(404).send('Scenario not found');
        return;
      }

      const scenario = fs.readFileSync(scenarioPath, 'utf8');
      reply.type('application/json').send(scenario);
    },
  );

  // Delete a saved scenario.
  app.delete<{ Params: { name: string } }>('/api/scenarios/:name', async (request, reply) => {
    const { name } = request.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      reply.code(400).send('Invalid scenario name');
      return;
    }
    const scenarioPath = path.join(os.homedir(), '.pixel-agents', 'scenarios', `${name}.json`);
    try {
      fs.unlinkSync(scenarioPath);
      reply.send({ ok: true });
    } catch {
      reply.code(404).send('Scenario not found');
    }
  });

  // Save (author/overwrite) a scenario. Used by the in-UI script editor (FIX-11)
  // to persist a roleplay Scenario over plain HTTP — no AsyncAPI/WebSocket change.
  // Validates the name (path-traversal guard, same regex as the GET route) and a
  // minimal shape (`kind` + `script`|`events`), then writes atomically (tmp +
  // rename) so a reader never observes a half-written file.
  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
    '/api/scenarios/:name',
    async (request, reply) => {
      const { name } = request.params;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        reply.code(400).send('Invalid scenario name');
        return;
      }

      const body = request.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof body.kind !== 'string' ||
        (!('script' in body) && !('events' in body))
      ) {
        reply.code(400).send('Invalid scenario body');
        return;
      }

      const scenariosDir = path.join(os.homedir(), '.pixel-agents', 'scenarios');
      fs.mkdirSync(scenariosDir, { recursive: true });
      const scenarioPath = path.join(scenariosDir, `${name}.json`);
      const tmpPath = `${scenarioPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2));
      fs.renameSync(tmpPath, scenarioPath);

      reply.send({ ok: true });
    },
  );

  // Custom live-agent display names. Reads ~/.pixel-agents/agent-names.json, a flat
  // { "<agentId or folderName>": "<name>" } map. Returns {} if missing/invalid.
  app.get('/api/agent-names', async (_request, reply) => {
    try {
      const p = path.join(os.homedir(), '.pixel-agents', 'agent-names.json');
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      reply.send(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      reply.send({});
    }
  });

  // Persist a single custom agent name (chat-driven naming rule). Merges
  // { [id]: name } into ~/.pixel-agents/agent-names.json (atomic tmp+rename).
  app.post<{ Body: { id?: number | string; name?: string } }>(
    '/api/agent-names',
    async (request, reply) => {
      const { id, name } = request.body ?? {};
      if (id === undefined || typeof name !== 'string' || !name.trim()) {
        reply.code(400).send('Missing id or name');
        return;
      }
      const dir = path.join(os.homedir(), '.pixel-agents');
      const p = path.join(dir, 'agent-names.json');
      let current: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          current = parsed as Record<string, unknown>;
        }
      } catch {
        // No existing file / invalid — start fresh.
      }
      current[String(id)] = name.trim();
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
      fs.renameSync(tmp, p);
      reply.send({ ok: true });
    },
  );

  // Proxy Ollama's model list through the server — the browser hitting
  // localhost:11434 directly is cross-origin and Ollama blocks it (CORS).
  app.get('/api/ollama/models', async (_request, reply) => {
    try {
      const { listModels } = await import('./providers/ai/ollamaClient.js');
      reply.send({ models: await listModels() });
    } catch {
      reply.send({ models: [] });
    }
  });
}

// ── Recording control ──────────────────────────────────────────

/**
 * Plain-HTTP recording control (standalone only). Delegates to the injected
 * {@link RecorderController}; no AsyncAPI/WebSocket protocol involvement. When no
 * recorder is wired (embedded mode), start/stop return 503 and status reports idle.
 */
function registerRecordRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Body: { name?: string } }>('/api/record/start', async (request, reply) => {
    const { recorder } = options;
    if (!recorder) {
      reply.code(503).send('Recording not available');
      return;
    }
    const name = request.body?.name;
    // Same validation as the scenarios route to prevent path traversal.
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      reply.code(400).send('Invalid scenario name');
      return;
    }
    if (recorder.status().recording) {
      reply.code(409).send({ error: 'Already recording', ...recorder.status() });
      return;
    }
    recorder.start(name);
    reply.send({ recording: true, name });
  });

  app.post('/api/record/stop', async (_request, reply) => {
    const { recorder } = options;
    if (!recorder) {
      reply.code(503).send('Recording not available');
      return;
    }
    await recorder.stop();
    reply.send({ recording: false });
  });

  app.get('/api/record/status', async (_request, reply) => {
    const { recorder } = options;
    reply.send(recorder ? recorder.status() : { recording: false, name: null });
  });
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // In standalone mode (not embedded), skip auth for WebSocket connections.
    // The server binds to 127.0.0.1, so only local clients can connect.
    // In embedded mode (VS Code), require Bearer token for security.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      const msg = storeEventToMessage('agentAdded', id, agent);
      if (msg) safeSend(socket, msg);
    };

    const onAgentRemoved = (id: number) => {
      const msg = storeEventToMessage('agentRemoved', id);
      if (msg) safeSend(socket, msg);
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      const msg = storeEventToMessage('broadcast', message);
      if (msg) safeSend(socket, msg);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Maps AgentStateStore events to their corresponding ServerMessage payloads.
 * Shared between the live WebSocket emitter and the ScenarioRecorder.
 */
export function storeEventToMessage(
  event: 'agentAdded' | 'agentRemoved' | 'broadcast',
  ...args: any[]
): Record<string, unknown> | null {
  if (event === 'agentAdded') {
    const id = args[0] as number;
    const agent = args[1] as AgentState;
    return {
      type: 'agentCreated',
      id,
      folderName: agent.folderName,
      isExternal: agent.isExternal || undefined,
      isTeammate: agent.leadAgentId !== undefined || undefined,
      teammateName: agent.agentName,
      parentAgentId: agent.leadAgentId,
      teamName: agent.teamName,
      hooksOnly: agent.hooksOnly || undefined,
    };
  } else if (event === 'agentRemoved') {
    const id = args[0] as number;
    return { type: 'agentClosed', id };
  } else if (event === 'broadcast') {
    return args[0] as Record<string, unknown>;
  }
  return null;
}
