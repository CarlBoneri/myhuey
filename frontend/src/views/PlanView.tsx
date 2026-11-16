// The whole home over a scanned floor plan. Set the plan's scale from a printed dimension,
// then click inside a room to trace it, or draw rooms by hand with snapping.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Hand, ImagePlus, PenLine, Plus, Ruler, ScanLine, Square, Trash2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { area, bounds, pathOf, rectPoints, round1 } from '../lib/geometry';
import { calibrate, imageToPlan, lightsOutside, planToImage, snapCorner, snapPoint } from '../lib/plan';
import { go, href } from '../lib/router';
import { OutlineHandles } from '../components/OutlineHandles';
import { scaleToFit, simplifyPolygon, toGray, traceHint, traceRoom, type Gray } from '../lib/trace';
import { formatArea, formatLength, parseLength } from '../lib/units';
import type { HomePlan, Pt, Room, Units } from '../types';
import { PlanCanvas, usePlan } from '../components/PlanCanvas';
import { Empty, Field, IconButton, LengthInput, Panel, Segmented, Sidebar, Slider, TextInput } from '../components/ui';
import { LayoutsPanel } from '../components/LayoutsPanel';
import { RoomOnPlan } from '../components/RoomOnPlan';

type Tool = 'select' | 'scale' | 'trace' | 'draw';
type DrawShape = 'rect' | 'L' | 'points';
const MAX_CORNERS = 200;

/** The plan image as gray pixels at most 1600 px wide, for tracing. */
function usePlanPixels(plan: HomePlan | null) {
  const [pixels, setPixels] = useState<{ gray: Gray; factor: number } | null>(null);
  useEffect(() => {
    setPixels(null);
    if (!plan) return;
    const image = new Image();
    image.onload = () => {
      const factor = scaleToFit(image.naturalWidth, image.naturalHeight);
      const width = Math.max(1, Math.round(image.naturalWidth * factor));
      const height = Math.max(1, Math.round(image.naturalHeight * factor));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      // The stored image may be larger than its record says if it was rescaled; measure from the record.
      const recorded = plan.width || image.naturalWidth;
      setPixels({ gray: toGray(context.getImageData(0, 0, width, height).data, width, height), factor: width / recorded });
    };
    image.src = api.imageUrl(plan.file);
  }, [plan?.file]); // eslint-disable-line react-hooks/exhaustive-deps
  return pixels;
}

/** Keep an outline within the room limit: simplify harder until it fits. */
function withinCornerLimit(outline: Pt[]): Pt[] {
  let result = outline;
  for (let epsilon = 2; result.length > MAX_CORNERS; epsilon *= 1.6) result = simplifyPolygon(outline, epsilon);
  return result;
}

function lShape(a: Pt, b: Pt): Pt[] {
  const [[x, y], [X], [, Y]] = [rectPoints(a, b)[0], rectPoints(a, b)[1], rectPoints(a, b)[2]];
  const mx = x + (X - x) * 0.6;
  const my = y + (Y - y) * 0.55;
  return [[x, y], [X, y], [X, my], [mx, my], [mx, Y], [x, Y]];
}

