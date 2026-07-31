import React from 'react';

import { TILE_SIZE } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';

interface SpeechOverlayProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

export const SpeechOverlay: React.FC<SpeechOverlayProps> = ({
  officeState,
  containerRef,
  zoom,
  panRef,
}) => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    let frameId: number;
    const loop = () => {
      setTick((t) => t + 1);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);

  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;

  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const bubbles: React.ReactNode[] = [];

  for (const [id, ch] of officeState.characters.entries()) {
    // Only show a bubble while the character is actually speaking. The speaker's
    // name is prefixed inside the same bubble ("Name: text") — no separate,
    // always-on name box (which would overlap the office and other overlays).
    if (!ch.speechText) continue;
    const name = ch.isNpc ? ch.agentName : undefined;

    const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
    const screenY = (deviceOffsetY + (ch.y - TILE_SIZE * 2) * zoom) / dpr;

    bubbles.push(
      <div
        key={id}
        className="absolute -translate-x-1/2 pointer-events-none z-40"
        style={{ left: screenX, top: screenY }}
      >
        <div className="bg-bg border-2 border-border rounded-none px-3 py-2 shadow-pixel font-pixel text-text text-xs max-w-[220px] text-center">
          {name && <span className="text-accent-bright">{name}: </span>}
          {ch.speechText}
        </div>
      </div>
    );
  }

  return <>{bubbles}</>;
};
