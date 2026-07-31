import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';

import type { SaveCustomAsset } from '../../core/src/messages.js';
import { readConfig, writeConfig } from './configPersistence.js';
import { LAYOUT_FILE_DIR } from './constants.js';

export function writeCustomAsset(msg: SaveCustomAsset): { id: string; dir: string } {
  let id = msg.id;
  if (!id) {
    id = msg.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }
  if (!id) {
    id = 'CUSTOM_ASSET';
  }

  if (!Number.isFinite(msg.width) || !Number.isFinite(msg.height)) {
    throw new Error('Invalid dimensions');
  }
  if (msg.width <= 0 || msg.height <= 0 || msg.width * msg.height > 1024 * 1024) {
    throw new Error('Dimensions out of bounds');
  }

  const baseDir = path.join(os.homedir(), LAYOUT_FILE_DIR, 'custom-assets');
  const assetDir = path.join(baseDir, 'assets', 'furniture', id);
  
  if (!fs.existsSync(assetDir)) {
    fs.mkdirSync(assetDir, { recursive: true });
  }

  const orientations = msg.orientations && msg.orientations.length > 0
    ? msg.orientations
    : [{ orientation: 'front' as const, sprite: msg.sprite, width: msg.width, height: msg.height }];

  const generatePngBuffer = (w: number, h: number, spriteData: string[][]) => {
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const hex = spriteData[y]?.[x] || '';
        const idx = (w * y + x) << 2;
        if (!hex) {
          png.data[idx] = 0;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 0;
        } else {
          const r = parseInt(hex.slice(1, 3), 16) || 0;
          const g = parseInt(hex.slice(3, 5), 16) || 0;
          const b = parseInt(hex.slice(5, 7), 16) || 0;
          const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) || 0 : 255;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = a;
        }
      }
    }
    return PNG.sync.write(png);
  };

  let manifest: any;

  if (orientations.length === 1) {
    manifest = {
      id: id,
      name: msg.name,
      category: msg.category,
      type: 'asset',
      canPlaceOnWalls: !!msg.canPlaceOnWalls,
      canPlaceOnSurfaces: !!msg.canPlaceOnSurfaces,
      backgroundTiles: msg.backgroundTiles || 0,
      width: orientations[0].width,
      height: orientations[0].height,
      footprintW: msg.footprintW,
      footprintH: msg.footprintH
    };

    const pngPath = path.join(assetDir, id + '.png');
    fs.writeFileSync(pngPath + '.tmp', generatePngBuffer(orientations[0].width, orientations[0].height, orientations[0].sprite));
    fs.renameSync(pngPath + '.tmp', pngPath);
  } else {
    const hasSide = orientations.some(o => o.orientation === 'side');
    const rotationScheme = hasSide ? '3-way-mirror' : '2-way';

    manifest = {
      id: id,
      name: msg.name,
      category: msg.category,
      type: 'group',
      groupType: 'rotation',
      rotationScheme,
      canPlaceOnWalls: !!msg.canPlaceOnWalls,
      canPlaceOnSurfaces: !!msg.canPlaceOnSurfaces,
      backgroundTiles: msg.backgroundTiles || 0,
      members: orientations.map(o => {
        const memberId = `${id}_${o.orientation.toUpperCase()}`;
        const fileName = `${memberId}.png`;
        
        const pngPath = path.join(assetDir, fileName);
        fs.writeFileSync(pngPath + '.tmp', generatePngBuffer(o.width, o.height, o.sprite));
        fs.renameSync(pngPath + '.tmp', pngPath);

        const member: any = {
          type: 'asset',
          id: memberId,
          file: fileName,
          width: o.width,
          height: o.height,
          footprintW: msg.footprintW,
          footprintH: msg.footprintH,
          orientation: o.orientation
        };
        if (o.orientation === 'side') {
          member.mirrorSide = true;
        }
        return member;
      })
    };
  }

  const manifestPath = path.join(assetDir, 'manifest.json');
  fs.writeFileSync(manifestPath + '.tmp', JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(manifestPath + '.tmp', manifestPath);

  const config = readConfig();
  if (!config.externalAssetDirectories.includes(baseDir)) {
    config.externalAssetDirectories.push(baseDir);
    writeConfig(config);
  }

  return { id, dir: assetDir };
}
