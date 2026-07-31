/* eslint-disable pixel-agents/no-inline-colors */
import { describe, expect, test, vi } from 'vitest';

import * as ollamaClient from '../src/providers/ai/ollamaClient.js';
import { Canvas, runAgentPaint } from '../src/texelEngine.js';

describe('texelEngine Canvas', () => {
  test('Canvas initialization and setPixel', () => {
    const canvas = new Canvas(4, ['#FF0000', '#00FF00']);
    expect(canvas.getPixel(0, 0)).toBe(-1);
    canvas.setPixel(0, 0, 0);
    expect(canvas.getPixel(0, 0)).toBe(0);
    canvas.setPixel(3, 3, 1);
    expect(canvas.getPixel(3, 3)).toBe(1);
    // Out of bounds should return -1
    expect(canvas.getPixel(4, 4)).toBe(-1);
  });

  test('Canvas fillRect', () => {
    const canvas = new Canvas(4, ['#FF0000', '#00FF00']);
    canvas.fillRect(1, 1, 2, 2, 1);
    expect(canvas.getPixel(1, 1)).toBe(1);
    expect(canvas.getPixel(2, 2)).toBe(1);
    expect(canvas.getPixel(0, 0)).toBe(-1);
  });

  test('Canvas drawLine', () => {
    const canvas = new Canvas(4, ['#FF0000']);
    canvas.drawLine(0, 0, 2, 2, 0);
    expect(canvas.getPixel(0, 0)).toBe(0);
    expect(canvas.getPixel(1, 1)).toBe(0);
    expect(canvas.getPixel(2, 2)).toBe(0);
    expect(canvas.getPixel(0, 1)).toBe(-1);
  });

  test('Canvas toSpriteData index->hex incl. -1->""', () => {
    const palette = ['#FF0000', '#00FF00'];
    const canvas = new Canvas(2, palette);
    canvas.setPixel(0, 0, 0);
    canvas.setPixel(1, 1, 1);
    const sprite = canvas.toSpriteData(palette);
    expect(sprite).toEqual([
      ['#FF0000', ''],
      ['', '#00FF00']
    ]);
  });
});

describe('texelEngine runAgentPaint', () => {
  test('Agent loop with mocked tool calls', async () => {
    const palette = ['#000000', '#FFFFFF'];
    
    // Mock the chatWithTools function
    let callCount = 0;
    const mockChatWithTools = vi.spyOn(ollamaClient, 'chatWithTools').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'fill_rect', arguments: { x1: 0, y1: 0, x2: 1, y2: 1, color: 0 } } }
          ]
        };
      } else if (callCount === 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'draw_pixel', arguments: { x: 0, y: 0, color: 1 } } }
          ]
        };
      } else {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'finish', arguments: {} } }
          ]
        };
      }
    });

    const sprite = await runAgentPaint({
      prompt: 'test',
      width: 2,
      height: 2,
      palette,
      model: 'test-model',
      maxSteps: 5
    });

    expect(sprite).toEqual([
      ['#FFFFFF', '#000000'],
      ['#000000', '#000000']
    ]);
    
    expect(mockChatWithTools).toHaveBeenCalledTimes(3);
    mockChatWithTools.mockRestore();
  });
});
