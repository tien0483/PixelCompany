import { TEXEL_AGENT_MAX_STEPS } from './constants.js';
import { ChatMessageWithTools, chatWithTools } from './providers/ai/ollamaClient.js';

export class Canvas {
  size: number;
  palette: string[];
  pixels: number[][];

  constructor(size: number, palette: string[], pixels?: number[][]) {
    this.size = size;
    this.palette = palette;
    if (pixels) {
      this.pixels = pixels;
    } else {
      this.pixels = Array.from({ length: size }, () => Array(size).fill(-1));
    }
  }

  setPixel(x: number, y: number, color: number): string {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return `Error: (${x},${y}) out of bounds`;
    if (color < -1 || color >= this.palette.length) return `Error: color index ${color} invalid`;
    this.pixels[y][x] = color;
    return `Set (${x},${y}) to ${color}`;
  }

  getPixel(x: number, y: number): number {
    if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
      return this.pixels[y][x];
    }
    return -1;
  }

  fillRect(x1: number, y1: number, x2: number, y2: number, color: number): string {
    if (color < -1 || color >= this.palette.length) return `Error: color index ${color} invalid`;
    let count = 0;
    for (let y = Math.max(0, y1); y <= Math.min(this.size - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(this.size - 1, x2); x++) {
        this.pixels[y][x] = color;
        count++;
      }
    }
    return `Filled rect (${x1},${y1})-(${x2},${y2}) with ${color}, ${count} pixels`;
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color: number): string {
    if (color < -1 || color >= this.palette.length) return `Error: color index ${color} invalid`;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let count = 0;
    let cx = x1, cy = y1;
    while (true) {
      if (cx >= 0 && cx < this.size && cy >= 0 && cy < this.size) {
        this.pixels[cy][cx] = color;
        count++;
      }
      if (cx === x2 && cy === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return `Drew line, ${count} pixels`;
  }

  fillRow(y: number, xStart: number, xEnd: number, color: number): string {
    if (color < -1 || color >= this.palette.length) return `Error: color index ${color} invalid`;
    let count = 0;
    for (let x = Math.max(0, xStart); x <= Math.min(this.size - 1, xEnd); x++) {
      if (y >= 0 && y < this.size) {
        this.pixels[y][x] = color;
        count++;
      }
    }
    return `Filled row y=${y}, ${count} pixels`;
  }

  fillColumn(x: number, yStart: number, yEnd: number, color: number): string {
    if (color < -1 || color >= this.palette.length) return `Error: color index ${color} invalid`;
    let count = 0;
    for (let y = Math.max(0, yStart); y <= Math.min(this.size - 1, yEnd); y++) {
      if (x >= 0 && x < this.size) {
        this.pixels[y][x] = color;
        count++;
      }
    }
    return `Filled column x=${x}, ${count} pixels`;
  }

  drawRotatedRect(cx: number, cy: number, w: number, h: number, angleDeg: number, color: number): number {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const hw = w / 2, hh = h / 2;
    const maxR = Math.ceil(Math.sqrt(hw * hw + hh * hh)) + 1;
    let count = 0;
    for (let py = Math.max(0, cy - maxR); py <= Math.min(this.size - 1, cy + maxR); py++) {
      for (let px = Math.max(0, cx - maxR); px <= Math.min(this.size - 1, cx + maxR); px++) {
        const dx = px - cx;
        const dy = py - cy;
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
          if (py >= 0 && py < this.size && px >= 0 && px < this.size) {
            this.pixels[py][px] = color;
            count++;
          }
        }
      }
    }
    return count;
  }

  drawCircle(cx: number, cy: number, radius: number, color: number, fill: boolean = true): number {
    let count = 0;
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.size - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(this.size - 1, cx + radius); x++) {
        const dx = x - cx, dy = y - cy;
        const distSq = dx * dx + dy * dy;
        const rSq = radius * radius;
        if (fill) {
          if (distSq <= rSq) {
            this.pixels[y][x] = color;
            count++;
          }
        } else {
          if (Math.abs(distSq - rSq) <= radius * 2) {
            this.pixels[y][x] = color;
            count++;
          }
        }
      }
    }
    return count;
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number, color: number, fill: boolean = true): number {
    let count = 0;
    for (let y = Math.max(0, cy - ry); y <= Math.min(this.size - 1, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x <= Math.min(this.size - 1, cx + rx); x++) {
        const dx = (x - cx) / Math.max(rx, 1);
        const dy = (y - cy) / Math.max(ry, 1);
        const dist = dx * dx + dy * dy;
        if (fill) {
          if (dist <= 1.0) {
            this.pixels[y][x] = color;
            count++;
          }
        } else {
          if (Math.abs(dist - 1.0) <= 0.3) {
            this.pixels[y][x] = color;
            count++;
          }
        }
      }
    }
    return count;
  }

  drawTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: number): number {
    const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      return (px - bx) * (ay - by) - (ax - bx) * (py - by);
    };
    const minX = Math.max(0, Math.min(x1, x2, x3));
    const maxX = Math.min(this.size - 1, Math.max(x1, x2, x3));
    const minY = Math.max(0, Math.min(y1, y2, y3));
    const maxY = Math.min(this.size - 1, Math.max(y1, y2, y3));
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d1 = sign(x, y, x1, y1, x2, y2);
        const d2 = sign(x, y, x2, y2, x3, y3);
        const d3 = sign(x, y, x3, y3, x1, y1);
        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        if (!(hasNeg && hasPos)) {
          this.pixels[y][x] = color;
          count++;
        }
      }
    }
    return count;
  }

  private hashNoise(x: number, y: number, seed: number): number {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177) & 0x7fffffff;
    n = n ^ (n >>> 16);
    return (n & 0x7fffffff) / 0x7fffffff;
  }

  fillNoise(x1: number, y1: number, x2: number, y2: number, colors: number[], seed: number = 42, scale: number = 1.0): number {
    let count = 0;
    const nColors = colors.length;
    if (nColors === 0) return 0;
    for (let y = Math.max(0, y1); y <= Math.min(this.size - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(this.size - 1, x2); x++) {
        const n = this.hashNoise(Math.floor(x * scale), Math.floor(y * scale), seed);
        const idx = Math.floor(n * nColors) % nColors;
        this.pixels[y][x] = colors[idx];
        count++;
      }
    }
    return count;
  }

  fillVoronoi(x1: number, y1: number, x2: number, y2: number, colors: number[], numPoints: number = 8, seed: number = 42): number {
    const w = x2 - x1 + 1;
    const h = y2 - y1 + 1;
    const points: [number, number, number][] = [];
    for (let i = 0; i < numPoints; i++) {
      const px = x1 + Math.floor(this.hashNoise(i, 0, seed) * w);
      const py = y1 + Math.floor(this.hashNoise(0, i, seed + 99) * h);
      points.push([px, py, colors[i % colors.length]]);
    }
    let count = 0;
    for (let y = Math.max(0, y1); y <= Math.min(this.size - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(this.size - 1, x2); x++) {
        let bestDist = Infinity;
        let bestColor = colors[0];
        for (const [px, py, pc] of points) {
          const d = (x - px) ** 2 + (y - py) ** 2;
          if (d < bestDist) {
            bestDist = d;
            bestColor = pc;
          }
        }
        this.pixels[y][x] = bestColor;
        count++;
      }
    }
    return count;
  }

  fillNoiseCircle(cx: number, cy: number, radius: number, colors: number[], seed: number = 42): number {
    let count = 0;
    const nColors = colors.length;
    if (nColors === 0) return 0;
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.size - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(this.size - 1, cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
          const n = this.hashNoise(x, y, seed);
          this.pixels[y][x] = colors[Math.floor(n * nColors) % nColors];
          count++;
        }
      }
    }
    return count;
  }

  toGridString(): string {
    const header = "    " + Array.from({ length: this.size }, (_, i) => String(i).padStart(3, ' ')).join(" ");
    const rows = this.pixels.map((row, y) => {
      return String(y).padStart(3, ' ') + " " + row.map(v => String(v).padStart(3, ' ')).join(" ");
    });
    return header + "\n" + rows.join("\n");
  }

  toVisualGrid(): string {
    const char = (v: number) => {
      if (v < 0) return ".";
      if (v < 10) return String(v);
      if (v < 36) return String.fromCharCode("A".charCodeAt(0) + v - 10);
      return "#";
    };
    let ruler = "";
    if (this.size <= 16) {
      ruler = "   " + Array.from({ length: this.size }, (_, i) => i.toString(16).toUpperCase()).join("");
    } else {
      const tens = "   " + Array.from({ length: this.size }, (_, i) => i >= 10 ? Math.floor(i / 10).toString() : " ").join("");
      const ones = "   " + Array.from({ length: this.size }, (_, i) => (i % 10).toString()).join("");
      ruler = tens + "\n" + ones;
    }
    const rows = this.pixels.map((row, y) => {
      const label = this.size <= 16 ? String(y).padStart(2, ' ') + " " : String(y).padStart(3, ' ');
      return label + row.map(char).join("");
    });
    return ruler + "\n" + rows.join("\n");
  }

  regionSummary(y1: number, x1: number, y2: number, x2: number): string {
    const counts: Record<number, number> = {};
    let total = 0;
    for (let y = Math.max(0, y1); y <= Math.min(this.size - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(this.size - 1, x2); x++) {
        const v = this.pixels[y][x];
        counts[v] = (counts[v] || 0) + 1;
        total++;
      }
    }
    if (total === 0) return "empty";
    const parts = [];
    const sorted = Object.entries(counts)
      .map(([k, v]) => ({ v: Number(k), count: v }))
      .sort((a, b) => b.count - a.count);
      
    for (const { v, count } of sorted) {
      const pct = Math.floor((count * 100) / total);
      if (pct < 5) continue;
      if (v < 0) {
        parts.push(`empty:${pct}%`);
      } else {
        parts.push(`${v}:${pct}%`);
      }
    }
    return parts.length ? parts.join(" ") : "empty";
  }

  toSpriteData(palette: string[]): string[][] {
    return this.pixels.map(row => 
      row.map(v => (v >= 0 && v < palette.length) ? palette[v] : '')
    );
  }
}

