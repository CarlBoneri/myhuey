// A room's master brightness: moves every light that is on together. Follows the bridge
// while idle; while dragging it shows the hand's value and sends it on release.
import { useEffect, useState } from 'react';
import { Sun } from 'lucide-react';
import { setRoomBrightness, useStore } from '../store';
import { brightnessToSend, roomBrightness, showRoomSlider } from '../lib/roomControls';
import type { Room } from '../types';
import { Slider } from './ui';

/** `activeOnly`: the home screen's dimmers always work on the Active layout. */
export function RoomDimmer({ room, compact = false, activeOnly = false }: { room: Room; compact?: boolean; activeOnly?: boolean }) {
  const { lights, preferences } = useStore();
  const live = roomBrightness(room, lights);
  const [value, setValue] = useState(live ?? 100);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging && live !== null) setValue(live);
  }, [live, dragging]);
  if (!showRoomSlider(preferences, room, lights)) return null;
  const off = live === null;
  return (
    <div className={`room-dimmer${compact ? ' compact' : ''}${off ? ' off' : ''}`} title={off ? 'Turn some lights on to dim the room' : undefined}>
      {compact && <Sun size={14} strokeWidth={1.6} aria-hidden="true" />}
      <Slider
        label={compact ? `${room.name} brightness` : 'Room brightness'}
        value={value}
        min={1}
        max={100}
        format={(v) => (off ? 'off' : `${Math.round(v)}%`)}
        onChange={(v) => { setDragging(true); setValue(v); }}
        onCommit={async (v) => {
          setDragging(false);
          const level = brightnessToSend(v, live);
          if (level !== null) await setRoomBrightness(room, level, activeOnly);
          else if (live !== null) setValue(live);
        }}
      />
    </div>
  );
}
