import type { GenerateSprite, SpriteGenProgress } from '../../core/src/messages.js';
import { chatGridStream } from './providers/ai/ollamaClient.js';

export function gridToText(sprite: string[][]): { text: string; palette: string[] } {
  const palette: string[] = [];
  const paletteMap = new Map<string, number>();
  
  const textLines: string[] = [];
  
  for (const row of sprite) {
    const indices: number[] = [];
    for (const hex of row) {
      if (!hex) {
        indices.push(-1);
      } else {
        if (!paletteMap.has(hex)) {
          paletteMap.set(hex, palette.length);
          palette.push(hex);
        }
        indices.push(paletteMap.get(hex)!);
      }
    }
    textLines.push(indices.map(i => i.toString().padStart(2, ' ')).join(','));
  }
  
  return {
    text: textLines.join('\n'),
    palette
  };
}

// Very basic JSON stream parser to extract partial palette + pixels
export function parsePartialJson(jsonStr: string, width: number, height: number): string[][] | null {
  try {
    // Attempt full parse first
    const obj = JSON.parse(jsonStr);
    if (obj && Array.isArray(obj.palette) && Array.isArray(obj.pixels)) {
      const sprite: string[][] = [];
      for (let y = 0; y < height; y++) {
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
          const rowData = obj.pixels[y];
          const val = rowData ? rowData[x] : undefined;
          if (val === undefined || val === -1 || val >= obj.palette.length) {
            row.push('');
          } else {
            row.push(obj.palette[val] || '');
          }
        }
        sprite.push(row);
      }
      return sprite;
    }
  } catch (e) {
    // If it's partial, we can try to use a regex or resilient JSON parser
    // For now, only update if the JSON is fully well-formed enough or if we write a custom resilient parser.
    // Given the deterministic output of Ollama with structured formats, it often completes rows nicely.
    // Let's implement a very naive fallback to extract pixels if JSON is broken at the end.
    
    // A more advanced approach would use a resilient JSON parser. We'll rely on full parse for now,
    // which means updates might only happen near the end or if the model formats cleanly.
    return null;
  }
  return null;
}

import { runAgentPaint } from './texelEngine.js';

export async function handleGenerateSprite(
  msg: GenerateSprite, 
  onProgress: (prog: SpriteGenProgress) => void
) {
  if (msg.agentMode && msg.palette) {
    try {
      const finalSprite = await runAgentPaint({
        prompt: msg.prompt,
        width: msg.width,
        height: msg.height,
        palette: msg.palette,
        spriteType: msg.spriteType,
        model: msg.model || 'llama3',
        onStep: (canvas) => {
          onProgress({
            type: 'spriteGenProgress',
            requestId: msg.requestId,
            sprite: canvas.toSpriteData(msg.palette!),
            done: false
          });
        }
      });
      onProgress({
        type: 'spriteGenProgress',
        requestId: msg.requestId,
        sprite: finalSprite,
        done: true
      });
    } catch (err: any) {
      console.error('[spriteGen] Agent paint error:', err);
      onProgress({
        type: 'spriteGenProgress',
        requestId: msg.requestId,
        sprite: [],
        done: true,
        error: err.message || 'Agent paint failed'
      });
    }
    return;
  }

  const model = msg.model || 'llama3'; // default fallback
  
  let systemMsg = `You are a pixel art generator.
You must output a JSON object containing a "palette" array (CSS hex colors) and a "pixels" 2D array of integers.
-1 represents a transparent pixel. Other integers are indices into the palette array.
The requested grid size is ${msg.width}x${msg.height}.`;

  let userMsg = `Generate pixel art for: ${msg.prompt}`;

  if (msg.seedSprite && msg.seedSprite.length > 0 && msg.strength !== undefined && msg.strength > 0) {
    const { text, palette } = gridToText(msg.seedSprite);
    systemMsg += `\nThe user has provided a seed sketch. You must preserve the general shape and colors of the seed sketch, refining it based on the prompt. Preservation strength is ${Math.round(msg.strength * 100)}%.`;
    userMsg += `\n\nSeed Palette:\n${JSON.stringify(palette)}\n\nSeed Pixels:\n${text}`;
  }

  const formatSchema = {
    type: "object",
    properties: {
      palette: {
        type: "array",
        items: { type: "string" }
      },
      pixels: {
        type: "array",
        items: {
          type: "array",
          items: { type: "integer" }
        }
      }
    },
    required: ["palette", "pixels"]
  };

  try {
    let lastValidSprite: string[][] = Array.from({ length: msg.height }, () => Array(msg.width).fill(''));
    
    await chatGridStream({
      model,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      format: formatSchema,
      onChunk: (jsonStr) => {
        const sprite = parsePartialJson(jsonStr, msg.width, msg.height);
        if (sprite) {
          lastValidSprite = sprite;
          onProgress({
            type: 'spriteGenProgress',
            requestId: msg.requestId,
            sprite: lastValidSprite,
            done: false
          });
        }
      }
    });

    onProgress({
      type: 'spriteGenProgress',
      requestId: msg.requestId,
      sprite: lastValidSprite,
      done: true
    });
  } catch (err: any) {
    console.error('[spriteGen] Error:', err);
    onProgress({
      type: 'spriteGenProgress',
      requestId: msg.requestId,
      sprite: [],
      done: true,
      error: err.message || 'Ollama not reachable'
    });
  }
}
