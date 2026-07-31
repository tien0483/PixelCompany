/* eslint-disable pixel-agents/no-inline-colors */
import { describe, expect, it } from 'vitest';

import { gridToText, parsePartialJson } from '../src/spriteGen.js';

describe('spriteGen', () => {
  it('gridToText roundtrips sprite to palette and text', () => {
    const sprite = [
      ['#ffffff', ''],
      ['', '#000000']
    ];
    const { text, palette } = gridToText(sprite);
    expect(palette).toEqual(['#ffffff', '#000000']);
    expect(text).toBe(' 0,-1\n-1, 1');
  });

  it('parsePartialJson parses valid full JSON', () => {
    const jsonStr = JSON.stringify({
      palette: ['#ffffff', '#000000'],
      pixels: [
        [0, -1],
        [-1, 1]
      ]
    });
    
    const sprite = parsePartialJson(jsonStr, 2, 2);
    expect(sprite).toEqual([
      ['#ffffff', ''],
      ['', '#000000']
    ]);
  });
  
  it('parsePartialJson returns null for incomplete JSON', () => {
    const jsonStr = '{"palette": ["#ffffff"], "pixel';
    const sprite = parsePartialJson(jsonStr, 2, 2);
    expect(sprite).toBeNull();
  });
});
