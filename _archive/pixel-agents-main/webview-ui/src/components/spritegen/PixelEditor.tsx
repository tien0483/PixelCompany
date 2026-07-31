/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useRef, useState } from 'react';

import type { ColorValue } from '../ui/types.js';
import { colorValueToHex } from './colorUtils.js';
import type { PixelTool } from './usePixelEditor.js';

export interface PixelEditorCanvasProps {
  width: number;
  height: number;
  grid: string[][];
  activeTool: PixelTool;
  currentColor: ColorValue;
  onSetPixel: (x: number, y: number, color: string) => void;
  onApplyStroke: (pixels: {x: number, y: number, color: string}[]) => void;
  onFloodFill: (x: number, y: number, target: string, replacement: string) => void;
  onPickColor: (color: string) => void;
  backgroundTiles: number;
}

export function PixelEditorCanvas({
  width,
  height,
  grid,
  activeTool,
  currentColor,
  onSetPixel,
  onApplyStroke,
  onFloodFill,
  onPickColor,
  backgroundTiles,
}: PixelEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = 16;
  const [isDrawing, setIsDrawing] = useState(false);
  const strokeBuffer = useRef<{x: number, y: number, color: string}[]>([]);
  const lastPos = useRef<{x: number, y: number} | null>(null);

  // Redraw
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, width * scale, height * scale);
    
    // Draw checkerboard
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ctx.fillStyle = ((x + y) % 2 === 0) ? '#e0e0e0' : '#c0c0c0';
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    // Draw grid pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y] && grid[y][x]) {
          ctx.fillStyle = grid[y][x];
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // Draw background tiles shading
    if (backgroundTiles > 0) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fillRect(0, 0, width * scale, backgroundTiles * 16 * scale);
    }
    
    // Draw 16px tile grid overlay
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= width; i++) {
      if (i % 16 === 0) {
        ctx.beginPath();
        ctx.moveTo(i * scale, 0);
        ctx.lineTo(i * scale, height * scale);
        ctx.stroke();
      }
    }
    for (let i = 0; i <= height; i++) {
      if (i % 16 === 0) {
        ctx.beginPath();
        ctx.moveTo(0, i * scale);
        ctx.lineTo(width * scale, i * scale);
        ctx.stroke();
      }
    }
  }, [width, height, grid, scale, backgroundTiles]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const x = Math.floor((clientX - rect.left) / scaleX);
    const y = Math.floor((clientY - rect.top) / scaleY);
    return { x, y };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getCoords(e);
    if (!coords) return;
    const { x, y } = coords;

    const isRightClick = 'button' in e && e.button === 2;
    const tool = isRightClick ? 'erase' : activeTool;

    if (tool === 'eyedropper') {
      const color = grid[y]?.[x];
      if (color) onPickColor(color);
      return;
    }

    if (tool === 'fill') {
      const target = grid[y]?.[x] || '';
      const replacement = colorValueToHex(currentColor);
      onFloodFill(x, y, target, replacement);
      return;
    }

    setIsDrawing(true);
    const color = tool === 'erase' ? '' : colorValueToHex(currentColor);
    strokeBuffer.current = [{x, y, color}];
    lastPos.current = {x, y};
    onSetPixel(x, y, color);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const coords = getCoords(e);
    if (!coords) return;
    const { x, y } = coords;

    if (lastPos.current && lastPos.current.x === x && lastPos.current.y === y) return;

    const isRightClick = 'buttons' in e && e.buttons === 2;
    const tool = isRightClick ? 'erase' : activeTool;
    const color = tool === 'erase' ? '' : colorValueToHex(currentColor);

    strokeBuffer.current.push({x, y, color});
    lastPos.current = {x, y};
    onSetPixel(x, y, color);
  };

  const handleEnd = () => {
    if (isDrawing) {
      setIsDrawing(false);
      if (strokeBuffer.current.length > 0) {
        onApplyStroke(strokeBuffer.current);
        strokeBuffer.current = [];
      }
      lastPos.current = null;
    }
  };

  return (
    <div ref={containerRef} className="flex-1 w-full h-full border border-border bg-bg-dark flex items-center justify-center p-4">
      <canvas
        ref={canvasRef}
        width={width * scale}
        height={height * scale}
        className="max-w-full max-h-full object-contain"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onContextMenu={e => e.preventDefault()}
        style={{
          imageRendering: 'pixelated',
          cursor: activeTool === 'eyedropper' ? 'crosshair' : 'crosshair',
          touchAction: 'none'
        }}
      />
    </div>
  );
}
