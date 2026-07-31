import { OLLAMA_REQUEST_TIMEOUT_MS } from '../../constants.js';

const OLLAMA_HOST = 'http://localhost:11434';

export interface OllamaModel {
  name: string;
  size: number;
}

export async function listModels(): Promise<OllamaModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models?: { name: string; size: number }[] };
    return data.models || [];
  } catch (err) {
    console.error('[ollamaClient] listModels failed:', err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: any;
}

export interface ChatMessageWithTools extends ChatMessage {
  tool_calls?: { function: ToolCall }[];
}

export interface ChatWithToolsParams {
  model: string;
  messages: ChatMessageWithTools[];
  tools: any[];
}

export async function chatWithTools({ model, messages, tools }: ChatWithToolsParams): Promise<ChatMessageWithTools> {
  const reqBody = {
    model,
    messages,
    tools,
    stream: false,
    options: { temperature: 0.1 }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[ollamaClient] chatWithTools failed: HTTP ${res.status} ${text}`);
    }

    const data = await res.json() as { message: ChatMessageWithTools };
    return data.message;
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatGridStreamParams {
  model: string;
  messages: ChatMessage[];
  format?: any; // JSON schema
  onChunk: (partialJson: string) => void;
}

export async function chatGridStream({ model, messages, format, onChunk }: ChatGridStreamParams): Promise<void> {
  const reqBody = {
    model,
    messages,
    format,
    stream: true,
    options: {
      temperature: 0.1, // low temp for deterministic JSON parsing
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      throw new Error(`[ollamaClient] chat failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let currentJson = '';

    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              currentJson += parsed.message.content;
              onChunk(currentJson);
            }
          } catch (e) {
            // Ignore genuinely malformed lines
          }
        }
      }
      
      const tail = buffer.trim();
      if (tail) {
        try {
          const p = JSON.parse(tail);
          if (p.message?.content) {
            currentJson += p.message.content;
            onChunk(currentJson);
          }
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
  }
}