/** Everything that listens to the pointer for the active tool. Lives inside PlanCanvas for its coordinates. */
function ToolLayer({
  tool, shape, units, rooms, plan, pixels, gap, onOutline, onScaleLine, onTraceNote,
}: {
  tool: Tool; shape: DrawShape; units: Units; rooms: Room[]; plan: HomePlan | null; pixels: { gray: Gray; factor: number } | null; gap: number;
  onOutline: (outline: Pt[]) => void; onScaleLine: (a: Pt, b: Pt) => void;
  /** Why the spot under the pointer will not trace (null when it will, or nothing is tried). */
  onTraceNote: (note: string | null) => void;
}) {
  const { toPlan, cmPerPx } = usePlan();
  const [line, setLine] = useState<[Pt, Pt] | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [preview, setPreview] = useState<Pt[] | null>(null);
  const traceTimer = useRef<number>(0);

  useEffect(() => { setPoints([]); setLine(null); setPreview(null); }, [tool, shape]);

  const corners = useMemo(() => rooms.flatMap((room) => room.outline.map(([x, y]) => [x + room.x, y + room.y] as Pt)), [rooms]);
  const edges = useMemo(() => rooms.flatMap((room) => room.outline.map((p, i) => {
    const q = room.outline[(i + 1) % room.outline.length];
    return [[p[0] + room.x, p[1] + room.y], [q[0] + room.x, q[1] + room.y]] as [Pt, Pt];
  })), [rooms]);
  const snapped = useCallback((p: Pt) => snapPoint(p, { units, radius: 10 * cmPerPx, corners, edges }), [units, cmPerPx, corners, edges]);

  const trace = useCallback((point: Pt) => {
    if (!plan || !pixels) return null;
    const [ix, iy] = planToImage(point, plan);
    const result = traceRoom(pixels.gray, [ix * pixels.factor, iy * pixels.factor], { gap });
    if (!result.ok) return result;
    const outline = withinCornerLimit(result.outline).map(([x, y]) => imageToPlan([x / pixels.factor, y / pixels.factor], plan));
    return { ok: true as const, outline };
  }, [plan, pixels, gap]);

  const finishPoints = (list: Pt[]) => {
    if (list.length >= 3) onOutline(list);
    setPoints([]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') { setPoints([]); setLine(null); }
      if (event.key === 'Enter' && tool === 'draw' && shape === 'points') finishPoints(points);
      if (event.key === 'Backspace' && points.length) setPoints(points.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (tool === 'select') return null;

  const dragFrom = (start: Pt, onMove: (p: Pt) => void, onEnd: (p: Pt) => void) => {
    let last = start;
    const move = (e: PointerEvent) => { last = toPlan(e.clientX, e.clientY); onMove(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onEnd(last); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return; // middle-drag pans
    event.stopPropagation();
    const point = toPlan(event.clientX, event.clientY);
    if (tool === 'scale') {
      setLine([point, point]);
      dragFrom(point, (p) => setLine([point, p]), (p) => { setLine(null); onScaleLine(point, p); });
    } else if (tool === 'trace') {
      const result = trace(point);
      // A spot that will not trace explains itself in the hint, never as an error toast.
      if (!result) onTraceNote('Upload a floor-plan image to trace rooms.');
      else if (!result.ok) onTraceNote(traceHint(result));
      else { onTraceNote(null); onOutline(result.outline); }
    } else if (shape === 'points') {
      const p = snapped(point);
      if (points.length >= 3 && Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) < 10 * cmPerPx) finishPoints(points);
      else setPoints([...points, p]);
    } else {
      const start = snapped(point);
      const make = (end: Pt) => (shape === 'L' ? lShape(start, end) : rectPoints(start, end));
      dragFrom(start, (p) => setPreview(make(snapped(p))), (p) => {
        setPreview(null);
        const end = snapped(p);
        if (Math.abs(end[0] - start[0]) > 30 && Math.abs(end[1] - start[1]) > 30) onOutline(make(end));
      });
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const point = toPlan(event.clientX, event.clientY);
    setHover(tool === 'draw' ? snapped(point) : point);
    if (tool === 'trace') {
      window.clearTimeout(traceTimer.current);
      traceTimer.current = window.setTimeout(() => {
        const result = trace(point);
        setPreview(result?.ok ? result.outline : null);
        onTraceNote(traceHint(result));
      }, 120);
    }
  };

  const s = cmPerPx;
  return (
    <g className="tool-layer">
      <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" style={{ cursor: 'crosshair' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => { setHover(null); if (tool === 'trace') { window.clearTimeout(traceTimer.current); setPreview(null); onTraceNote(null); } }}
        onDoubleClick={() => tool === 'draw' && shape === 'points' && finishPoints(points)} />
      <g pointerEvents="none">
        {preview && <path d={pathOf(preview)} className="trace-preview" strokeWidth={2 * s} strokeDasharray={`${6 * s} ${4 * s}`} />}
        {line && (
          <>
            <line x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} className="scale-line" strokeWidth={2 * s} />
            {[line[0], line[1]].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4 * s} className="scale-line" />)}
          </>
        )}
        {points.length > 0 && (
          <>
            <polyline points={[...points, ...(hover ? [hover] : [])].map((p) => p.join(',')).join(' ')} className="draw-line" strokeWidth={2 * s} fill="none" />
            {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 ? 6 : 4) * s} className="draw-point" />)}
          </>
        )}
        {tool === 'draw' && hover && <circle cx={hover[0]} cy={hover[1]} r={3 * s} className="draw-point" />}
      </g>
    </g>
  );
}

