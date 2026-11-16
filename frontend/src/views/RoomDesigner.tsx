// The Studio's room designer: one room drawn to scale, with its outline, furniture, doors and
// windows, and lights at their physical sizes; plus the room photo. Using the room is the workbench's job.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, Copy, DoorOpen, Hand, Lightbulb, PenLine, Plus, RotateCw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { go, href, parseRoute, type DesignTab } from '../lib/router';
import { markRename } from '../lib/studio';
import { area, bounds, pathOf, round1 } from '../lib/geometry';
import { formatArea, formatLength, snap } from '../lib/units';
import { effectiveLength, liveColors, placedProfile } from '../lib/lights';
import type { Furniture, Opening, PinnableRole, Placement, Pt, Room, Units } from '../types';
import { openingAt, reanchorOpenings } from '../lib/plan';
import { PlanCanvas, useDrag, usePlan } from '../components/PlanCanvas';
import { FURNITURE_CATALOG, FurnitureShape, LightSilhouette, OpeningShape } from '../components/Shapes';
import { LightControls } from '../components/LightControls';
import { StudioHead } from '../components/StudioHead';
import { Empty, Field, HueIcon, IconButton, LengthInput, Panel, Segmented, Sidebar, Slider, TextInput } from '../components/ui';
import { PhotoView } from './PhotoView';
import { OutlineHandles } from '../components/OutlineHandles';
import { PlanLightsPanel } from '../components/PlanLightsPanel';
import { autoRoleLabel, placementNeedsRefresh } from '../lib/suggest';
import { Studio3D } from '../components/Studio3D';
import { roomGlare } from '../lib/roomGlare';
import { useUi } from '../uiStore';

type Selection = { type: 'light'; id: string } | { type: 'furniture'; id: string } | { type: 'opening'; id: string } | null;
type Tool = 'select' | 'outline' | 'openings';
const OPENING_WIDTH = { door: 81, window: 90 } as const;

const angleOf = (from: Pt, to: Pt) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
const norm = (deg: number) => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
const snapAngle = (deg: number, free: boolean) => norm(free ? deg : Math.round(deg / 15) * 15);

/** Room state edited locally, mirrored in a ref so drag handlers always see the latest. */
function useDraft(source: Room | undefined) {
  const [draft, setDraftState] = useState<Room | undefined>(source);
  const ref = useRef(draft);
  const set = useCallback((next: Room | undefined) => {
    ref.current = next;
    setDraftState(next);
  }, []);
  useEffect(() => set(source), [source, set]);
  return [draft, set, ref] as const;
}

function EdgeLabels({ outline, units }: { outline: Pt[]; units: Units }) {
  const { cmPerPx } = usePlan();
  const fontSize = 11 * cmPerPx;
  return (
    <g className="edge-labels" pointerEvents="none">
      {outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length / cmPerPx < 50) return null;
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let angle = angleOf(a, b);
        if (angle > 90 || angle < -90) angle += 180;
        const nx = -(b[1] - a[1]) / length;
        const ny = (b[0] - a[0]) / length;
        const offset = 14 * cmPerPx;
        return (
          <text key={i} x={mid[0] - nx * offset} y={mid[1] - ny * offset} fontSize={fontSize} strokeWidth={3 * cmPerPx} textAnchor="middle" dominantBaseline="central"
            transform={`rotate(${angle} ${mid[0] - nx * offset} ${mid[1] - ny * offset})`}>
            {formatLength(length, units)}
          </text>
        );
      })}
    </g>
  );
}

function WallHits({ outline, onPick }: { outline: Pt[]; onPick: (point: Pt) => void }) {
  const { cmPerPx, toPlan } = usePlan();
  return (
    <g className="wall-hits">
      {outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        return (
          <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={24 * cmPerPx} style={{ cursor: 'copy' }}
            onPointerDown={(event) => { event.stopPropagation(); onPick(toPlan(event.clientX, event.clientY)); }} />
        );
      })}
    </g>
  );
}

