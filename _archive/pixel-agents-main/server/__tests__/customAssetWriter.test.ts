/* eslint-disable pixel-agents/no-inline-colors */
import * as fs from 'fs';
import { homedir, tmpdir } from 'os';
import * as path from 'path';
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveCustomAsset } from '../../core/src/messages.js';
import { loadFurnitureAssets } from '../src/assetLoader.js';
import { writeCustomAsset } from '../src/customAssetWriter.js';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe('customAssetWriter', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(tmpdir(), 'pixel-agents-test-'));
    (homedir as any).mockReturnValue(tmpHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes a custom asset, generates files, and allows loading them back', async () => {
    const msg: SaveCustomAsset = {
      type: 'saveCustomAsset',
      name: 'Test Desk 123!',
      category: 'desks',
      width: 2,
      height: 2,
      footprintW: 1,
      footprintH: 1,
      backgroundTiles: 0,
      sprite: [
        ['#FF0000', ''],
        ['', '#00FF00']
      ]
    };

    const res = writeCustomAsset(msg);
    expect(res.id).toBe('TEST_DESK_123_');
    
    // Check if files exist
    const manifestPath = path.join(res.dir, 'manifest.json');
    const pngPath = path.join(res.dir, 'TEST_DESK_123_.png');
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(pngPath)).toBe(true);

    // Verify loading
    const customAssetsRoot = path.join(tmpHome, '.pixel-agents', 'custom-assets');
    const loaded = await loadFurnitureAssets(customAssetsRoot);
    
    expect(loaded).not.toBeNull();
    expect(loaded!.catalog.length).toBe(1);
    expect(loaded!.catalog[0].id).toBe('TEST_DESK_123_');
    expect(loaded!.catalog[0].category).toBe('desks');
    
    const spriteData = loaded!.sprites.get('TEST_DESK_123_');
    expect(spriteData).toBeDefined();
    expect(spriteData!.length).toBe(2);
    // decode returns lowercased #rrggbbaa depending on decoder
    expect(spriteData![0][0].toLowerCase()).toMatch(/#ff0000/i);
    expect(spriteData![0][1]).toBe(''); // empty
    expect(spriteData![1][0]).toBe('');
    expect(spriteData![1][1].toLowerCase()).toMatch(/#00ff00/i);
  });

  it('rejects invalid dimensions', () => {
    const msg = {
      type: 'saveCustomAsset',
      name: 'Bad',
      category: 'desks',
      width: 0,
      height: 10,
      footprintW: 1,
      footprintH: 1,
      sprite: []
    } as any;

    expect(() => writeCustomAsset(msg)).toThrow('Dimensions out of bounds');
  });
});