function Backdrop({ plan }: { plan: HomePlan }) {
  return (
    <image href={api.imageUrl(plan.file)} x={0} y={0} width={plan.width * plan.cm_per_px} height={plan.height * plan.cm_per_px}
      transform={`translate(${plan.offset[0]},${plan.offset[1]}) rotate(${plan.rotation})`} opacity={plan.opacity}
      preserveAspectRatio="none" pointerEvents="none" className="plan-backdrop" />
  );
}

export function PlanView({ focus }: { focus?: string } = {}) {
  const { rooms, plan, setPlan, refreshRooms, replaceRoom, toast, layout, setup } = useStore();
  const [tool, setTool] = useState<Tool>('select');
  const [shape, setShape] = useState<DrawShape>('rect');
  const [gap, setGap] = useState(3);
  const [pending, setPending] = useState<Pt[] | null>(null);
  const [scaleLine, setScaleLine] = useState<{ a: Pt; b: Pt } | null>(null);
  const [scaleText, setScaleText] = useState('');
  const [newName, setNewName] = useState('');
  const [replaceName, setReplaceName] = useState('');
  const [moving, setMovingState] = useState<{ name: string; delta: Pt } | null>(null);
  const movingRef = useRef(moving);
  const setMoving = (next: typeof moving) => { movingRef.current = next; setMovingState(next); };
  const pixels = usePlanPixels(plan);
  const [traceNote, setTraceNote] = useState<string | null>(null);
  useEffect(() => setTraceNote(null), [tool]);
  const [roomName, setRoomName] = useState('');
  const [roomWidth, setRoomWidth] = useState(`14' 9"`);
  const [roomDepth, setRoomDepth] = useState(`9' 10"`);
  // Reshaping a room in place, over the plan image: the selected room and its outline mid-drag.
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [draft, setDraft] = useState<Pt[] | null>(null);
  useEffect(() => { if (focus) { setSelected(focus); setTool('select'); } }, [focus]);
  // Another layout was opened: drop what was selected or half-drawn in the last one.
  const firstLayout = useRef(layout);
  useEffect(() => {
    if (firstLayout.current === layout) return;
    firstLayout.current = layout;
    setSelected(null); setDraft(null); setPending(null); setScaleLine(null); setMoving(null);
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedRoom = rooms.find((room) => room.name === selected) ?? null;
  const units: Units = rooms[0]?.units ?? 'imperial';

  const fit = useMemo(() => {
    const corners = rooms.flatMap((room) => room.outline.map(([x, y]) => [x + room.x, y + room.y] as Pt));
    if (plan) {
      for (const p of [[0, 0], [plan.width, 0], [plan.width, plan.height], [0, plan.height]] as Pt[]) corners.push(imageToPlan(p, plan));
    }
    if (!corners.length) return { x: 0, y: 0, w: 1000, h: 700 };
    const box = bounds(corners);
    return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
  }, [rooms, plan?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePlan = async (changes: Parameters<typeof api.updatePlan>[0]) => {
    if (!plan) return;
    setPlan({ ...plan, ...changes });
    const saved = await attempt(() => api.updatePlan(changes));
    setPlan(saved ?? plan);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const saved = await attempt(() => api.uploadPlan(file), 'Plan uploaded. Next: draw a line over a printed dimension.');
    if (saved) {
      setPlan(saved);
      setTool('scale');
    }
  };

  const applyScale = () => {
    if (!scaleLine || !plan) return;
    const cm = parseLength(scaleText, units);
    const scale = cm === null ? null : calibrate(planToImage(scaleLine.a, plan), planToImage(scaleLine.b, plan), cm);
    if (scale === null) {
      toast('Type the printed length, like 12\' 6" or 3.8 m, over a line at least a few pixels long.');
      return;
    }
    void savePlan({ cm_per_px: round1(scale * 1e4) / 1e4 });
    setScaleLine(null);
    setScaleText('');
    setTool('trace');
  };

  const createRoom = async () => {
    if (!pending || !newName.trim()) return;
    const box = bounds(pending);
    const outline = pending.map(([x, y]) => [round1(x - box.minX), round1(y - box.minY)] as Pt);
    const room = await attempt(() => api.createRoom(newName.trim(), box.maxX - box.minX, box.maxY - box.minY, {
      outline, x: round1(box.minX), y: round1(box.minY),
    }), `Added ${newName.trim()}`);
    if (room) {
      setPending(null);
      setNewName('');
      await refreshRooms();
    }
  };

  const replaceOutline = async () => {
    const room = rooms.find((r) => r.name === replaceName);
    if (!pending || !room) return;
    // Keep the room's origin so its lights, furniture, and scene zones stay where they are.
    const outline = pending.map(([x, y]) => [round1(x - room.x), round1(y - room.y)] as Pt);
    const updated = await attempt(() => api.updateRoom(room.name, { outline }));
    if (!updated) return;
    replaceRoom(room.name, updated);
    setPending(null);
    const outside = lightsOutside(updated.lights, updated.outline);
    toast(outside.length
      ? `${room.name} reshaped. Now outside it: ${outside.map((l) => l.label).join(', ')}. Move them back in on the room's plan.`
      : `${room.name} reshaped.`, outside.length > 0);
  };

  const reshape = async (room: Room, outline: Pt[]) => {
    const rounded = outline.map(([x, y]) => [round1(x), round1(y)] as Pt);
    const updated = await attempt(() => api.updateRoom(room.name, { outline: rounded }));
    setDraft(null);
    if (!updated) return;
    replaceRoom(room.name, updated);
    const outside = lightsOutside(updated.lights, updated.outline);
    if (outside.length) toast(`Now outside ${room.name}: ${outside.map((l) => l.label).join(', ')}. Move them back in on the room's plan.`, true);
  };

  /** Snap a dragged corner of `room` to the other rooms' corners and walls (in its own coordinates). */
  const snapFor = (room: Room) => {
    const others = rooms.filter((other) => other.name !== room.name);
    const corners = others.flatMap((other) => other.outline.map(([x, y]) => [x + other.x - room.x, y + other.y - room.y] as Pt));
    const edges = others.flatMap((other) => other.outline.map((p, i) => {
      const q = other.outline[(i + 1) % other.outline.length];
      return [[p[0] + other.x - room.x, p[1] + other.y - room.y], [q[0] + other.x - room.x, q[1] + other.y - room.y]] as [Pt, Pt];
    }));
    return (target: Pt, neighbors: [Pt, Pt], free: boolean, radius: number) =>
      free ? snapCorner(target, neighbors, { units, radius, corners: [], edges: [] }, true)
        : snapCorner(target, neighbors, { units, radius, corners, edges }, false);
  };

  const addRoomBySize = async () => {
    const w = parseLength(roomWidth);
    const d = parseLength(roomDepth);
    if (!roomName.trim() || !w || !d) {
      toast('Give the room a name, a width, and a depth.');
      return;
    }
    const room = await attempt(() => api.createRoom(roomName.trim(), w, d));
    if (room) {
      setRoomName('');
      await refreshRooms();
      go({ view: 'design', room: room.name, tab: 'plan' });
    }
  };

  const importRooms = async () => {
    const result = await attempt(() => api.importRooms());
    if (result) {
      toast(result.added.length ? `Imported ${result.added.join(', ')}` : 'No new rooms to import.', false);
      await refreshRooms();
    }
  };

  const hint = {
    select: selectedRoom
      ? `Reshaping ${selectedRoom.name}: drag a corner, drag a + to add one, double-click a corner to remove it. Corners snap to other rooms; hold Alt to place freely.`
      : 'Click a room to reshape it over the plan. Drag a room to move it.',
    scale: 'Drag a line over a printed dimension, then type its length.',
    trace: 'Hover inside a room to preview its outline. Click to keep it.',
    draw: shape === 'points' ? 'Click each corner. Click the first corner, double-click, or press Enter to close. Esc cancels.' : 'Drag out the room. Corners snap to other rooms.',
  }[tool];

  return (
    <div className="page plan-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>Floor plan</h1>
        </div>
      </header>
      <div className="split">
        <div className="stage">
          <div className="toolbar floating">
            <IconButton label="Select and move" active={tool === 'select'} onClick={() => setTool('select')}><Hand size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Set the scale" active={tool === 'scale'} disabled={!plan} onClick={() => setTool('scale')}><Ruler size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Trace a room" active={tool === 'trace'} disabled={!plan} onClick={() => setTool('trace')}><ScanLine size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Draw a room" active={tool === 'draw'} onClick={() => setTool('draw')}><PenLine size={18} strokeWidth={1.5} /></IconButton>
          </div>
          <PlanCanvas fit={fit} units={units} onBackgroundPointerDown={() => { if (tool === 'select') setSelected(null); return false; }}>
            {plan && <Backdrop plan={plan} />}
            <g pointerEvents={tool === 'select' ? undefined : 'none'}>
              {rooms.map((room) => (
                <RoomOnPlan key={room.name} room={room.name === selected && draft ? { ...room, outline: draft } : room}
                  offset={moving?.name === room.name ? moving.delta : [0, 0]}
                  selected={room.name === selected} onSelect={() => setSelected(room.name)}
                  fillOpacity={plan ? plan.room_opacity ?? 0.4 : undefined}
                  onMove={(delta) => setMoving({ name: room.name, delta })}
                  onDrop={async () => {
                    const delta = movingRef.current?.name === room.name ? movingRef.current.delta : null;
                    setMoving(null);
                    if (!delta) return;
                    const updated = await attempt(() => api.updateRoom(room.name, { x: room.x + delta[0], y: room.y + delta[1] }));
                    if (updated) replaceRoom(room.name, updated);
                  }} />
              ))}
            </g>
            {tool === 'select' && selectedRoom && !moving && (
              <g transform={`translate(${selectedRoom.x},${selectedRoom.y})`}>
                <ReshapeHandles room={selectedRoom} outline={draft ?? selectedRoom.outline} units={units}
                  snap={snapFor(selectedRoom)} onChange={setDraft} onCommit={(outline) => void reshape(selectedRoom, outline)} />
              </g>
            )}
            {pending && <path d={pathOf(pending)} className="pending-outline" />}
            <ToolLayer tool={tool} shape={shape} units={units} rooms={rooms} plan={plan} pixels={pixels} gap={gap}
              onOutline={(outline) => { setPending(outline); setNewName(''); }}
              onScaleLine={(a, b) => setScaleLine({ a, b })}
              onTraceNote={setTraceNote} />
          </PlanCanvas>
          <p className={`stage-hint${traceNote ? ' warn' : ''}`} role={traceNote ? 'status' : undefined}>{traceNote ?? hint}</p>
        </div>

        <Sidebar name="floorplan">
          <LayoutsPanel />
          {!pending && !scaleLine && !(tool === 'select' && selectedRoom) && (
            <Panel title="Add a room">
              <Field label="Name"><TextInput value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Living room" /></Field>
              <div className="field-row">
                <Field label="Width"><TextInput value={roomWidth} onChange={(e) => setRoomWidth(e.target.value)} /></Field>
                <Field label="Depth"><TextInput value={roomDepth} onChange={(e) => setRoomDepth(e.target.value)} /></Field>
              </div>
              <div className="button-row">
                <button type="button" className="button primary" onClick={addRoomBySize}><Plus size={16} /> Add room</button>
                {setup?.configured && <button type="button" className="button" onClick={importRooms}><Download size={16} /> Import from Hue</button>}
              </div>
              <p className="hint">Or trace and draw rooms over a plan image with the tools on the left.</p>
            </Panel>
          )}
          {tool === 'select' && selectedRoom && (
            <Panel id="room" title={selectedRoom.name} actions={<IconButton label="Done reshaping" onClick={() => setSelected(null)}><Check size={16} /></IconButton>}>
              <p className="hint">{formatLength(selectedRoom.width, selectedRoom.units)} × {formatLength(selectedRoom.height, selectedRoom.units)} · {selectedRoom.outline.length} corners</p>
              <p className="hint">Drag the corners onto the walls in the plan behind. Each change saves; doors and windows stay on their walls.</p>
              <div className="button-row">
                <a className="button" href={href({ view: 'design', room: selectedRoom.name, tab: 'plan' })}>Open room</a>
                <button type="button" className="button subtle" onClick={() => setSelected(null)}>Done</button>
              </div>
            </Panel>
          )}
          {pending && (
            <Panel title="New outline" actions={<IconButton label="Discard" danger onClick={() => setPending(null)}><Trash2 size={16} /></IconButton>}>
              <p className="hint">{formatArea(area(pending), units)} · {pending.length} corners</p>
              <Field label="Add as a new room">
                <TextInput value={newName} placeholder="Room name" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createRoom()} />
              </Field>
              <button type="button" className="button primary" disabled={!newName.trim()} onClick={createRoom}>Add room</button>
              {rooms.length > 0 && (
                <>
                  <Field label="Or replace a room's outline" hint="Its lights, furniture, and scenes are kept.">
                    <select className="input" value={replaceName} onChange={(e) => setReplaceName(e.target.value)}>
                      <option value="">Choose a room…</option>
                      {rooms.map((room) => <option key={room.name} value={room.name}>{room.name}</option>)}
                    </select>
                  </Field>
                  <button type="button" className="button" disabled={!replaceName} onClick={replaceOutline}>Replace outline</button>
                </>
              )}
            </Panel>
          )}

          {scaleLine && plan && (
            <Panel title="Scale">
              <p className="hint">Measured line: {formatLength(Math.hypot(scaleLine.b[0] - scaleLine.a[0], scaleLine.b[1] - scaleLine.a[1]), units)} at the current scale.</p>
              <Field label="Printed length">
                <TextInput autoFocus value={scaleText} placeholder={units === 'imperial' ? `12' 6"` : '3.8 m'} onChange={(e) => setScaleText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyScale()} />
              </Field>
              <div className="button-row">
                <button type="button" className="button primary" onClick={applyScale}>Set scale</button>
                <button type="button" className="button subtle" onClick={() => setScaleLine(null)}>Cancel</button>
              </div>
            </Panel>
          )}

          {tool === 'trace' && (
            <Panel title="Trace">
              <Slider label="Close door gaps" value={gap} min={0} max={15} format={(v) => `${v} px`} onChange={setGap} onCommit={setGap} />
              <p className="hint">Raise this if outlines spill through doorways. Lower it if small rooms vanish.</p>
            </Panel>
          )}

          {tool === 'draw' && (
            <Panel title="Draw">
              <Segmented label="Shape" value={shape} onChange={setShape} options={[
                { value: 'rect', label: <><Square size={14} /> Rectangle</> },
                { value: 'L', label: 'L-shape' },
                { value: 'points', label: 'Corners' },
              ]} />
            </Panel>
          )}

          <Panel title="Plan image">
            {plan ? (
              <>
                <p className="hint">{plan.width} × {plan.height} px · 100 px = {formatLength(plan.cm_per_px * 100, units)}</p>
                <Slider label="Opacity" value={Math.round(plan.opacity * 100)} min={5} max={100} format={(v) => `${v}%`}
                  onChange={(v) => setPlan({ ...plan, opacity: v / 100 })} onCommit={(v) => savePlan({ opacity: v / 100 })} />
                <Slider label="Room fill" value={Math.round((plan.room_opacity ?? 0.4) * 100)} min={0} max={100} format={(v) => `${v}%`}
                  onChange={(v) => setPlan({ ...plan, room_opacity: v / 100 })} onCommit={(v) => savePlan({ room_opacity: v / 100 })} />
                <Slider label="Rotation" value={plan.rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
                  onChange={(rotation) => setPlan({ ...plan, rotation })} onCommit={(rotation) => savePlan({ rotation })} />
                <div className="field-row">
                  <LengthInput label="Left" value={plan.offset[0]} units={units} onCommit={(x) => savePlan({ offset: [round1(x), plan.offset[1]] })} />
                  <LengthInput label="Top" value={plan.offset[1]} units={units} onCommit={(y) => savePlan({ offset: [plan.offset[0], round1(y)] })} />
                </div>
                <div className="button-row">
                  <label className="button subtle"><ImagePlus size={14} /> Replace<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
                  <button type="button" className="button danger subtle" onClick={async () => {
                    if (await attempt(() => api.deletePlan())) setPlan(null);
                  }}><Trash2 size={14} /> Remove</button>
                </div>
              </>
            ) : (
              <Empty title="No plan image">
                <p>Upload a floor plan (JPEG, PNG, or WebP) to trace rooms from it. No plan? Draw rooms with the pen.</p>
                <label className="button primary"><ImagePlus size={16} /> Upload a plan<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
              </Empty>
            )}
          </Panel>
        </Sidebar>
      </div>
    </div>
  );
}

/** The outline editor, wired to the plan screen's snapping (its zoom sets the snap radius). */
function ReshapeHandles({ room, outline, units, snap, onChange, onCommit }: {
  room: Room; outline: Pt[]; units: Units;
  snap: (target: Pt, neighbors: [Pt, Pt], free: boolean, radius: number) => Pt;
  onChange: (outline: Pt[]) => void; onCommit: (outline: Pt[]) => void;
}) {
  const { cmPerPx } = usePlan();
  return <OutlineHandles outline={outline} units={units} onChange={onChange} onCommit={onCommit} origin={[room.x, room.y]}
    snapTo={(target, neighbors, free) => snap(target, neighbors, free, 12 * cmPerPx)} />;
}
