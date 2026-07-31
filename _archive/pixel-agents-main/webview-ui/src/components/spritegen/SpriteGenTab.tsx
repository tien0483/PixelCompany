import { useEffect, useRef, useState } from 'react';

import type { SaveCustomAsset } from '../../../../core/src/messages.js';
import { transport } from '../../transport/index.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { colorValueToHex, hexToColorValue } from './colorUtils.js';
import { imageToGrid } from './imageQuantizer.js';
import { PixelEditorCanvas } from './PixelEditor.js';
import { usePixelEditor } from './usePixelEditor.js';

export interface SpriteGenTabProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (asset: SaveCustomAsset) => void;
}

export function SpriteGenTab({ isOpen, onClose, onSave }: SpriteGenTabProps) {
  const [activeTab, setActiveTab] = useState<'draw' | 'ai' | 'import'>('draw');
  const [activeOrientation, setActiveOrientation] = useState<'front' | 'side' | 'back'>('front');
  const [name, setName] = useState('Custom Asset');
  const [category, setCategory] = useState<'desks' | 'chairs' | 'storage' | 'electronics' | 'decor' | 'misc'>('decor');
  
  const frontEditor = usePixelEditor(16, 16);
  const sideEditor = usePixelEditor(16, 16);
  const backEditor = usePixelEditor(16, 16);
  const editors = { front: frontEditor, side: sideEditor, back: backEditor };
  const editor = editors[activeOrientation];
  
  // Properties shared across all orientations but driven by the main 'front' editor or we can decouple them.
  // We'll decouple the global properties from the editors or just use frontEditor's values.
  const [solidRows, setSolidRows] = useState(1);
  const [canPlaceOnSurfaces, setCanPlaceOnSurfaces] = useState(false);
  const [canPlaceOnWalls, setCanPlaceOnWalls] = useState(false);

  const footprintW = frontEditor.footprintW;
  const footprintH = frontEditor.footprintH;
  const backgroundTiles = Math.max(0, footprintH - solidRows);

  const [prompt, setPrompt] = useState('');
  const [strength, setStrength] = useState(0.7);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const [agentMode, setAgentMode] = useState(false);
  const [spriteType, setSpriteType] = useState('block');
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const [paletteStr, setPaletteStr] = useState('#000000,#1D2B53,#7E2553,#008751,#AB5236,#5F574F,#C2C3C7,#FFF1E8,#FF004D,#FFA300,#FFEC27,#00E436,#29ADFF,#83769C,#FF77A8,#FFCCAA');

  useEffect(() => {
    if (activeTab === 'ai' && models.length === 0) {
      // Fetch models via the server proxy (server → Ollama has no CORS block,
      // unlike the browser hitting localhost:11434 directly).
      fetch('/api/ollama/models')
        .then(r => r.json())
        .then(d => {
          if (d.models) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const m = d.models.map((m: any) => m.name);
            setModels(m);
            if (m.length > 0) setModel(m[0]);
          }
        })
        .catch(e => console.log('Ollama model list unavailable', e));
    }
  }, [activeTab, models.length]);

  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transport.onMessage((msg: any) => {
      if (msg.type === 'spriteGenProgress' && msg.requestId === 'gen-1') {
        if (msg.sprite && msg.sprite.length > 0) {
          editorRef.current.replaceGrid(msg.sprite);
        }
        if (msg.done) {
          setIsGenerating(false);
          if (msg.error) {
             setGenError(msg.error);
          }
        }
      }
    });
  }, []);

  const handleGenerate = (refine: boolean) => {
    setIsGenerating(true);
    setGenError('');
    transport.send({
      type: 'generateSprite',
      requestId: 'gen-1',
      prompt,
      seedSprite: refine ? editor.grid : undefined,
      strength: refine ? strength : 0,
      width: editor.width,
      height: editor.height,
      model: model || (models[0] ?? 'llama3'),
      agentMode,
      palette: agentMode ? paletteStr.split(',').map(s => s.trim()) : undefined,
      spriteType: agentMode ? spriteType : undefined,
    });
  };

  if (!isOpen) return null;

  const handleSave = () => {
    // Collect non-empty orientations
    const orientations = (['front', 'side', 'back'] as const)
      .filter(o => editors[o].undoStack.length > 0 || editors[o].grid.some(row => row.some(col => col !== '')))
      .map(o => ({
        orientation: o,
        sprite: editors[o].grid.map(row => row.map(col => col === '' ? '' : col)),
        width: editors[o].width,
        height: editors[o].height
      }));

    // If all are empty, just save front as empty
    if (orientations.length === 0) {
      orientations.push({
        orientation: 'front',
        sprite: frontEditor.grid,
        width: frontEditor.width,
        height: frontEditor.height
      });
    }

    onSave({
      type: 'saveCustomAsset',
      name,
      category,
      width: frontEditor.width,
      height: frontEditor.height,
      footprintW,
      footprintH,
      backgroundTiles,
      canPlaceOnWalls,
      canPlaceOnSurfaces,
      sprite: orientations[0].sprite, // backward compatibility / primary sprite
      orientations
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Custom Asset" zIndex={100}>
      <div className="flex flex-col w-[90vw] h-[85vh] max-w-[1400px] min-h-[600px] bg-bg overflow-hidden text-text font-pixel">
        {/* Top tabs */}
        <div className="flex bg-bg-dark border-b border-border p-2 gap-2 justify-center shrink-0">
          <Button variant={activeTab === 'draw' ? 'active' : 'default'} onClick={() => setActiveTab('draw')} className="px-8 py-2 text-lg">Draw</Button>
          <Button variant={activeTab === 'ai' ? 'active' : 'default'} onClick={() => setActiveTab('ai')} className="px-8 py-2 text-lg">AI Generate</Button>
          <Button variant={activeTab === 'import' ? 'active' : 'default'} onClick={() => setActiveTab('import')} className="px-8 py-2 text-lg">Import</Button>
        </div>
        
        {activeTab === 'draw' && (
          <div className="flex items-center gap-4 p-2 bg-bg border-b border-border shrink-0">
            <div className="flex gap-1">
              <Button variant={editor.activeTool === 'brush' ? 'active' : 'ghost'} onClick={() => editor.setActiveTool('brush')} title="Brush (Draw)">🎨</Button>
              <Button variant={editor.activeTool === 'erase' ? 'active' : 'ghost'} onClick={() => editor.setActiveTool('erase')} title="Erase">🧼</Button>
              <Button variant={editor.activeTool === 'fill' ? 'active' : 'ghost'} onClick={() => editor.setActiveTool('fill')} title="Fill">🪣</Button>
              <Button variant={editor.activeTool === 'eyedropper' ? 'active' : 'ghost'} onClick={() => editor.setActiveTool('eyedropper')} title="Color Picker">🧪</Button>
            </div>
            <div className="w-px h-6 bg-border mx-2" />
            <div className="flex gap-1">
              <Button variant="ghost" onClick={editor.handleUndo} disabled={editor.undoStack.length === 0} title="Undo">↩️</Button>
              <Button variant="ghost" onClick={editor.handleRedo} disabled={editor.redoStack.length === 0} title="Redo">↪️</Button>
              <Button variant="ghost" onClick={editor.clear} title="Clear Grid">🗑️</Button>
            </div>
            <div className="w-px h-6 bg-border mx-2" />
            <div className="flex items-center gap-2 text-sm">
              <span>Grid:</span>
              <select 
                className="bg-bg-dark border border-border p-1 outline-none cursor-pointer hover:border-accent"
                value={`${editor.width}x${editor.height}`}
                onChange={e => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  editor.resize(w, h);
                }}
              >
                <option value="16x16">16x16 🔻</option>
                <option value="32x32">32x32 🔻</option>
                <option value="48x48">48x48 🔻</option>
                <option value="64x64">64x64 🔻</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm ml-4">
              <span>View:</span>
              <select 
                className="bg-bg-dark border border-border p-1 outline-none cursor-pointer hover:border-accent"
                value={activeOrientation}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onChange={e => setActiveOrientation(e.target.value as any)}
              >
                <option value="front">Front 🔻</option>
                <option value="side">Side 🔻</option>
                <option value="back">Back 🔻</option>
              </select>
            </div>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Main content area */}
          <div className="flex-1 min-w-0 flex flex-col bg-bg-dark overflow-hidden">
            {activeTab === 'draw' && (
              <div className="flex-1 flex overflow-hidden">
                {/* Left Dock: Palette */}
                <div className="w-[180px] shrink-0 border-r border-border p-4 flex flex-col bg-bg overflow-y-auto">
                  <h4 className="font-bold text-sm mb-4 border-b border-border pb-2">🎨 Palette</h4>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {paletteStr.split(',').map((hex) => {
                      const colorStr = hex.trim();
                      const parsed = hexToColorValue(colorStr);
                      const isSelected = colorValueToHex(editor.currentColor).toLowerCase() === colorStr.toLowerCase();
                      return (
                        <button
                          key={colorStr}
                          className={`w-8 h-8 rounded-sm cursor-pointer shadow-sm ${isSelected ? 'outline outline-2 outline-accent-bright z-10' : 'border border-border hover:border-text'}`}
                          style={{ backgroundColor: colorStr }}
                          onClick={() => {
                            if (parsed) editor.setCurrentColor(parsed);
                          }}
                          title={colorStr}
                        />
                      );
                    })}
                  </div>
                </div>
                
                {/* Center Workspace */}
                <div className="flex-1 flex flex-col bg-bg-dark overflow-hidden">
                  <PixelEditorCanvas 
                    width={editor.width}
                    height={editor.height}
                    grid={editor.grid}
                    activeTool={editor.activeTool}
                    currentColor={editor.currentColor}
                    onSetPixel={editor.setPixel}
                    onApplyStroke={editor.applyStroke}
                    onFloodFill={editor.floodFill}
                    onPickColor={(c) => {
                      const parsed = hexToColorValue(c);
                      if (parsed) editor.setCurrentColor(parsed);
                    }}
                    backgroundTiles={editor.backgroundTiles}
                  />
                  {/* Zoom Controls */}
                  <div className="bg-bg border-t border-border p-2 flex justify-center items-center gap-4 text-sm text-text-muted shrink-0">
                    <span>Zoom: [Auto]</span>
                    <Button variant="ghost" size="sm" title="Zoom Out" disabled>➖</Button>
                    <Button variant="ghost" size="sm" title="Reset Zoom" disabled>🔘</Button>
                    <Button variant="ghost" size="sm" title="Zoom In" disabled>➕</Button>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'ai' && (
              <div className="p-8 flex flex-col gap-4 text-text h-full overflow-y-auto bg-bg-dark">
                <h3 className="font-bold text-lg border-b border-border pb-2 flex justify-between items-center">
                  <span>AI Generation (Ollama)</span>
                  <label className="text-sm font-normal flex items-center gap-2 cursor-pointer bg-bg border border-border px-2 py-1">
                    <input type="checkbox" checked={agentMode} onChange={e => setAgentMode(e.target.checked)} />
                    Agent painter
                  </label>
                </h3>
                
                <label className="flex flex-col gap-1">
                  Prompt
                  <textarea
                    className="bg-bg border border-border p-2 text-text resize-y h-40 w-full"
                    placeholder="e.g., A cozy wooden desk with a computer monitor"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                  />
                </label>
                
                <div className="flex gap-4">
                  <label className="flex flex-col gap-1 flex-1">
                    Model
                    <select 
                      className="bg-bg border border-border p-2 text-text"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                    >
                      {models.length > 0 ? (
                        models.map(m => <option key={m} value={m}>{m}</option>)
                      ) : (
                        <option value="llama3">llama3 (fallback)</option>
                      )}
                    </select>
                  </label>
                  
                  <label className="flex flex-col gap-1 flex-1">
                    Preservation (Refine only)
                    <div className="flex items-center gap-2 h-full">
                      <input 
                        type="range" min="0" max="1" step="0.1" 
                        value={strength} 
                        onChange={e => setStrength(Number(e.target.value))}
                        className="flex-1"
                        disabled={agentMode}
                      />
                      <span className="text-sm w-10">{Math.round(strength * 100)}%</span>
                    </div>
                  </label>
                </div>
                
                {agentMode && (
                  <div className="flex gap-4">
                    <label className="flex flex-col gap-1 flex-1">
                      Sprite Type
                      <select 
                        className="bg-bg border border-border p-2 text-text"
                        value={spriteType}
                        onChange={e => setSpriteType(e.target.value)}
                      >
                        <option value="block">Block</option>
                        <option value="icon">Icon</option>
                        <option value="character">Character</option>
                        <option value="freeform">Freeform</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      Palette (comma separated hex)
                      <input 
                        type="text"
                        className="bg-bg border border-border p-2 text-text"
                        value={paletteStr}
                        onChange={e => setPaletteStr(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                
                {genError && (
                  <div className="bg-red-900/30 text-red-400 p-2 border border-red-900 text-sm">
                    {genError}
                  </div>
                )}
                
                <div className="flex gap-4 mt-4">
                  <Button variant="default" onClick={() => handleGenerate(false)} disabled={isGenerating || !prompt}>
                    {isGenerating ? 'Generating...' : 'Generate New'}
                  </Button>
                  <Button variant="active" onClick={() => handleGenerate(true)} disabled={isGenerating || !prompt}>
                    {isGenerating ? 'Refining...' : 'Refine Sketch'}
                  </Button>
                </div>
                
                <p className="text-text-muted text-xs mt-4 max-w-lg">
                  Ensure Ollama is running locally on port 11434. The generator will produce a JSON-formatted response with palette indices to color the {editor.width}x{editor.height} grid.
                </p>
              </div>
            )}
            
            {activeTab === 'import' && (
              <div className="p-8 flex flex-col items-center justify-center text-text gap-4 h-full bg-bg-dark">
                <h3 className="font-bold text-lg">Import Image</h3>
                <p className="text-text-muted text-sm text-center max-w-sm">
                  Select an image (PNG, JPG) to import. It will be downscaled to fit the current {editor.width}x{editor.height} grid.
                </p>
                <label className="bg-bg border border-border p-4 rounded-md cursor-pointer hover:bg-bg-dark mt-4">
                  <span className="text-sm font-bold">Choose Image File</span>
                  <input 
                    type="file" 
                    accept="image/png, image/jpeg"
                    className="hidden" 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const grid = await imageToGrid(file, editor.width, editor.height);
                        editor.replaceGrid(grid);
                        setActiveTab('draw');
                      } catch (err) {
                        console.error('Failed to import image', err);
                      }
                      e.target.value = '';
                    }} 
                  />
                </label>
              </div>
            )}
          </div>
          
          {/* Right Dock: Inspector */}
          <div className="w-[300px] min-w-[300px] shrink-0 bg-bg border-l border-border p-4 flex flex-col gap-6 overflow-y-auto text-text">
            
            <div>
              <h4 className="font-bold text-sm mb-3 border-b border-border pb-1">⚙️ Asset Settings</h4>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Name:
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className="bg-bg-dark border border-border p-1 text-text" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Category:
                  <select 
                    value={category} 
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onChange={e => setCategory(e.target.value as any)} 
                    className="bg-bg-dark border border-border p-1 text-text"
                  >
                    <option value="desks">Desks</option>
                    <option value="chairs">Chairs</option>
                    <option value="storage">Storage</option>
                    <option value="electronics">Electronics</option>
                    <option value="decor">Decor</option>
                    <option value="misc">Misc</option>
                  </select>
                </label>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-sm mb-3 border-b border-border pb-1">📥 Dimensions</h4>
              <div className="text-sm flex flex-col gap-1">
                <span>Size: {editor.width}x{editor.height} px</span>
                <span>Footprint: {editor.footprintW}x{editor.footprintH} tiles</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-sm mb-3 border-b border-border pb-1">🧱 Collision</h4>
              <label className="flex flex-col gap-1 text-sm">
                Solid Rows:
                <input type="number" min={0} max={footprintH} value={solidRows} onChange={e => setSolidRows(Number(e.target.value))} className="bg-bg-dark border border-border p-1 text-text" />
              </label>
              <div className="text-xs text-text-muted mt-1">
                Background Tiles: {backgroundTiles}
              </div>
            </div>

            <div>
              <h4 className="font-bold text-sm mb-3 border-b border-border pb-1">🗺️ Placement</h4>
              <div className="flex flex-col gap-2">
                <label className="flex gap-2 items-center text-sm cursor-pointer">
                  <input type="checkbox" checked={canPlaceOnSurfaces} onChange={e => setCanPlaceOnSurfaces(e.target.checked)} className="cursor-pointer" />
                  Can place on surfaces
                </label>
                <label className="flex gap-2 items-center text-sm cursor-pointer">
                  <input type="checkbox" checked={canPlaceOnWalls} onChange={e => setCanPlaceOnWalls(e.target.checked)} className="cursor-pointer" />
                  Can place on walls
                </label>
              </div>
            </div>

            <div className="mt-auto pt-4 flex gap-2 border-t border-border">
              <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
              <Button variant="active" onClick={handleSave} className="flex-1 text-accent-bright border-accent-bright bg-accent-bright/10 hover:bg-accent-bright hover:text-bg">Save to Office</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
