import React, { useEffect, useState } from 'react';

import { REPLAY_SKIP_MS } from '../../constants.js';
import type { ReplayTransport } from '../../transport/replayTransport.js';
import type { OfficeState } from '../engine/officeState.js';

interface ReplayControlsProps {
  transport: ReplayTransport;
  getOfficeState: () => OfficeState;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const ReplayControls: React.FC<ReplayControlsProps> = ({ transport, getOfficeState }) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  useEffect(() => {
    // Poll the transport state every 50ms for smooth UI updates
    const interval = setInterval(() => {
      setDuration(transport.getDuration());
      if (!isScrubbing) {
        setCurrentTime(transport.getCurrentTime());
      }
      setIsPlaying(transport.getIsPlaying());
    }, 50);

    return () => clearInterval(interval);
  }, [transport, isScrubbing]);

  const handlePlayPause = () => {
    const state = getOfficeState();
    if (isPlaying) {
      transport.pause();
      state.timeScale = 0;
    } else {
      // Auto-restart if we reached the end
      if (currentTime >= duration && duration > 0) {
        transport.seek(0);
      }
      transport.play();
      state.timeScale = 1;
    }
  };

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const tMs = parseInt(e.target.value, 10);
    setCurrentTime(tMs);
  };

  const handleScrubStart = () => {
    setIsScrubbing(true);
  };

  const handleScrubCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    setIsScrubbing(false);
    const tMs = parseInt((e.target as HTMLInputElement).value, 10);
    transport.seek(tMs);
    const state = getOfficeState();
    state.timeScale = transport.getIsPlaying() ? 1 : 0;
  };

  // Seek relative to the current position (skip buttons), clamped to [0, duration].
  const skip = (deltaMs: number) => {
    const target = Math.max(0, Math.min(duration, currentTime + deltaMs));
    transport.seek(target);
    setCurrentTime(target);
    getOfficeState().timeScale = transport.getIsPlaying() ? 1 : 0;
  };

  if (duration === 0) return null; // Scenario not loaded yet

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-bg border-2 border-border rounded-none px-6 py-3 flex items-center gap-3 text-text font-pixel shadow-pixel w-[520px] z-50">
      <button
        onClick={() => {
          window.location.search = '';
        }}
        title="Back to the office"
        className="bg-bg border-2 border-border rounded-none px-2 py-1 text-xs text-text cursor-pointer hover:text-accent-bright"
      >
        Home
      </button>
      <button
        onClick={() => skip(-REPLAY_SKIP_MS)}
        title="Back 5 seconds"
        className="bg-bg border-2 border-border rounded-none px-2 py-1 text-xs text-text cursor-pointer hover:text-accent-bright"
      >
        -5s
      </button>
      <button
        onClick={handlePlayPause}
        className="bg-bg border-2 border-border rounded-none px-3 py-1 text-xs text-accent-bright cursor-pointer hover:text-text min-w-[54px]"
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button
        onClick={() => skip(REPLAY_SKIP_MS)}
        title="Forward 5 seconds"
        className="bg-bg border-2 border-border rounded-none px-2 py-1 text-xs text-text cursor-pointer hover:text-accent-bright"
      >
        +5s
      </button>

      <span className="text-xs min-w-[45px] text-right">
        {formatTime(currentTime)}
      </span>

      <input
        type="range"
        min={0}
        max={duration}
        value={currentTime}
        onMouseDown={handleScrubStart}
        onTouchStart={handleScrubStart}
        onChange={handleScrubChange}
        onMouseUp={handleScrubCommit}
        onTouchEnd={handleScrubCommit}
        className="flex-1 pixel-range"
        style={{ '--range-fill': duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' } as React.CSSProperties}
      />

      <span className="text-xs min-w-[45px]">
        {formatTime(duration)}
      </span>
    </div>
  );
};
