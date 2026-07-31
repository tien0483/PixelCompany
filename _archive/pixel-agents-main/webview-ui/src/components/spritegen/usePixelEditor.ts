import { useCallback, useState } from 'react';

import type { ColorValue } from '../ui/types.js';

export type PixelTool = 'brush' | 'erase' | 'fill' | 'eyedropper';

export interface PixelEditorState {
  width: number;
  height: number;
  grid: string[][]; // '' for transparent, '#RRGGBBAA' or '#RRGGBB'
}

export function usePixelEditor(defaultWidth = 16, defaultHeight = 16) {
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  
  const [grid, setGrid] = useState<string[][]>(() => 
    Array.from({ length: height }, () => Array(width).fill(''))
  );
  
  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<PixelEditorState[]>([]);
  const [redoStack, setRedoStack] = useState<PixelEditorState[]>([]);
  
  const [activeTool, setActiveTool] = useState<PixelTool>('brush');
  // Initialize with black color
  const [currentColor, setCurrentColor] = useState<ColorValue>({ h: 0, s: 0, b: 0, c: 0 });

  const [solidRows, setSolidRows] = useState(1);
  const footprintW = Math.ceil(width / 16);
  const footprintH = Math.ceil(height / 16);
  const backgroundTiles = Math.max(0, footprintH - solidRows);

  const [canPlaceOnSurfaces, setCanPlaceOnSurfaces] = useState(false);
  const [canPlaceOnWalls, setCanPlaceOnWalls] = useState(false);

  const pushState = useCallback((newGrid: string[][], newW: number, newH: number) => {
    setUndoStack(prev => [...prev, { width, height, grid }]);
    setRedoStack([]);
    setGrid(newGrid);
    setWidth(newW);
    setHeight(newH);
  }, [grid, width, height]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, { width, height, grid }]);
    setUndoStack(u => u.slice(0, -1));
    setGrid(prev.grid);
    setWidth(prev.width);
    setHeight(prev.height);
  }, [undoStack, grid, width, height]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, { width, height, grid }]);
    setRedoStack(r => r.slice(0, -1));
    setGrid(next.grid);
    setWidth(next.width);
    setHeight(next.height);
  }, [redoStack, grid, width, height]);

  const resize = useCallback((newW: number, newH: number) => {
    if (newW === width && newH === height) return;
    const newGrid = Array.from({ length: newH }, (_, y) => 
      Array.from({ length: newW }, (_, x) => {
        if (y < height && x < width) return grid[y][x];
        return '';
      })
    );
    pushState(newGrid, newW, newH);
  }, [width, height, grid, pushState]);

  const setPixel = useCallback((x: number, y: number, colorCss: string) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (grid[y][x] === colorCss) return;
    const newGrid = grid.map(row => [...row]);
    newGrid[y][x] = colorCss;
    pushState(newGrid, width, height);
  }, [grid, width, height, pushState]);

  const applyStroke = useCallback((pixels: {x: number, y: number, color: string}[]) => {
    if (pixels.length === 0) return;
    const newGrid = grid.map(row => [...row]);
    let changed = false;
    for (const p of pixels) {
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height && newGrid[p.y][p.x] !== p.color) {
        newGrid[p.y][p.x] = p.color;
        changed = true;
      }
    }
    if (changed) pushState(newGrid, width, height);
  }, [grid, width, height, pushState]);

  const floodFill = useCallback((startX: number, startY: number, targetColor: string, replacementColor: string) => {
    if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;
    if (targetColor === replacementColor) return;
    const newGrid = grid.map(row => [...row]);
    const stack = [{x: startX, y: startY}];
    let changed = false;
    while (stack.length > 0) {
      const {x, y} = stack.pop()!;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (newGrid[y][x] === targetColor) {
        newGrid[y][x] = replacementColor;
        changed = true;
        stack.push({x: x + 1, y});
        stack.push({x: x - 1, y});
        stack.push({x, y: y + 1});
        stack.push({x, y: y - 1});
      }
    }
    if (changed) pushState(newGrid, width, height);
  }, [grid, width, height, pushState]);

  const clear = useCallback(() => {
    const newGrid = Array.from({ length: height }, () => Array(width).fill(''));
    pushState(newGrid, width, height);
  }, [width, height, pushState]);

  const replaceGrid = useCallback((newGrid: string[][]) => {
    pushState(newGrid, width, height);
  }, [width, height, pushState]);

  return {
    width, height, grid, resize, setPixel, applyStroke, floodFill, clear, replaceGrid,
    undoStack, redoStack, handleUndo, handleRedo,
    activeTool, setActiveTool,
    currentColor, setCurrentColor,
    solidRows, setSolidRows,
    footprintW, footprintH, backgroundTiles,
    canPlaceOnSurfaces, setCanPlaceOnSurfaces,
    canPlaceOnWalls, setCanPlaceOnWalls
  };
}
