import type { SpriteData } from '../types.js';

const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>();

// ── Outline sprite generation ─────────────────────────────────

const outlineCache = new WeakMap<SpriteData, SpriteData>();

/** Generate a 1px white outline SpriteData (2px larger in each dimension) */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineCache.get(sprite);
  if (cached) return cached;

  const rows = sprite.length;
  const cols = sprite[0]?.length ?? 0;
  // Expanded grid: +2 in each dimension for 1px border
  const outline: string[][] = [];
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(''));
  }

  const mark = (r: number, c: number): void => {
    const row = outline[r];
    if (row && row[c] === '') row[c] = '#FFFFFF';
  };

  // For each opaque pixel, mark its 4 cardinal neighbors as white
  for (let r = 0; r < rows; r++) {
    const srcRow = sprite[r];
    if (!srcRow) continue;
    for (let c = 0; c < cols; c++) {
      if (srcRow[c] === '') continue;
      const er = r + 1;
      const ec = c + 1;
      mark(er - 1, ec);
      mark(er + 1, ec);
      mark(er, ec - 1);
      mark(er, ec + 1);
    }
  }

  // Clear pixels that overlap with original opaque pixels
  for (let r = 0; r < rows; r++) {
    const srcRow = sprite[r];
    const outRow = outline[r + 1];
    if (!srcRow || !outRow) continue;
    for (let c = 0; c < cols; c++) {
      if (srcRow[c] !== '') {
        outRow[c + 1] = '';
      }
    }
  }

  outlineCache.set(sprite, outline);
  return outline;
}

export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom);
  if (!cache) {
    cache = new WeakMap();
    zoomCaches.set(zoom, cache);
  }

  const cached = cache.get(sprite);
  if (cached) return cached;

  const rows = sprite.length;
  const cols = sprite[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = cols * zoom;
  canvas.height = rows * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < rows; r++) {
    const row = sprite[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      const color = row[c];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
    }
  }

  cache.set(sprite, canvas);
  return canvas;
}
