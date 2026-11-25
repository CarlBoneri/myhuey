// What sits on what: the things on a desk move with it, and rise with it when you stand.
import type { Furniture, Placement, Room } from '../types';
import { footprintOf } from './screen';
import { moveSetBy, settle } from './desks';

export type Posture = 'seated' | 'standing';
export const STANDING_DESK_CM = 110;
const SIT_STAND_DESKS = ['desk', 'desk-l'];
const ON_TOP_SLACK_CM = 1;

const rad = (deg: number) => (deg * Math.PI) / 180;
const round1 = (value: number) => Math.round(value * 10) / 10;
const norm = (deg: number) => ((round1(deg) % 360) + 360) % 360;

export const topOf = (item: Furniture) => (item.elevation ?? 0) + (item.height ?? 75);
export const heightOf = (light: Placement) => light.resolved_elevation ?? light.elevation ?? 150;

/** Whether the point (cm) is on the piece's footprint, honoring rotation and shape. */
export function covers(item: Furniture, x: number, y: number): boolean {
  const box = footprintOf(item);
  const angle = rad(-item.rotation);
  const [dx, dy] = [x - box.x, y - box.y];
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  if (item.shape === 'ellipse') return (lx / (box.width / 2)) ** 2 + (ly / (box.depth / 2)) ** 2 <= 1;
  return Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.depth / 2;
}

/** The furniture and lights resting on a piece: over its footprint, at or above its top. */
export function riders(room: Room, base: Furniture): { furniture: string[]; lights: string[] } {
  if (base.kind === 'rug') return { furniture: [], lights: [] };
  const top = topOf(base) - ON_TOP_SLACK_CM;
  return {
    furniture: room.furniture.filter((item) => item.id !== base.id && covers(base, item.x, item.y) && (item.elevation ?? 0) >= top).map((item) => item.id),
    lights: room.lights.filter((light) => covers(base, light.x, light.y) && heightOf(light) >= top).map((light) => light.light_id),
  };
}

/**
 * The room with one piece moved by (dx, dy) and turned by `turn` degrees, carrying what rests on it.
 * A piece in a desk set moves the whole set (turning about the set's base); a light mounted on a
 * moved screen follows it.
 */
export function moveRig(room: Room, id: string, dx: number, dy: number, turn = 0): Room {
  const base = room.furniture.find((item) => item.id === id);
  if (!base) return room;
  if (base.set && room.desk_sets?.some((entry) => entry.id === base.set)) return moveSetBy(room, base.set, dx, dy, turn);
  const riding = riders(room, base);
  const [cos, sin] = [Math.cos(rad(turn)), Math.sin(rad(turn))];
  const carry = <T extends { x: number; y: number; rotation: number }>(thing: T): T => {
    const [rx, ry] = [thing.x - base.x, thing.y - base.y];
    return { ...thing, x: round1(base.x + dx + rx * cos - ry * sin), y: round1(base.y + dy + rx * sin + ry * cos), rotation: norm(thing.rotation + turn) };
  };
  return settle({
    ...room,
    furniture: room.furniture.map((item) => (item.id === id || riding.furniture.includes(item.id) ? carry(item) : item)),
    lights: room.lights.map((light) => (riding.lights.includes(light.light_id) ? carry(light) : light)),
  });
}

/** What rises with a sit-stand desk: its desk set's members on or above its top, else what rests on it. */
function standingRiders(room: Room, desk: Furniture): { furniture: string[]; lights: string[] } {
  if (!desk.set || !room.desk_sets?.some((entry) => entry.id === desk.set)) return riders(room, desk);
  const top = topOf(desk) - ON_TOP_SLACK_CM;
  return {
    furniture: room.furniture.filter((item) => item.id !== desk.id && item.set === desk.set && (item.elevation ?? 0) >= top).map((item) => item.id),
    lights: room.lights.filter((light) => light.set === desk.set && heightOf(light) >= top).map((light) => light.light_id),
  };
}

/**
 * The room as it stands in a posture. Standing raises every sit-stand desk to standing height,
 * with the screens and lights on it. A preview: nothing here is saved.
 */
export function posedRoom(room: Room, posture: Posture): Room {
  if (posture !== 'standing') return room;
  let next = room;
  for (const desk of room.furniture.filter((item) => SIT_STAND_DESKS.includes(item.kind))) {
    const delta = STANDING_DESK_CM - (desk.height ?? 75);
    if (delta <= 0) continue;
    const riding = standingRiders(room, desk);
    next = {
      ...next,
      furniture: next.furniture.map((item) => {
        if (item.id === desk.id) return { ...item, height: STANDING_DESK_CM };
        return riding.furniture.includes(item.id) ? { ...item, elevation: (item.elevation ?? 0) + delta } : item;
      }),
      lights: next.lights.map((light) => (riding.lights.includes(light.light_id) ? { ...light, resolved_elevation: heightOf(light) + delta } : light)),
    };
  }
  return settle(next); // lights mounted on a raised screen rise with it
}
