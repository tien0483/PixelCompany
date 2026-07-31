import type { ServerMessage } from '../../core/src/messages.js';
import type { Scenario } from '../../core/src/scenario.js';
import { chatGridStream, listModels } from './providers/ai/ollamaClient.js';

export type NarrationStyle = 'roleplay' | 'caveman';

export interface NarrationItem {
  tMs: number;
  text: string;
  style: NarrationStyle;
}

/**
 * Deterministic template fallback if Ollama is down.
 */
function generateFallbackNarration(
  events: { tMs: number; message: ServerMessage }[],
  style: NarrationStyle,
): NarrationItem[] {
  const narration: NarrationItem[] = [];
  
  for (const { tMs, message } of events) {
    let text = '';
    
    if (message.type === 'agentCreated') {
      text = style === 'caveman' 
        ? 'New agent come.' 
        : `A new agent has arrived at the office.`;
    } else if (message.type === 'agentClosed') {
      text = style === 'caveman' 
        ? 'Agent go away.' 
        : `An agent has departed from the office.`;
    } else if (message.type === 'agentToolStart') {
      text = style === 'caveman' 
        ? 'Agent use tool.' 
        : `The agent begins working on a task using a tool.`;
    } else if (message.type === 'agentToolDone') {
      text = style === 'caveman' 
        ? 'Tool done.' 
        : `The agent has successfully completed their task.`;
    }
    
    if (text) {
      narration.push({ tMs, text, style });
    }
  }
  
  return narration;
}

export async function generateNarrationForScenario(
  scenario: Scenario,
): Promise<NarrationItem[]> {
  if (!scenario.events || scenario.events.length === 0) {
    return [];
  }

  const narration: NarrationItem[] = [];

  let modelName = '';
  try {
    const models = await listModels();
    if (models.length > 0) {
      modelName = models[0].name;
    }
  } catch (err) {
    console.warn(`[ScenarioNarrator] listModels failed, using fallback.`);
  }

  for (const style of ['roleplay', 'caveman'] as NarrationStyle[]) {
    try {
      if (!modelName) throw new Error('No Ollama model available');
      const styleNarration = await generateStyleNarration(scenario.events, style, modelName);
      narration.push(...styleNarration);
    } catch (err) {
      console.warn(`[ScenarioNarrator] Failed to generate ${style} narration via Ollama, using fallback: ${String(err)}`);
      const fallback = generateFallbackNarration(scenario.events, style);
      narration.push(...fallback);
    }
  }

  // Sort by time
  narration.sort((a, b) => a.tMs - b.tMs);
  return narration;
}

async function generateStyleNarration(
  events: { tMs: number; message: ServerMessage }[],
  style: NarrationStyle,
  model: string,
): Promise<NarrationItem[]> {
  const salientEvents = events.filter(e => 
    e.message.type === 'agentToolStart' || 
    e.message.type === 'agentToolDone' || 
    e.message.type === 'agentCreated' ||
    e.message.type === 'agentClosed'
  );

  if (salientEvents.length === 0) return [];

  // Create a JSON representation of the timeline
  const timelineJson = salientEvents.map(e => {
    const m = e.message;
    const base: Record<string, unknown> = { tMs: e.tMs, type: m.type };
    if (m.type === 'agentCreated') { base.id = m.id; if (m.folderName) base.folder = m.folderName; }
    else if (m.type === 'agentClosed') { base.id = m.id; }
    else if (m.type === 'agentToolStart') { base.id = m.id; if (m.toolName) base.tool = m.toolName; if (m.status) base.status = m.status; }
    else if (m.type === 'agentToolDone') { base.id = m.id; }
    return base;
  });

  const systemPrompt = style === 'caveman'
    ? 'You are a caveman. Summarize the following event timeline in very short, primitive sentences (e.g. "Alice read file. Alice write code."). Refer to agents by their id or folder; use status/tool to describe the action. Reply ONLY in JSON array format: [{"tMs": number, "text": "caveman sentence"}]. Ensure you cover the events accurately. DO NOT include markdown formatting or markdown code blocks like ```json.'
    : 'You are an RPG game narrator. Summarize the following event timeline into engaging, dramatic sentences. Refer to agents by their id or folder; use status/tool to describe the action. Reply ONLY in JSON array format: [{"tMs": number, "text": "narrator sentence"}]. Ensure you cover the events accurately. DO NOT include markdown formatting or markdown code blocks like ```json.';

  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        tMs: { type: "integer" },
        text: { type: "string" }
      },
      required: ["tMs", "text"]
    }
  };

  let finalJson = '';
  await chatGridStream({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(timelineJson, null, 2) }
    ],
    format: schema,
    onChunk: (chunk) => {
      finalJson = chunk;
    }
  });

  const parsed = JSON.parse(finalJson) as { tMs: number; text: string }[];
  if (!Array.isArray(parsed)) throw new Error('Ollama did not return an array');

  return parsed.map(p => ({
    tMs: p.tMs,
    text: p.text,
    style
  }));
}
