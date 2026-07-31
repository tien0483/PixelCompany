import { describe, expect, it, vi } from 'vitest';

import { OLLAMA_REQUEST_TIMEOUT_MS } from '../src/constants.js';
import { chatGridStream } from '../src/providers/ai/ollamaClient.js';

describe('ollamaClient', () => {
  it('handles cross-chunk NDJSON buffering', async () => {
    let pullCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (pullCount === 0) {
          controller.enqueue(new TextEncoder().encode('{"message":{"content":"hel'));
        } else if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode('lo"}}\n'));
        } else {
          controller.close();
        }
        pullCount++;
      }
    });

    vi.stubGlobal('fetch', async () => ({
      ok: true,
      body: stream
    }));

    let finalJson = '';
    await chatGridStream({
      model: 'test',
      messages: [],
      onChunk: (chunk) => { finalJson = chunk; }
    });

    expect(finalJson).toBe('hello');
    vi.unstubAllGlobals();
  });

  it('aborts on timeout', async () => {
    vi.stubGlobal('fetch', async (_url: string, options: any) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            reject(new Error('AbortError'));
          });
        }
      });
    });

    vi.useFakeTimers();

    const promise = chatGridStream({
      model: 'test',
      messages: [],
      onChunk: () => {}
    });

    vi.advanceTimersByTime(OLLAMA_REQUEST_TIMEOUT_MS + 100);

    await expect(promise).rejects.toThrow('AbortError');

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
