// One room drawn on the whole-home floor plan: its floor, doors and windows, furniture, live
// lights, name, size, and an all-on/off button. Drag to move it; click to select or open it.
import { useMemo } from 'react';
import { setRoomPower, useStore } from '../store';
import { go } from '../lib/router';
import { labelPoint, pathOf } from '../lib/geometry';
import { formatLength, snap } from '../lib/units';
import { effectiveLength, liveColors, placedProfile } from '../lib/lights';
import type { Pt, Room } from '../types';
import { useDrag, usePlan } from './PlanCanvas';
import { LightSilhouette, OpeningShape } from './Shapes';

export function RoomOnPlan({ room, offset, onMove, onDrop, onSelect, selected, readOnly = false, activeOnly = false, onOpen, fillOpacity }: {
  room: Room; offset: Pt; onMove: (d: Pt) => void; onDrop: () => void;
  /** On the floor plan: a click selects the room for reshaping instead of opening it. */
  onSelect?: () => void; selected?: boolean;
  /** No dragging: the home screen while a sandbox is open. */
  readOnly?: boolean;
  /** Power goes to the Active layout's room (the home screen). */
  activeOnly?: boolean;
  /** Replaces opening the room's page on a click. */
  onOpen?: () => void;
  /** See-through floor over a plan image (0 to 1); solid when left out. */
  fillOpacity?: number;
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
          move: (_, delta) => { if (!readOnly) onMove([snap(delta[0], room.units), snap(delta[1], room.units)]); },
          end: (moved) => {
            if (moved && !readOnly) onDrop();
            else if (moved) return;
            else if (onSelect) onSelect();
            else if (onOpen) onOpen();
            else go({ view: 'design', room: room.name, tab: 'plan' });
          },
        })
      }
      role="button"
      aria-label={`${room.name}, ${formatLength(room.width, room.units)} by ${formatLength(room.height, room.units)}`}
    >
      <path d={pathOf(room.outline)} className="room-floor" strokeWidth={1.5 * cmPerPx} style={fillOpacity === undefined ? undefined : { fillOpacity }} />
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
            onClick={(event) => { event.stopPropagation(); void setRoomPower(room, !anyOn, activeOnly); }}
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
