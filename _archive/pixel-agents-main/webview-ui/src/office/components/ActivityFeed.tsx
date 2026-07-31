import React from 'react';

import { ACTIVITY_FEED_POLL_MS } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';

interface ActivityFeedProps {
  officeState: OfficeState;
}

/**
 * Right-side "subtitle" panel narrating meaningful office activity (FIX-9 Part C).
 * Mirrors {@link OfficeState.activityFeed} — game state lives outside React, so we
 * poll it on an interval (like ReplayControls / NarrationOverlay) and copy it into
 * component state only when it actually changes. Newest line is at the bottom and
 * the list auto-scrolls. Renders nothing until there is at least one event, so the
 * office stays uncluttered on an idle scene.
 */
export const ActivityFeed: React.FC<ActivityFeedProps> = ({ officeState }) => {
  const [lines, setLines] = React.useState<string[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const sigRef = React.useRef('');

  React.useEffect(() => {
    const poll = () => {
      const feed = officeState.activityFeed;
      // Cheap change signature: length + newest line (the feed is append-mostly).
      const sig = `${feed.length}|${feed[feed.length - 1] ?? ''}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setLines(feed.slice());
      }
    };
    poll();
    const interval = setInterval(poll, ACTIVITY_FEED_POLL_MS);
    return () => clearInterval(interval);
  }, [officeState]);

  // Keep the newest line in view.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="absolute right-5 top-8 max-h-[45vh] w-[280px] bg-bg border-2 border-border rounded-none shadow-pixel font-pixel text-text z-40 flex flex-col pointer-events-none">
      <div className="px-3 py-2 border-b-2 border-border text-xs text-accent-bright">Activity</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
        {lines.map((line, i) => (
          <div key={`${i}-${line}`} className="text-xs leading-tight">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
