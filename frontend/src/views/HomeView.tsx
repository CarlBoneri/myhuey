// The whole home: every room at its real size and place. Drag a room to move it; click to open.
import { useMemo, useRef, useState } from 'react';
import { Download, Plus, Power, PowerOff } from 'lucide-react';
import { api } from '../api';
import { attempt, setRoomPower, useStore } from '../store';
import { go } from '../lib/router';
import { area, bounds, labelPoint, pathOf } from '../lib/geometry';
import { formatArea, formatLength, parseLength, snap } from '../lib/units';
import { liveColors, placedProfile, effectiveLength } from '../lib/lights';
import type { Pt, Room } from '../types';
import { PlanCanvas, useDrag, usePlan } from '../components/PlanCanvas';
import { LightSilhouette, OpeningShape } from '../components/Shapes';
import { Empty, Field, Panel, TextInput } from '../components/ui';
import { RoomDimmer } from '../components/RoomDimmer';

export function RoomOnPlan({ room, offset, onMove, onDrop, onSelect, selected }: {
  room: Room; offset: Pt; onMove: (d: Pt) => void; onDrop: () => void;
  /** On the floor plan: a click selects the room for reshaping instead of opening it. */
  onSelect?: () => void; selected?: boolean;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const { lights, profiles } = useStore();
  // Name, size, and power sit together at the room's most open spot, never outside a slanted wall.
  const [lx, ly] = useMemo(() => labelPoint(room.outline), [room.outline]);
  const fontSize = Math.max(12 * cmPerPx, 14);
  return (
    <g
      className={`home-room${selected ? ' selected' : ''}`}
      transform={`translate(${room.x + offset[0]},${room.y + offset[1]})`}
      onPointerDown={(event) =>
        drag(event, {
          move: (_, delta) => onMove([snap(delta[0], room.units), snap(delta[1], room.units)]),
          end: (moved) => (moved ? onDrop() : onSelect ? onSelect() : go({ view: 'room', room: room.name, tab: 'plan' })),
        })
      }
      role="button"
      aria-label={`${room.name}, ${formatLength(room.width, room.units)} by ${formatLength(room.height, room.units)}`}
    >
      <path d={pathOf(room.outline)} className="room-floor" strokeWidth={1.5 * cmPerPx} />
      {room.openings.map((opening) => <OpeningShape key={opening.id} outline={room.outline} opening={opening} cmPerPx={cmPerPx} />)}
      {room.furniture.map((item) => (
        <rect key={item.id} x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth}
          transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`} className="furniture ghost" rx={4} />
      ))}
      {room.lights.map((placement) => {
        const bridge = lights[placement.light_id];
        const profile = placedProfile(placement, bridge, profiles);
        const colors = liveColors(bridge);
        return (
          <g key={placement.light_id} transform={`translate(${placement.x},${placement.y}) rotate(${placement.rotation})`} pointerEvents="none">
            <LightSilhouette profile={profile} length={effectiveLength(placement, profile)} colors={colors} on={!!colors} cmPerPx={cmPerPx} mode={bridge?.gradient?.mode} />
          </g>
        );
      })}
      <text x={lx} y={ly} className="room-name" fontSize={fontSize} textAnchor="middle" pointerEvents="none">{room.name}</text>
      {room.lights.some((p) => lights[p.light_id]) && (() => {
        const anyOn = room.lights.some((p) => lights[p.light_id]?.on);
        const r = Math.max(14 * cmPerPx, 10);
        return (
          <g
            className={`room-power${anyOn ? ' on' : ''}`}
            transform={`translate(${lx},${ly - fontSize - r * 1.2})`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); void setRoomPower(room, !anyOn); }}
            role="button"
            aria-label={`Turn every light in ${room.name} ${anyOn ? 'off' : 'on'}`}
          >
            <title>{anyOn ? 'All off' : 'All on'}</title>
            <circle r={r} strokeWidth={1.5 * cmPerPx} />
            <path d={`M0,${-r * 0.55}V${-r * 0.05}M${-r * 0.42},${-r * 0.32}A${r * 0.5},${r * 0.5} 0 1 0 ${r * 0.42},${-r * 0.32}`} fill="none" strokeWidth={2 * cmPerPx} strokeLinecap="round" />
          </g>
        );
      })()}
      <text x={lx} y={ly + fontSize * 1.1} className="room-size" fontSize={fontSize * 0.75} textAnchor="middle" pointerEvents="none">
        {formatLength(room.width, room.units)} × {formatLength(room.height, room.units)}
      </text>
    </g>
  );
}

export function HomeView() {
  const { rooms, setup, refreshRooms, replaceRoom, lights } = useStore();
  const [moving, setMovingState] = useState<{ name: string; delta: Pt } | null>(null);
  const movingRef = useRef<{ name: string; delta: Pt } | null>(null);
  const setMoving = (next: { name: string; delta: Pt } | null) => {
    movingRef.current = next; // drag handlers outlive the render that created them
    setMovingState(next);
  };
  const [name, setName] = useState('');
  const [width, setWidth] = useState(`14' 9"`);
  const [depth, setDepth] = useState(`9' 10"`);

  const fit = useMemo(() => {
    if (!rooms.length) return { x: 0, y: 0, w: 1000, h: 700 };
    const corners = rooms.flatMap((room) => room.outline.map(([x, y]) => [x + room.x, y + room.y] as Pt));
    const box = bounds(corners);
    return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
  }, [rooms]);

  const create = async () => {
    const w = parseLength(width);
    const d = parseLength(depth);
    if (!name.trim() || !w || !d) {
      useStore.getState().toast('Give the room a name, a width, and a depth.');
      return;
    }
    const room = await attempt(() => api.createRoom(name.trim(), w, d));
    if (room) {
      setName('');
      await refreshRooms();
      go({ view: 'room', room: room.name, tab: 'plan' });
    }
  };

  const lightsOn = Object.values(lights).filter((light) => light.on).length;

  return (
    <div className="page home">
      <header className="page-head">
        <div>
          <p className="eyebrow">Home</p>
          <h1>Floor plan</h1>
        </div>
        <div className="stat-pills">
          <span className="pill static">{rooms.length} rooms</span>
          <span className="pill static">{Object.keys(lights).length} lights</span>
          <span className="pill static glow">{lightsOn} on</span>
        </div>
      </header>
      <div className="split">
        <div className="stage">
          {rooms.length ? (
            <PlanCanvas fit={fit} units={rooms[0]?.units ?? 'imperial'}>
              {rooms.map((room) => (
                <RoomOnPlan
                  key={room.name}
                  room={room}
                  offset={moving?.name === room.name ? moving.delta : [0, 0]}
                  onMove={(delta) => setMoving({ name: room.name, delta })}
                  onDrop={async () => {
                    const current = movingRef.current;
                    const delta = current?.name === room.name ? current.delta : null;
                    setMoving(null);
                    if (!delta) return;
                    const updated = await attempt(() => api.updateRoom(room.name, { x: room.x + delta[0], y: room.y + delta[1] }));
                    if (updated) replaceRoom(room.name, updated);
                  }}
                />
              ))}
            </PlanCanvas>
          ) : (
            <Empty title="No rooms yet">
              <p>Add a room with its real size, or import the rooms from your Hue bridge.</p>
            </Empty>
          )}
        </div>
        <aside className="inspector">
          <Panel title="Rooms">
            <ul className="room-list">
              {rooms.map((room) => {
                const known = room.lights.filter((p) => lights[p.light_id]);
                const onCount = known.filter((p) => lights[p.light_id].on).length;
                return (
                  <li key={room.name} className="room-row">
                    <a href={`#/room/${encodeURIComponent(room.name)}`}>
                      <span>{room.name}</span>
                      <small>
                        {known.length ? `${onCount} of ${known.length} on` : `${room.lights.length} lights`} · {formatArea(area(room.outline), room.units)}
                      </small>
                    </a>
                    {known.length > 0 && (
                      <div className="room-power-buttons">
                        <button type="button" className={`icon-button${onCount === known.length ? ' lit' : ''}`} title="All on" aria-label={`Turn on every light in ${room.name}`} onClick={() => setRoomPower(room, true)}>
                          <Power size={16} strokeWidth={1.6} />
                        </button>
                        <button type="button" className={`icon-button${onCount === 0 ? ' dim' : ''}`} title="All off" aria-label={`Turn off every light in ${room.name}`} onClick={() => setRoomPower(room, false)}>
                          <PowerOff size={16} strokeWidth={1.6} />
                        </button>
                      </div>
                    )}
                    <RoomDimmer room={room} compact />
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="Add a room">
            <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Living room" /></Field>
            <div className="field-row">
              <Field label="Width"><TextInput value={width} onChange={(e) => setWidth(e.target.value)} /></Field>
              <Field label="Depth"><TextInput value={depth} onChange={(e) => setDepth(e.target.value)} /></Field>
            </div>
            <div className="button-row">
              <button type="button" className="button primary" onClick={create}><Plus size={16} /> Add room</button>
              {setup?.configured && (
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    const result = await attempt(() => api.importRooms());
                    if (result) {
                      useStore.getState().toast(result.added.length ? `Imported ${result.added.join(', ')}` : 'No new rooms to import.', false);
                      await refreshRooms();
                    }
                  }}
                >
                  <Download size={16} /> Import from Hue
                </button>
              )}
            </div>
            <p className="hint">Drag rooms to arrange the home. Scroll to zoom, drag the background to pan.</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
