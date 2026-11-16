// The header every Studio screen shares: the room picker and the four views, so the home plan and
// a room's designer read as one module. The rules for where each choice goes are in lib/studio.ts.
// A room chosen from the open list or with the pointer opens at once; one stepped to with the keys
// on the closed picker waits for them to settle.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Camera, House, Map as MapIcon } from 'lucide-react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { go } from '../lib/router';
import { PICK_SETTLE_MS, pickRoom, pickSettles, switchView, type StudioView } from '../lib/studio';
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
  const header = useRef<HTMLElement>(null);
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
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  // The room this picker just opened that the screen has not caught up with, so a view switch clicked in that gap still goes to it.
  const opened = useRef<string | null>(null);

  const pick = (value: string) => {
    const next = value === WHOLE_HOME ? null : value;
    opened.current = value;
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
    if (value === null || value === shown) return;
    // A room that has gone since the choice was made opens nothing.
    if (value !== WHOLE_HOME && !rooms.some((item) => item.name === value)) return;
    pick(value);
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
    opened.current = null;
  }, [shown]);

  const restart = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => openLatest.current(), PICK_SETTLE_MS);
  };
  const change = (value: string) => {
    if (!pickSettles(lastKey.current, Date.now())) { drop(); pick(value); return; }
    pendingRef.current = value;
    setPending(value);
    restart();
  };
  const keyDown = (key: string) => {
    if (key === 'Tab') return;
    lastKey.current = { key, at: Date.now() };
    if (key === 'Enter') open();
    else if (key === 'Escape') drop();
    else if (pendingRef.current !== null) restart(); // any other key, even one that changes nothing, keeps the pause going
  };
  // Blur opens the pending choice, unless focus is only moving to another control in this header (the view switch), which acts on it itself.
  // Safari and Firefox on a Mac do not focus a clicked button, so then the blur names no target; a press that began in this header is told apart so the click it makes can still switch the view.
  const pressed = useRef(false);
  const release = useRef<(() => void) | null>(null);
  const press = () => {
    pressed.current = true;
    if (release.current) return;
    const end = () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      release.current = null;
      // The click comes after the pointerup, so the press stays on until then.
      window.setTimeout(() => { pressed.current = false; }, 0);
    };
    release.current = end;
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  };
  useEffect(() => () => {
    if (!release.current) return;
    window.removeEventListener('pointerup', release.current, true);
    window.removeEventListener('pointercancel', release.current, true);
  }, []);
  const blur = (to: EventTarget | null) => {
    if (pendingRef.current !== null && to instanceof Node && header.current?.contains(to)) return;
    if (pendingRef.current !== null && to === null && pressed.current) return; // the timer keeps running
    open();
  };
  // The view switch acts on the room the picker has chosen, whether or not that room has opened yet.
  const switchTo = (next: StudioView) => {
    const chosen = pendingRef.current ?? opened.current ?? shown;
    drop();
    go(switchView(view, next, { rooms, remembered, on: chosen === WHOLE_HOME ? null : chosen }));
  };

  return (
    <header ref={header} onPointerDownCapture={press} className="page-head studio-head">
      <div>
        <p className="eyebrow">Studio</p>
        <h1 className={view === 'home' || !known ? undefined : 'as-typed'}>{view === 'home' || !known ? 'Whole home' : room}</h1>
      </div>
      <div className="head-tools">
        <label className="studio-room">
          <span>Room</span>
          <select ref={picker} className="input" value={pending ?? shown}
            onPointerDown={() => { lastKey.current = null; }} onKeyDown={(event) => keyDown(event.key)}
            onBlur={(event) => blur(event.relatedTarget)} onChange={(event) => change(event.target.value)}>
            <option value={WHOLE_HOME}>Whole home</option>
            {rooms.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        <Segmented<StudioView>
          label="View"
          value={view}
          onChange={switchTo}
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