function buildSystemPrompt(userPrompt: string, palette: string[], size: number, spriteType: string = "block"): string {
  const paletteDesc = palette.map((c, i) => {
    if (i >= 10) return `  ${i} (char ${String.fromCharCode('A'.charCodeAt(0) + i - 10)}): ${c}`;
    return `  ${i}: ${c}`;
  }).join("\n");

  const hints: Record<string, string> = {
    block: "This is a BLOCK TILE. Fill EVERY pixel — no transparency (-1). The tile will be placed in a grid next to copies of itself. Cover the entire canvas with the material.",
    icon: "This is an ITEM ICON. Draw the object shape and use -1 (transparent) for the background. Keep it compact, chunky, and recognizable. Leave some transparent padding around the edges.",
    character: "This is a CHARACTER SPRITE. Draw a character on transparent background (-1). Make the silhouette clear and recognizable. Leave transparent padding around the edges.",
    freeform: "This is a FREEFORM sprite. Use your best judgment for the composition. If the subject is a standalone object or character, use -1 (transparent) for the background. If it's a scene, pattern, or texture, fill the entire canvas."
  };
  const hint = hints[spriteType] || hints["block"];

  const toolsText = `- fill_rect(x1,y1,x2,y2,color) — fill a rectangle
- fill_row(y,x_start,x_end,color) — fill one row
- fill_column(x,y_start,y_end,color) — fill one column
- draw_line(x1,y1,x2,y2,color) — 1px line
- draw_circle(cx,cy,radius,color,fill) — circle (filled or outline)
- draw_ellipse(cx,cy,rx,ry,color,fill) — ellipse
- draw_triangle(x1,y1,x2,y2,x3,y3,color) — filled triangle
- draw_rotated_rect(cx,cy,w,h,angle,color) — rotated rectangle
- draw_pixel(x,y,color) — single pixel
- draw_pixels([{"x":0,"y":0,"color":1},...]) — batch pixels
- noise_fill_rect(x1,y1,x2,y2,colors,seed) — random texture fill
- noise_fill_circle(cx,cy,r,colors,seed) — circular noise fill
- voronoi_fill(x1,y1,x2,y2,colors,cells,seed) — cell/stone patterns
- view_canvas() — see the grid (CALL THIS OFTEN)
- get_pixel(x,y) — check one pixel
- finish() — call when done`;

  const gridExplanation = size <= 16 ? `When you call view_canvas, you see a grid like this:
   0123456789ABCDEF    ← column numbers (hex for 10-15)
 0 ................    ← row 0 (all transparent)
 1 ..0000000000....    ← row 1 (color 0 in columns 2-11)
Each character is a palette index: 0-9 = colors 0-9, A-Z = colors 10-35, . = transparent
Read it like a picture: rows go top to bottom (y), columns go left to right (x).` : `When you call view_canvas, you see a grid. Each character = one pixel.
0-9 = palette colors 0-9, A-Z = colors 10-35, . = transparent.
Rows = y (top to bottom), columns = x (left to right).`;

  return `You are a pixel artist. You draw on a ${size}x${size} canvas using color indices from a palette.

SUBJECT: ${userPrompt}

PALETTE:
${paletteDesc}
Use -1 for transparent.

${hint}

COORDINATE SYSTEM:
- (0,0) = top-left corner
- (${size - 1},${size - 1}) = bottom-right corner
- x goes RIGHT (columns), y goes DOWN (rows)

${gridExplanation}

TOOLS:
${toolsText}

WORKFLOW:
1. Plan what to draw — think about the shape, then the colors
2. Fill large areas first with fill_rect
3. Call view_canvas to see your progress
4. Add details with draw_pixel or draw_pixels
5. Call view_canvas again to check
6. Use noise_fill_rect to add texture variation if needed
7. Final view_canvas to verify everything looks right
8. Call finish when done

IMPORTANT: Call view_canvas after every few drawing steps. It shows you exactly what the canvas looks like so you can correct mistakes early.`;
}

