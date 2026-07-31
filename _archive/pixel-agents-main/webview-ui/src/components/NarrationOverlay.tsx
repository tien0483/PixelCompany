import React, { useEffect, useState } from 'react';

import type { ReplayTransport } from '../transport/replayTransport.js';

interface NarrationOverlayProps {
  transport: ReplayTransport;
}

export const NarrationOverlay: React.FC<NarrationOverlayProps> = ({ transport }) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [style, setStyle] = useState<'roleplay' | 'caveman'>('roleplay');

  useEffect(() => {
    // Poll the transport state every 50ms for smooth UI updates
    const interval = setInterval(() => {
      setCurrentTime(transport.getCurrentTime());
    }, 50);

    return () => clearInterval(interval);
  }, [transport]);

  const scenario = transport.getScenario();
  if (!scenario || !scenario.narration || scenario.narration.length === 0) {
    return null;
  }

  // Find the most recent narration event that is <= currentTime and matches the style
  const currentNarration = [...scenario.narration]
    .reverse()
    .find((n) => n.tMs <= currentTime && n.style === style);

  if (!currentNarration) {
    return null;
  }

  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-auto">
      <div className="bg-bg border-2 border-border rounded-none px-8 py-4 shadow-pixel font-pixel text-text text-lg max-w-2xl text-center">
        {currentNarration.text}
      </div>
      <button 
        onClick={() => setStyle(s => s === 'roleplay' ? 'caveman' : 'roleplay')}
        className="bg-bg border-2 border-border text-text px-3 py-1 shadow-pixel font-pixel text-xs hover:text-accent-bright cursor-pointer"
      >
        Style: {style}
      </button>
    </div>
  );
};