function PlacedLight({ placement, selected, onSelect, onChange, onCommit, units }: {
  placement: Placement; selected: boolean; onSelect: () => void; onChange: (p: Placement) => void; onCommit: (p: Placement) => void; units: Units;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const { lights, profiles } = useStore();
  const bridge = lights[placement.light_id];
  const profile = placedProfile(placement, bridge, profiles);
  const length = effectiveLength(placement, profile);
  const colors = liveColors(bridge);
  const latest = useRef(placement);
  latest.current = placement;
  const rad = (placement.rotation * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);

  const endHandle = (event: React.PointerEvent) => {
    const start = latest.current;
    const anchor: Pt = [start.x - (ux * length) / 2, start.y - (uy * length) / 2];
    drag(event, {
      move: (point, _d, e) => {
        if (profile.adjustable) {
          // The far end stays put; the light stretches to the pointer.
          const rotation = snapAngle(angleOf(anchor, point), e.altKey);
          const r = (rotation * Math.PI) / 180;
          const along = Math.max(10, snap((point[0] - anchor[0]) * Math.cos(r) + (point[1] - anchor[1]) * Math.sin(r), units));
          onChange({ ...latest.current, rotation, length: round1(along), x: round1(anchor[0] + (Math.cos(r) * along) / 2), y: round1(anchor[1] + (Math.sin(r) * along) / 2) });
        } else {
          onChange({ ...latest.current, rotation: snapAngle(angleOf([start.x, start.y], point), e.altKey) });
        }
      },
      end: (moved) => moved && onCommit(latest.current),
    });
  };

  return (
    <g
      className={`placed-light${selected ? ' selected' : ''}${placement.planned ? ' planned' : ''}`}
      transform={`translate(${placement.x},${placement.y})`}
      onPointerDown={(event) => {
        onSelect();
        const start = latest.current;
        drag(event, {
          move: (_p, delta) => onChange({ ...latest.current, x: round1(snap(start.x + delta[0], units)), y: round1(snap(start.y + delta[1], units)) }),
          end: (moved) => moved && onCommit(latest.current),
        });
      }}
    >
      <g transform={`rotate(${placement.rotation})`}>
        <LightSilhouette profile={profile} length={length} colors={colors} on={!!colors} selected={selected} cmPerPx={cmPerPx} mode={bridge?.gradient?.mode} />
        {/* A generous invisible hit area for thin strips. */}
        <rect x={-Math.max(length, profile.length) / 2 - 6 * cmPerPx} y={-10 * cmPerPx} width={Math.max(length, profile.length) + 12 * cmPerPx} height={20 * cmPerPx} fill="transparent" />
      </g>
      <text className="light-label" y={(profile.linear ? 14 : profile.length / 2 + 12) * cmPerPx} fontSize={10.5 * cmPerPx} strokeWidth={2.5 * cmPerPx} textAnchor="middle">
        {bridge?.name ?? placement.label}
      </text>
      {selected && profile.linear && (
        <g className="end-handle" transform={`translate(${(ux * length) / 2},${(uy * length) / 2})`} onPointerDown={endHandle}>
          <circle r={7 * cmPerPx} strokeWidth={1.5 * cmPerPx} />
          <title>{profile.adjustable ? 'Drag to rotate and change the length' : 'Drag to rotate'}</title>
        </g>
      )}
    </g>
  );
}

function PlacedFurniture({ item, selected, onSelect, onChange, onCommit, units }: {
  item: Furniture; selected: boolean; onSelect: () => void; onChange: (f: Furniture) => void; onCommit: (f: Furniture) => void; units: Units;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const latest = useRef(item);
  latest.current = item;
  return (
    <g
      className="placed-furniture"
      transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`}
      onPointerDown={(event) => {
        onSelect();
        const start = latest.current;
        drag(event, {
          move: (_p, delta) => onChange({ ...latest.current, x: round1(snap(start.x + delta[0], units)), y: round1(snap(start.y + delta[1], units)) }),
          end: (moved) => moved && onCommit(latest.current),
        });
      }}
    >
      <FurnitureShape item={item} selected={selected} cmPerPx={cmPerPx} />
      {selected && (
        <>
          <g className="end-handle" transform={`translate(0,${-item.depth / 2 - 18 * cmPerPx})`}
            onPointerDown={(event) =>
              drag(event, {
                move: (point, _d, e) => onChange({ ...latest.current, rotation: snapAngle(angleOf([item.x, item.y], point) + 90, e.altKey) }),
                end: (moved) => moved && onCommit(latest.current),
              })
            }>
            <circle r={7 * cmPerPx} strokeWidth={1.5 * cmPerPx} />
            <title>Drag to rotate (hold Alt for free rotation)</title>
          </g>
          <rect className="resize-handle" x={item.width / 2 - 5 * cmPerPx} y={item.depth / 2 - 5 * cmPerPx} width={10 * cmPerPx} height={10 * cmPerPx}
            onPointerDown={(event) => {
              const start = latest.current;
              const r = (-start.rotation * Math.PI) / 180;
              drag(event, {
                move: (_p, delta) => {
                  const local: Pt = [delta[0] * Math.cos(r) - delta[1] * Math.sin(r), delta[0] * Math.sin(r) + delta[1] * Math.cos(r)];
                  onChange({ ...latest.current, width: Math.max(5, round1(snap(start.width + local[0] * 2, units))), depth: Math.max(2, round1(snap(start.depth + local[1] * 2, units))) });
                },
                end: (moved) => moved && onCommit(latest.current),
              });
            }}>
            <title>Drag to resize</title>
          </rect>
        </>
      )}
    </g>
  );
}

export function RoomDesigner({ name, tab }: { name: string; tab: DesignTab }) {
  const { rooms, lights, profiles, replaceRoom, refreshRooms } = useStore();
  const source = rooms.find((room) => room.name === name);
  const [draft, setDraft, draftRef] = useDraft(source);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [openingKind, setOpeningKind] = useState<Opening['kind']>('window');
  const { posture, glareMode } = useUi();

  const fit = useMemo(() => {
    if (!source) return { x: 0, y: 0, w: 450, h: 300 };
    const box = bounds(source.outline);
    return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
  }, [source]);

  const saveRoom = useCallback(async (changes: Parameters<typeof api.updateRoom>[1]) => {
    const current = draftRef.current;
    if (!current) return;
    const updated = await attempt(() => api.updateRoom(current.name, changes));
    if (updated) {
      replaceRoom(current.name, updated);
      if (changes.name && changes.name !== current.name) {
        // Follow the rename only if this room is still the one on screen; someone who has switched rooms since stays where they are.
        const here = parseRoute(window.location.hash);
        if (here.view === 'design' && here.room === current.name) {
          markRename(current.name, updated.name);
          go({ view: 'design', room: updated.name, tab: here.tab });
        }
      }
    } else {
      setDraft(source);
    }
  }, [draftRef, replaceRoom, setDraft, source, tab]);

  const saveLight = useCallback(async (placement: Placement) => {
    const current = draftRef.current;
    if (!current) return;
    const saved = useStore.getState().rooms.find((r) => r.name === current.name)?.lights.find((l) => l.light_id === placement.light_id);
    const ok = await attempt(() => api.placeLight(current.name, {
      light_id: placement.light_id, x: placement.x, y: placement.y, rotation: placement.rotation, length: placement.length, label: placement.label,
      elevation: placement.elevation === null ? 'auto' : placement.elevation, role: placement.role,
    }));
    if (ok) replaceRoom(current.name, { ...current, lights: current.lights.map((l) => (l.light_id === placement.light_id ? placement : l)) });
    // The worked-out height and role depend on the whole room, so read them back.
    // Only a height or role change needs that; moves and nudges don't.
    if (ok && placementNeedsRefresh(saved, placement)) await refreshRooms();
  }, [draftRef, replaceRoom, refreshRooms]);

  const updateLocalLight = (placement: Placement) => {
    const current = draftRef.current!;
    setDraft({ ...current, lights: current.lights.map((l) => (l.light_id === placement.light_id ? placement : l)) });
  };
  const updateLocalFurniture = (item: Furniture) => {
    const current = draftRef.current!;
    setDraft({ ...current, furniture: current.furniture.map((f) => (f.id === item.id ? item : f)) });
  };
  const commitFurniture = () => saveRoom({ furniture: draftRef.current!.furniture });
  const updateLocalOpening = (opening: Opening) => {
    const current = draftRef.current!;
    setDraft({ ...current, openings: current.openings.map((o) => (o.id === opening.id ? opening : o)) });
  };
  const commitOpenings = () => saveRoom({ openings: draftRef.current!.openings });
  const addOpening = (point: Pt) => {
    const current = draftRef.current!;
    const spot = openingAt(current.outline, point, OPENING_WIDTH[openingKind], 40);
    if (!spot) return;
    const opening: Opening = {
      id: Math.random().toString(16).slice(2, 14), kind: openingKind, ...spot,
      sill: openingKind === 'window' ? 90 : null, top: openingKind === 'window' ? 210 : 203,
    };
    const openings = [...current.openings, opening];
    setDraft({ ...current, openings });
    setSelection({ type: 'opening', id: opening.id });
    void saveRoom({ openings });
  };

  const addLight = async (lightId: string, point?: Pt) => {
    const current = draftRef.current!;
    const box = bounds(current.outline);
    const n = current.lights.length;
    const spread = Math.min(box.maxX - box.minX, box.maxY - box.minY) * 0.12;
    const [x, y] = point ?? [
      (box.minX + box.maxX) / 2 + Math.cos(n * 2.4) * spread * Math.sqrt(n),
      (box.minY + box.maxY) / 2 + Math.sin(n * 2.4) * spread * Math.sqrt(n),
    ];
    const ok = await attempt(() => api.placeLight(current.name, { light_id: lightId, x: round1(x), y: round1(y), label: lights[lightId]?.name }));
    if (ok) {
      await refreshRooms();
      setSelection({ type: 'light', id: lightId });
    }
  };

  const addFurniture = (preset: (typeof FURNITURE_CATALOG)[number]) => {
    const current = draftRef.current!;
    const box = bounds(current.outline);
    const item: Furniture = {
      id: Math.random().toString(16).slice(2, 14), kind: preset.kind, label: preset.label,
      // Spiral out from the center so new pieces do not land on each other.
      x: round1((box.minX + box.maxX) / 2 + Math.cos(current.furniture.length * 2.4) * 40 * Math.sqrt(current.furniture.length)),
      y: round1((box.minY + box.maxY) / 2 + Math.sin(current.furniture.length * 2.4) * 40 * Math.sqrt(current.furniture.length)),
      width: preset.width, depth: preset.depth, rotation: 0, shape: preset.shape ?? 'rect',
    };
    setDraft({ ...current, furniture: [...current.furniture, item] });
    setSelection({ type: 'furniture', id: item.id });
    void saveRoom({ furniture: [...current.furniture, item] });
  };

  const removeSelected = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !selection) return;
    if (selection.type === 'furniture') {
      const furniture = current.furniture.filter((f) => f.id !== selection.id);
      setDraft({ ...current, furniture });
      await saveRoom({ furniture });
    } else if (selection.type === 'opening') {
      const openings = current.openings.filter((o) => o.id !== selection.id);
      setDraft({ ...current, openings });
      await saveRoom({ openings });
    } else {
      const ok = await attempt(() => api.removeLight(current.name, selection.id));
      if (ok) await refreshRooms();
    }
    setSelection(null);
  }, [draftRef, refreshRooms, saveRoom, selection, setDraft]);

  // Keyboard: Escape deselects, Delete removes, arrows nudge (Shift for a foot or 10 cm), R rotates 15°.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (tab === 'photo' || !selection || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') {
        setSelection(null);
        return;
      }
      const current = draftRef.current!;
      const unit = current.units === 'imperial' ? 2.54 : 1;
      const step = unit * (event.shiftKey ? (current.units === 'imperial' ? 12 : 10) : 1);
      const moves: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void removeSelected();
      } else if (selection.type === 'opening') {
        return;
      } else if (moves[event.key] || event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        const [dx, dy] = moves[event.key] ?? [0, 0];
        const turn = moves[event.key] ? 0 : event.shiftKey ? -15 : 15;
        if (selection.type === 'light') {
          const light = current.lights.find((l) => l.light_id === selection.id)!;
          const next = { ...light, x: round1(light.x + dx), y: round1(light.y + dy), rotation: norm(light.rotation + turn) };
          updateLocalLight(next);
          void saveLight(next);
        } else {
          const item = current.furniture.find((f) => f.id === selection.id)!;
          updateLocalFurniture({ ...item, x: round1(item.x + dx), y: round1(item.y + dy), rotation: norm(item.rotation + turn) });
          void commitFurniture();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The 3D view: the room as it stands in the chosen posture, and the glare from its seat.
  // Recomputed from the draft, so it follows a drag without a request.
  const glare = useMemo(
    () => (draft && tab === '3d' ? roomGlare(draft, posture, glareMode, lights, profiles) : null),
    [draft, posture, glareMode, lights, profiles, tab],
  );

  /** After a desk moved with what was on it: save the lights it carried, then the furniture. */
  const commitRig = async (lightIds: string[]) => {
    for (const id of lightIds) {
      const placement = draftRef.current?.lights.find((l) => l.light_id === id);
      if (placement) await saveLight(placement);
    }
    await saveRoom({ furniture: draftRef.current!.furniture });
  };

  if (!source || !draft) {
    return <div className="page"><Empty title={`No room named “${name}”`}><a className="button" href="#/studio">Back to the Studio</a></Empty></div>;
  }

  const placedIds = new Set(draft.lights.map((l) => l.light_id));
  const placedElsewhere = new Map(rooms.flatMap((room) => (room.name === draft.name ? [] : room.lights.map((l) => [l.light_id, room.name] as const))));
  const tray = Object.values(lights).filter((light) => !placedIds.has(light.id));
  const selectedLight = selection?.type === 'light' ? draft.lights.find((l) => l.light_id === selection.id) : undefined;
  const selectedFurniture = selection?.type === 'furniture' ? draft.furniture.find((f) => f.id === selection.id) : undefined;
  const selectedOpening = selection?.type === 'opening' ? draft.openings.find((o) => o.id === selection.id) : undefined;

  const inspectorPanels = (
    <>
    {selectedLight && (
      <Panel id="light" title={selectedLight.planned ? 'Planned light' : 'Light'} actions={<IconButton label="Remove from room" danger onClick={removeSelected}><Trash2 size={16} /></IconButton>}>
        {selectedLight.planned ? (
          <SwapPlanned room={draft} placement={selectedLight} unplaced={tray.map((light) => ({ id: light.id, name: light.name }))} />
        ) : lights[selectedLight.light_id] ? <LightControls light={lights[selectedLight.light_id]} /> : <p className="hint">{selectedLight.label} is not on the bridge right now.</p>}
        <LightPlacementFields placement={selectedLight} units={draft.units} onChange={(next) => { updateLocalLight(next); void saveLight(next); }} />
      </Panel>
    )}
    {selectedOpening && (
      <Panel id="opening" title={selectedOpening.kind === 'door' ? 'Door' : 'Window'} actions={<IconButton label="Delete" danger onClick={removeSelected}><Trash2 size={16} /></IconButton>}>
        <Segmented label="Kind" value={selectedOpening.kind}
          onChange={(kind) => { updateLocalOpening({ ...selectedOpening, kind, sill: kind === 'window' ? selectedOpening.sill ?? 90 : null, top: selectedOpening.top ?? (kind === 'window' ? 210 : 203) }); void commitOpenings(); }}
          options={[{ value: 'window', label: 'Window' }, { value: 'door', label: 'Door' }]} />
        <div className="field-row">
          <LengthInput label="Width" value={selectedOpening.width} units={draft.units} onCommit={(width) => { updateLocalOpening({ ...selectedOpening, width: round1(width) }); void commitOpenings(); }} />
          <LengthInput label="From corner" value={selectedOpening.offset} units={draft.units} onCommit={(offset) => { updateLocalOpening({ ...selectedOpening, offset: round1(offset) }); void commitOpenings(); }} />
        </div>
        <div className="field-row">
          {selectedOpening.kind === 'window' && (
            <LengthInput label="Sill height" value={selectedOpening.sill ?? 90} units={draft.units} onCommit={(sill) => { updateLocalOpening({ ...selectedOpening, sill: round1(sill) }); void commitOpenings(); }} />
          )}
          <LengthInput label="Top height" value={selectedOpening.top ?? 203} units={draft.units} onCommit={(top) => { updateLocalOpening({ ...selectedOpening, top: round1(top) }); void commitOpenings(); }} />
        </div>
        <p className="hint">Windows are daylight sources for glare checks, so their heights matter.</p>
      </Panel>
    )}
    {selectedFurniture && (
      <Panel id="selected-furniture" title="Furniture" actions={
        <>
          <IconButton label="Duplicate" onClick={() => addFurniture({ ...selectedFurniture, label: selectedFurniture.label })}><Copy size={16} /></IconButton>
          <IconButton label="Delete" danger onClick={removeSelected}><Trash2 size={16} /></IconButton>
        </>
      }>
        <Field label="Label"><TextInput value={selectedFurniture.label} onChange={(e) => updateLocalFurniture({ ...selectedFurniture, label: e.target.value })} onBlur={commitFurniture} /></Field>
        <div className="field-row">
          <LengthInput label="Width" value={selectedFurniture.width} units={draft.units} onCommit={(width) => { updateLocalFurniture({ ...selectedFurniture, width }); void commitFurniture(); }} />
          <LengthInput label="Depth" value={selectedFurniture.depth} units={draft.units} onCommit={(depth) => { updateLocalFurniture({ ...selectedFurniture, depth }); void commitFurniture(); }} />
        </div>
        <div className="field-row">
          <LengthInput label="Off the floor" value={selectedFurniture.elevation ?? 0} units={draft.units} onCommit={(elevation) => { updateLocalFurniture({ ...selectedFurniture, elevation: round1(elevation) }); void commitFurniture(); }} />
          <LengthInput label="Height" value={selectedFurniture.height ?? 75} units={draft.units} onCommit={(height) => { updateLocalFurniture({ ...selectedFurniture, height: round1(height) }); void commitFurniture(); }} />
        </div>
        <Slider label="Rotation" value={selectedFurniture.rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
          onChange={(rotation) => updateLocalFurniture({ ...selectedFurniture, rotation })} onCommit={commitFurniture} />
        <Segmented label="Shape" value={selectedFurniture.shape} onChange={(shape) => { updateLocalFurniture({ ...selectedFurniture, shape }); void commitFurniture(); }}
          options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Round' }]} />
      </Panel>
    )}
    {!selection && (
      <RoomFields room={draft} onSave={saveRoom} onDelete={async () => {
        if (!confirm(`Delete ${draft.name}, its layout, and its scenes?`)) return;
        if (await attempt(() => api.deleteRoom(draft.name))) {
          await refreshRooms();
          go({ view: 'studio' });
        }
      }} />
    )}

    <Panel title={<><Armchair size={16} strokeWidth={1.5} /> Furniture</>}>
      <div className="catalog">
        {FURNITURE_CATALOG.map((preset) => (
          <button key={preset.kind} type="button" className="catalog-item" onClick={() => addFurniture(preset)} title={`${formatLength(preset.width, draft.units)} × ${formatLength(preset.depth, draft.units)}`}>
            {preset.label}
          </button>
        ))}
      </div>
    </Panel>

    <PlanLightsPanel room={source ?? draft} />

    <Panel title="Lights to place">
      {tray.length ? (
        <ul className="tray">
          {tray.map((light) => (
            <li key={light.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-myhuey-light', light.id)}>
              <HueIcon name={light.profile.icon} size={20} />
              <span>
                {light.name}
                <small>{light.profile.label} · {formatLength(light.profile.length, draft.units)}{placedElsewhere.get(light.id) ? ` · in ${placedElsewhere.get(light.id)}` : ''}</small>
              </span>
              <IconButton label={`Place ${light.name}`} onClick={() => addLight(light.id)}><Plus size={16} /></IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{Object.keys(lights).length ? 'Every light is placed here.' : 'Pair a bridge to place lights.'}</p>
      )}
    </Panel>
    </>
  );

  return (
    <div className="page room">
      <StudioHead view={tab} room={draft.name}>
        <a className="button" href={href({ view: 'room', room: draft.name })}><Lightbulb size={15} /> Open workbench</a>
      </StudioHead>

      {tab === 'photo' ? (
        <PhotoView room={draft} />
      ) : tab === '3d' && glare ? (
        <Studio3D room={draft} glare={glare} selection={selection} onSelect={setSelection}
          onLight={updateLocalLight} onLightCommit={saveLight} onRoom={setDraft} onRigCommit={commitRig}>
          {inspectorPanels}
        </Studio3D>
      ) : (
        <div className="split">
          <div className="stage">
            <div className="toolbar floating">
              <IconButton label="Select and move" active={tool === 'select'} onClick={() => setTool('select')}><Hand size={18} strokeWidth={1.5} /></IconButton>
              <IconButton label="Edit the room outline" active={tool === 'outline'} onClick={() => { setTool('outline'); setSelection(null); }}><PenLine size={18} strokeWidth={1.5} /></IconButton>
              <IconButton label="Add doors and windows" active={tool === 'openings'} onClick={() => { setTool('openings'); setSelection(null); }}><DoorOpen size={18} strokeWidth={1.5} /></IconButton>
              {tool === 'openings' && (
                <Segmented label="Opening" value={openingKind} onChange={setOpeningKind}
                  options={[{ value: 'window', label: 'Window' }, { value: 'door', label: 'Door' }]} />
              )}
            </div>
            <PlanCanvas
              fit={fit}
              units={draft.units}
              onBackgroundPointerDown={() => { setSelection(null); return false; }}
              onDropData={(point, data) => {
                const id = data.getData('application/x-myhuey-light');
                if (id) void addLight(id, point);
                const catalogId = data.getData('application/x-myhuey-catalog');
                if (catalogId) {
                  void attempt(() => api.addPlannedLight(draft.name, { catalog: catalogId, x: round1(point[0]), y: round1(point[1]) }))
                    .then((ok) => ok && refreshRooms());
                }
              }}
            >
              <path d={pathOf(draft.outline)} className={`room-floor big${tool === 'outline' ? ' editing' : ''}`} />
              <EdgeLabels outline={draft.outline} units={draft.units} />
              {tool === 'openings' && <WallHits outline={draft.outline} onPick={addOpening} />}
              <OpeningsLayer room={draft} selectedId={selection?.type === 'opening' ? selection.id : undefined}
                onSelect={(id) => setSelection({ type: 'opening', id })} />
              <g className={tool === 'outline' ? 'dimmed' : ''}>
                {draft.furniture.map((item) => (
                  <PlacedFurniture key={item.id} item={item} units={draft.units} selected={selection?.type === 'furniture' && selection.id === item.id}
                    onSelect={() => setSelection({ type: 'furniture', id: item.id })} onChange={updateLocalFurniture} onCommit={commitFurniture} />
                ))}
                {draft.lights.map((placement) => (
                  <PlacedLight key={placement.light_id} placement={placement} units={draft.units} selected={selection?.type === 'light' && selection.id === placement.light_id}
                    onSelect={() => setSelection({ type: 'light', id: placement.light_id })} onChange={updateLocalLight} onCommit={saveLight} />
                ))}
              </g>
              {tool === 'outline' && (
                <OutlineHandles
                  outline={draft.outline}
                  units={draft.units}
                  onChange={(outline) => {
                    const current = draftRef.current!;
                    setDraft({ ...current, outline, openings: reanchorOpenings(current.outline, outline, current.openings) });
                  }}
                  onCommit={(outline) => {
                    const current = draftRef.current!;
                    setDraft({ ...current, outline, openings: reanchorOpenings(current.outline, outline, current.openings) });
                    void saveRoom({ outline });
                  }}
                />
              )}
            </PlanCanvas>
            {tool === 'outline' && <p className="stage-hint">Drag corners to reshape. Drag a + to add a corner. Double-click a corner to remove it.</p>}
            {tool === 'openings' && <p className="stage-hint">Click a wall to add a {openingKind} there. Doors and windows follow their wall when you reshape the room, and go if their wall does.</p>}
          </div>

          <Sidebar name="designer">{inspectorPanels}</Sidebar>
        </div>
      )}
    </div>
  );
}

function LightPlacementFields({ placement, units, onChange }: { placement: Placement; units: Units; onChange: (p: Placement) => void }) {
  const { lights, profiles } = useStore();
  const profile = placedProfile(placement, lights[placement.light_id], profiles);
  const [rotation, setRotation] = useState(placement.rotation);
  useEffect(() => setRotation(placement.rotation), [placement.rotation]);
  return (
    <div className="placement-fields">
      <p className="hint">
        {profile.label}: {formatLength(effectiveLength(placement, profile), units)}
        {profile.kind !== 'round' && ` × ${formatLength(profile.width, units)}`}
      </p>
      {profile.linear && (
        <Slider label="Rotation" value={rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
          onChange={setRotation} onCommit={(v) => onChange({ ...placement, rotation: v })} />
      )}
      {profile.adjustable && (
        <LengthInput label="Length" value={effectiveLength(placement, profile)} units={units} onCommit={(length) => onChange({ ...placement, length: round1(length) })} />
      )}
      {profile.linear && (
        <button type="button" className="button subtle" onClick={() => onChange({ ...placement, rotation: norm(placement.rotation + 90) })}>
          <RotateCw size={14} /> Turn 90°
        </button>
      )}
      <div className="field-row">
        <LengthInput label={placement.elevation == null ? 'Height (auto)' : 'Height'} value={placement.elevation ?? placement.resolved_elevation ?? 150}
          units={units} onCommit={(elevation) => onChange({ ...placement, elevation: round1(elevation) })} />
        {placement.elevation != null && (
          <button type="button" className="button subtle small" onClick={() => onChange({ ...placement, elevation: null })}>Auto</button>
        )}
      </div>
      <Field label="Role in suggestions" hint="Auto works it out from where the light sits relative to the seat and screen for each mode.">
        <select className="input" value={placement.role ?? 'auto'} onChange={(e) => onChange({ ...placement, role: e.target.value as PinnableRole })}>
          <option value="auto">{autoRoleLabel(placement.resolved_roles)}</option>
          <option value="bias">Bias: behind the screen</option>
          <option value="task">Task: lights your desk</option>
          <option value="view">View: in your line of sight</option>
        </select>
      </Field>
    </div>
  );
}

function RoomFields({ room, onSave, onDelete }: { room: Room; onSave: (changes: Parameters<typeof api.updateRoom>[1]) => void; onDelete: () => void }) {
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.name]);
  const box = bounds(room.outline);
  const lShape = (): Pt[] => {
    const { minX: x, minY: y, maxX: X, maxY: Y } = box;
    const mx = x + (X - x) * 0.6;
    const my = y + (Y - y) * 0.55;
    return [[x, y], [X, y], [X, my], [mx, my], [mx, Y], [x, Y]];
  };
  return (
    <Panel title="Room">
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== room.name && onSave({ name: name.trim() })} />
      </Field>
      <Segmented label="Units" value={room.units} onChange={(units) => onSave({ units })}
        options={[{ value: 'imperial', label: 'Feet & inches' }, { value: 'metric', label: 'Meters' }]} />
      <div className="field-row">
        <LengthInput label="Width" value={room.width} units={room.units} onCommit={(width) => onSave({ width })} />
        <LengthInput label="Depth" value={room.height} units={room.units} onCommit={(height) => onSave({ height })} />
      </div>
      <LengthInput label="Ceiling height" value={room.ceiling} units={room.units} onCommit={(ceiling) => onSave({ ceiling: round1(ceiling) })} />
      <p className="hint">{formatArea(area(room.outline), room.units)} · {room.outline.length} corners. Width and depth stretch the outline.</p>
      <div className="button-row">
        <button type="button" className="button subtle" onClick={() => onSave({ outline: [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]] })}>Rectangle</button>
        <button type="button" className="button subtle" onClick={() => onSave({ outline: lShape() })}>L-shape</button>
        <a className="button subtle" href={href({ view: 'studio', focus: room.name })} title="Edit the corners over your floor plan image">Reshape on the floor plan</a>
        <button type="button" className="button danger subtle" onClick={onDelete}><Trash2 size={14} /> Delete</button>
      </div>
    </Panel>
  );
}


function OpeningsLayer({ room, selectedId, onSelect }: { room: Room; selectedId?: string; onSelect: (id: string) => void }) {
  const { cmPerPx } = usePlan();
  return (
    <g className="openings">
      {room.openings.map((opening) => (
        <g key={opening.id} style={{ cursor: 'pointer' }} onPointerDown={(event) => { event.stopPropagation(); onSelect(opening.id); }}>
          <OpeningShape outline={room.outline} opening={opening} cmPerPx={cmPerPx} selected={opening.id === selectedId} />
        </g>
      ))}
    </g>
  );
}

/** A planned light: what it is, and the swap for a real one once it's paired. */
function SwapPlanned({ room, placement, unplaced }: { room: Room; placement: Placement; unplaced: { id: string; name: string }[] }) {
  const { refreshRooms } = useStore();
  const [choice, setChoice] = useState('');
  return (
    <div className="planned-info">
      <p className="hint">Not installed yet: it takes part in roles and suggestions, and nothing is sent to the bridge for it.</p>
      <Field label="Swap for a real light" hint="Keeps its position, height, role, and photo tag.">
        <div className="button-row">
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Real light to swap in">
            <option value="">{unplaced.length ? 'Choose a paired light…' : 'No unplaced lights on the bridge'}</option>
            {unplaced.map((light) => <option key={light.id} value={light.id}>{light.name}</option>)}
          </select>
          <button type="button" className="button small primary" disabled={!choice} onClick={async () => {
            const ok = await attempt(() => api.swapPlannedLight(room.name, placement.light_id, choice), 'Swapped in the real light.');
            if (ok) { setChoice(''); await refreshRooms(); }
          }}>Swap</button>
        </div>
      </Field>
    </div>
  );
}
