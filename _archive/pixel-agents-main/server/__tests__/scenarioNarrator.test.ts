import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import type { Scenario } from '../../core/src/scenario.js';
import * as ollamaClient from '../src/providers/ai/ollamaClient.js';
import { generateNarrationForScenario } from '../src/scenarioNarrator.js';

// Mock the ollamaClient module completely
vi.mock('../src/providers/ai/ollamaClient.js', () => {
  return {
    listModels: vi.fn(),
    chatGridStream: vi.fn(),
  };
});

describe('generateNarrationForScenario', () => {
  const mockScenario: Scenario = {
    schemaVersion: 1,
    name: 'test',
    kind: 'recording',
    startedAt: 1000,
    events: [
      { tMs: 100, message: { type: 'agentCreated', id: 1, isSubagent: false } as unknown as ServerMessage },
      { tMs: 200, message: { type: 'agentToolStart', id: 1, toolName: 'readFile' } as unknown as ServerMessage },
      { tMs: 300, message: { type: 'agentToolDone', id: 1, success: true } as unknown as ServerMessage },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses fallback if listModels fails', async () => {
    vi.mocked(ollamaClient.listModels).mockRejectedValue(new Error('Connection refused'));

    const narration = await generateNarrationForScenario(mockScenario);

    expect(ollamaClient.listModels).toHaveBeenCalledTimes(1);
    expect(ollamaClient.chatGridStream).not.toHaveBeenCalled();
    
    // Fallback returns 2 styles * 3 salient events = 6 items
    expect(narration.length).toBe(6);
    expect(narration.some(n => n.style === 'roleplay' && n.text.includes('arrived'))).toBe(true);
    expect(narration.some(n => n.style === 'caveman' && n.text.includes('New agent'))).toBe(true);
  });

  it('uses fallback if chatGridStream fails', async () => {
    vi.mocked(ollamaClient.listModels).mockResolvedValue([{ name: 'llama3', size: 100 }]);
    vi.mocked(ollamaClient.chatGridStream).mockRejectedValue(new Error('Generation failed'));

    const narration = await generateNarrationForScenario(mockScenario);

    expect(ollamaClient.listModels).toHaveBeenCalledTimes(1);
    // It tries for each style, so 2 times
    expect(ollamaClient.chatGridStream).toHaveBeenCalledTimes(2);
    
    expect(narration.length).toBe(6);
    expect(narration.some(n => n.style === 'roleplay' && n.text.includes('arrived'))).toBe(true);
  });

  it('generates narration via Ollama successfully', async () => {
    vi.mocked(ollamaClient.listModels).mockResolvedValue([{ name: 'llama3', size: 100 }]);
    
    vi.mocked(ollamaClient.chatGridStream).mockImplementation(async ({ onChunk }: any) => {
      const mockResult = [
        { tMs: 100, text: 'Agent spawns.' },
        { tMs: 200, text: 'Starts reading.' },
        { tMs: 300, text: 'Done reading.' },
      ];
      onChunk(JSON.stringify(mockResult));
    });

    const narration = await generateNarrationForScenario(mockScenario);

    expect(ollamaClient.listModels).toHaveBeenCalledTimes(1);
    expect(ollamaClient.chatGridStream).toHaveBeenCalledTimes(2);

    // 2 styles * 3 items = 6 items
    expect(narration.length).toBe(6);
    
    const roleplays = narration.filter(n => n.style === 'roleplay');
    expect(roleplays.length).toBe(3);
    expect(roleplays[0].text).toBe('Agent spawns.');
    expect(roleplays[0].tMs).toBe(100);
  });

  it('passes enriched timeline data to Ollama', async () => {
    vi.mocked(ollamaClient.listModels).mockResolvedValue([{ name: 'llama3', size: 100 }]);
    vi.mocked(ollamaClient.chatGridStream).mockImplementation(async ({ onChunk }: any) => {
      onChunk('[]');
    });

    const enrichedScenario: Scenario = {
      schemaVersion: 1,
      name: 'enriched',
      kind: 'recording',
      startedAt: 1000,
      events: [
        { tMs: 100, message: { type: 'agentCreated', id: 1, folderName: 'my-project', isSubagent: false } as unknown as ServerMessage },
        { tMs: 200, message: { type: 'agentToolStart', id: 1, toolName: 'readFile', status: 'Reading file.txt' } as unknown as ServerMessage },
      ],
    };

    await generateNarrationForScenario(enrichedScenario);

    expect(ollamaClient.chatGridStream).toHaveBeenCalledTimes(2);
    const firstCallArgs = vi.mocked(ollamaClient.chatGridStream).mock.calls[0][0] as any;
    const userMessage = firstCallArgs.messages.find((m: any) => m.role === 'user').content;
    const parsedTimeline = JSON.parse(userMessage);

    expect(parsedTimeline).toEqual([
      { tMs: 100, type: 'agentCreated', id: 1, folder: 'my-project' },
      { tMs: 200, type: 'agentToolStart', id: 1, tool: 'readFile', status: 'Reading file.txt' },
    ]);
  });
});