function getToolsSchema() {
  return [
    {
      type: "function",
      function: {
        name: "draw_pixel",
        description: "Set a single pixel at (x, y) to a palette color index. Use -1 for transparent.",
        parameters: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" }, color: { type: "integer" } }, required: ["x", "y", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_pixels",
        description: "Set multiple pixels at once.",
        parameters: { type: "object", properties: { pixels: { type: "array", items: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" }, color: { type: "integer" } } } } }, required: ["pixels"] }
      }
    },
    {
      type: "function",
      function: {
        name: "fill_rect",
        description: "Fill a rectangle.",
        parameters: { type: "object", properties: { x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, color: { type: "integer" } }, required: ["x1", "y1", "x2", "y2", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "fill_row",
        description: "Fill a horizontal row.",
        parameters: { type: "object", properties: { y: { type: "integer" }, x_start: { type: "integer" }, x_end: { type: "integer" }, color: { type: "integer" } }, required: ["y", "x_start", "x_end", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "fill_column",
        description: "Fill a vertical column.",
        parameters: { type: "object", properties: { x: { type: "integer" }, y_start: { type: "integer" }, y_end: { type: "integer" }, color: { type: "integer" } }, required: ["x", "y_start", "y_end", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_line",
        description: "Draw a 1-pixel-wide line.",
        parameters: { type: "object", properties: { x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, color: { type: "integer" } }, required: ["x1", "y1", "x2", "y2", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_circle",
        description: "Draw a circle.",
        parameters: { type: "object", properties: { cx: { type: "integer" }, cy: { type: "integer" }, radius: { type: "integer" }, color: { type: "integer" }, fill: { type: "boolean" } }, required: ["cx", "cy", "radius", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_ellipse",
        description: "Draw an ellipse.",
        parameters: { type: "object", properties: { cx: { type: "integer" }, cy: { type: "integer" }, rx: { type: "integer" }, ry: { type: "integer" }, color: { type: "integer" }, fill: { type: "boolean" } }, required: ["cx", "cy", "rx", "ry", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_triangle",
        description: "Draw a filled triangle.",
        parameters: { type: "object", properties: { x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, x3: { type: "integer" }, y3: { type: "integer" }, color: { type: "integer" } }, required: ["x1", "y1", "x2", "y2", "x3", "y3", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "draw_rotated_rect",
        description: "Draw a filled rotated rectangle.",
        parameters: { type: "object", properties: { cx: { type: "integer" }, cy: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" }, angle: { type: "number" }, color: { type: "integer" } }, required: ["cx", "cy", "w", "h", "angle", "color"] }
      }
    },
    {
      type: "function",
      function: {
        name: "noise_fill_rect",
        description: "Fill a rectangle with noise.",
        parameters: { type: "object", properties: { x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, colors: { type: "array", items: { type: "integer" } }, seed: { type: "integer" }, scale: { type: "number" } }, required: ["x1", "y1", "x2", "y2", "colors"] }
      }
    },
    {
      type: "function",
      function: {
        name: "noise_fill_circle",
        description: "Fill a circular area with noise.",
        parameters: { type: "object", properties: { cx: { type: "integer" }, cy: { type: "integer" }, radius: { type: "integer" }, colors: { type: "array", items: { type: "integer" } }, seed: { type: "integer" } }, required: ["cx", "cy", "radius", "colors"] }
      }
    },
    {
      type: "function",
      function: {
        name: "voronoi_fill",
        description: "Fill a rectangle with Voronoi cells.",
        parameters: { type: "object", properties: { x1: { type: "integer" }, y1: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, colors: { type: "array", items: { type: "integer" } }, cells: { type: "integer" }, seed: { type: "integer" } }, required: ["x1", "y1", "x2", "y2", "colors"] }
      }
    },
    {
      type: "function",
      function: {
        name: "view_canvas",
        description: "View the current canvas.",
        parameters: { type: "object", properties: {}, required: [] }
      }
    },
    {
      type: "function",
      function: {
        name: "get_pixel",
        description: "Get the palette index at position (x, y).",
        parameters: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }
      }
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Call this when done.",
        parameters: { type: "object", properties: {}, required: [] }
      }
    }
  ];
}

export interface RunAgentPaintArgs {
  prompt: string;
  width: number;
  height: number;
  palette: string[];
  spriteType?: string;
  model: string;
  onStep?: (canvas: Canvas) => void;
  maxSteps?: number;
}

export async function runAgentPaint({
  prompt,
  width,
  height,
  palette,
  spriteType = 'block',
  model,
  onStep,
  maxSteps = TEXEL_AGENT_MAX_STEPS
}: RunAgentPaintArgs): Promise<string[][]> {
  const size = Math.max(width, height);
  const canvas = new Canvas(size, palette);
  
  const sysPrompt = buildSystemPrompt(prompt, palette, size, spriteType);
  const messages: ChatMessageWithTools[] = [
    { role: 'system', content: sysPrompt }
  ];
  
  const tools = getToolsSchema();
  
  const runTool = (name: string, args: any): string => {
    try {
      switch (name) {
        case 'draw_pixel': return canvas.setPixel(args.x, args.y, args.color);
        case 'draw_pixels': {
          let count = 0;
          for (const p of args.pixels || []) {
            canvas.setPixel(p.x, p.y, p.color);
            count++;
          }
          return `Drew ${count} pixels`;
        }
        case 'fill_rect': return canvas.fillRect(args.x1, args.y1, args.x2, args.y2, args.color);
        case 'fill_row': return canvas.fillRow(args.y, args.x_start, args.x_end, args.color);
        case 'fill_column': return canvas.fillColumn(args.x, args.y_start, args.y_end, args.color);
        case 'draw_line': return canvas.drawLine(args.x1, args.y1, args.x2, args.y2, args.color);
        case 'draw_circle': {
          const c1 = canvas.drawCircle(args.cx, args.cy, args.radius, args.color, args.fill !== false);
          return `Drew circle, ${c1}px`;
        }
        case 'draw_ellipse': {
          const c2 = canvas.drawEllipse(args.cx, args.cy, args.rx, args.ry, args.color, args.fill !== false);
          return `Drew ellipse, ${c2}px`;
        }
        case 'draw_triangle': {
          const c3 = canvas.drawTriangle(args.x1, args.y1, args.x2, args.y2, args.x3, args.y3, args.color);
          return `Drew triangle, ${c3}px`;
        }
        case 'draw_rotated_rect': {
          const c4 = canvas.drawRotatedRect(args.cx, args.cy, args.w, args.h, args.angle, args.color);
          return `Drew rotated rect, ${c4}px`;
        }
        case 'noise_fill_rect': {
          const c5 = canvas.fillNoise(args.x1, args.y1, args.x2, args.y2, args.colors, args.seed, args.scale || 1);
          return `Noise filled, ${c5}px`;
        }
        case 'noise_fill_circle': {
          const c6 = canvas.fillNoiseCircle(args.cx, args.cy, args.radius, args.colors, args.seed);
          return `Noise circle filled, ${c6}px`;
        }
        case 'voronoi_fill': {
          const c7 = canvas.fillVoronoi(args.x1, args.y1, args.x2, args.y2, args.colors, args.cells || 8, args.seed);
          return `Voronoi filled, ${c7}px`;
        }
        case 'view_canvas': {
          const grid = canvas.toVisualGrid();
          const colorCounts: Record<number, number> = {};
          for (const row of canvas.pixels) {
            for (const v of row) colorCounts[v] = (colorCounts[v] || 0) + 1;
          }
          const summary = [];
          for (const [v, c] of Object.entries(colorCounts).map(x => [Number(x[0]), x[1]])) {
            if (v === -1) summary.push(`. = transparent: ${c}px`);
            else {
              const char = v < 10 ? String(v) : String.fromCharCode("A".charCodeAt(0) + v - 10);
              summary.push(`${char} = ${v}(${canvas.palette[v]}): ${c}px`);
            }
          }
          const total = Object.entries(colorCounts).filter(x => Number(x[0]) >= 0).reduce((acc, curr) => acc + curr[1], 0);
          const half = Math.floor(size / 2);
          const spatial = `TOP-LEFT: ${canvas.regionSummary(0, 0, half - 1, half - 1)} | TOP-RIGHT: ${canvas.regionSummary(0, half, half - 1, size - 1)} | BOTTOM-LEFT: ${canvas.regionSummary(half, 0, size - 1, half - 1)} | BOTTOM-RIGHT: ${canvas.regionSummary(half, half, size - 1, size - 1)}`;
          return `${grid}\n\nLEGEND: ${summary.slice(0, 12).join(', ')}\nFilled: ${total}/${size*size}px\nLAYOUT: ${spatial}`;
        }
        case 'get_pixel': {
          const v = canvas.getPixel(args.x, args.y);
          const name = (v >= 0 && v < canvas.palette.length) ? canvas.palette[v] : 'transparent';
          return `(${args.x},${args.y}) = ${v} (${name})`;
        }
        case 'finish': return 'FINISHED';
        default: return `Unknown tool ${name}`;
      }
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  };

  let steps = 0;
  while (steps < maxSteps) {
    const res = await chatWithTools({ model, messages, tools });
    messages.push(res);
    
    if (res.content && res.content.includes('FINISHED')) break;

    if (res.tool_calls && res.tool_calls.length > 0) {
      let finished = false;
      for (const tc of res.tool_calls) {
        const result = runTool(tc.function.name, tc.function.arguments);
        messages.push({ role: 'tool', content: result });
        if (onStep) onStep(canvas);
        if (result === 'FINISHED' || tc.function.name === 'finish') finished = true;
      }
      if (finished) break;
    } else {
      break;
    }
    steps++;
  }

  return canvas.toSpriteData(palette);
}
