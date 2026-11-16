// The header every Studio screen shares: the room picker and the four views, so the home plan and
// a room's designer read as one module. The rules for where each choice goes are in lib/studio.ts.
import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Camera, House, Map as MapIcon } from 'lucide-react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { go } from '../lib/router';
import { pickRoom, switchView, type StudioView } from '../lib/studio';
import { Segmented } from './ui';

const WHOLE_HOME = '';

// Choosing a room swaps the whole screen (the designer is keyed by room), which would drop focus
// with it. The picker that was used says so here, and the next one to mount takes focus back.
let refocusPicker = false;

export function StudioHead({ view, room, onPick, children }: {
  view: StudioView;
  /** The room on screen, or focused on the home plan; null for the whole home. */
  room: string | null;
  /** Also told about a pick, so a screen that stays mounted (the home plan) can follow it at once. */
  onPick?: (room: string | null) => void;
  /** Extra controls, after the view switch (the room screens' "Open workbench"). */
  children?: ReactNode;
}) {
  const rooms = useStore((state) => state.rooms);
  const remembered = useUi((state) => state.currentRoom);
  const picker = useRef<HTMLSelectElement>(null);
  const none = rooms.length === 0;
  const known = room !== null && rooms.some((item) => item.name === room);

  useEffect(() => {
    if (!refocusPicker) return;
    refocusPicker = false;
    picker.current?.focus();
  }, []);

  const pick = (value: string) => {
    const next = value === WHOLE_HOME ? null : value;
    refocusPicker = true;
    window.setTimeout(() => { refocusPicker = false; }, 1500); // a pick that changed nothing leaves no claim behind
    onPick?.(next);
    go(pickRoom(view, next, known ? room : null));
  };

  return (
    <header className="page-head studio-head">
      <div>
        <p className="eyebrow">Studio</p>
        <h1>{view === 'home' || !known ? 'Whole home' : room}</h1>
      </div>
      <div className="head-tools">
        <label className="studio-room">
          <span>Room</span>
          <select ref={picker} className="input" value={known ? room : WHOLE_HOME} onChange={(event) => pick(event.target.value)}>
            <option value={WHOLE_HOME}>Whole home</option>
            {rooms.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        <Segmented<StudioView>
          label="View"
          value={view}
          onChange={(next) => go(switchView(view, next, { rooms, remembered, on: known ? room : null }))}
          options={[
            { value: 'home', label: <><House size={15} /> Home plan</>, title: 'The whole-home floor plan' },
            { value: 'plan', label: <><MapIcon size={15} /> Room plan</>, title: 'One room: outline, furniture, and lights', disabled: none },
            { value: '3d', label: <><Box size={15} /> 3D</>, title: 'One room in 3D, with the glare check', disabled: none },
            { value: 'photo', label: <><Camera size={15} /> Photo</>, title: 'One room over a photo', disabled: none },
          ]}
        />
        {children}
      </div>
    </header>
  );
}
