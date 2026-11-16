// The header every Studio screen shares: the room picker and the four views, so the home plan and
// a room's designer read as one module. The rules for where each choice goes are in lib/studio.ts.
// A room chosen with the pointer opens at once; one chosen with the keys waits for them to settle.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Camera, House, Map as MapIcon } from 'lucide-react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { go } from '../lib/router';
import { PICK_SETTLE_MS, pickRoom, switchView, type StudioView } from '../lib/studio';
import { Segmented } from './ui';

const WHOLE_HOME = '';

// Choosing a room swaps the whole screen (the designer is keyed by room), which would drop focus
// with it. The picker that opened the room says so here (when it opens, not while a keyboard choice
// is still pending), and the next one to mount takes focus back.
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

  const shown = known ? room : WHOLE_HOME;
  // A choice made with the keys, shown in the picker but not opened yet. The ref is what the timer
  // and key handlers read, so they never act on a stale render.
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const byKeyboard = useRef(false);

  const pick = (value: string) => {
    const next = value === WHOLE_HOME ? null : value;
    refocusPicker = true;
    window.setTimeout(() => { refocusPicker = false; }, 1500); // a pick that changed nothing leaves no claim behind
    onPick?.(next);
    go(pickRoom(view, next, known ? room : null));
  };

  const drop = () => {
    window.clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
  };
  const open = () => {
    const value = pendingRef.current;
    drop();
    if (value !== null && value !== shown) pick(value);
  };
  // The timer calls whatever open the latest render made, so it never opens against an old room or view.
  const openLatest = useRef(open);
  openLatest.current = open;

  // Nothing opens after the picker is gone, and a choice made against one room is not kept when the screen moves to another.
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    window.clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
  }, [shown]);

  const change = (value: string) => {
    if (!byKeyboard.current) { drop(); pick(value); return; }
    pendingRef.current = value;
    setPending(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => openLatest.current(), PICK_SETTLE_MS);
  };
  const keyDown = (key: string) => {
    if (key === 'Tab') return;
    if (key === 'Enter') { open(); return; }
    if (key === 'Escape') { drop(); return; }
    byKeyboard.current = true;
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
          <select ref={picker} className="input" value={pending ?? shown}
            onPointerDown={() => { byKeyboard.current = false; }} onKeyDown={(event) => keyDown(event.key)}
            onBlur={open} onChange={(event) => change(event.target.value)}>
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
