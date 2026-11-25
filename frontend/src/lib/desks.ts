// Desk sets and mounted lights in the browser: the same rules as src/myhuey/desks.py, so a drag
// can show the result before the server saves it. Plan cm; at rotation 0 a piece's front faces +y.
import type { DeskSet, Furniture, Room } from '../types';

const rad = (deg: number) => (deg * Math.PI) / 180;
const r2 = (value: number) => Math.round(value * 100) / 100;
const norm = (deg: number) => ((Math.round(deg * 100) / 100) % 360 + 360) % 360;
const front = (item: Furniture): [number, number] => [-Math.sin(rad(item.rotation)), Math.cos(rad(item.rotation))];

/** Where a light mounted on this screen sits: its back-face middle, at the screen's middle height, turned like it. */
export function mountSpot(screen: Furniture): { x: number; y: number; z: number; rotation: number } {
  const [fx, fy] = front(screen);
  return {
    x: r2(screen.x - (fx * screen.depth) / 2), y: r2(screen.y - (fy * screen.depth) / 2),
    z: r2((screen.elevation ?? 0) + (screen.height ?? 40) / 2), rotation: screen.rotation,
  };
}

/**
 * The room as the set and mount rules want it: a set without its base dissolves, members of an
 * unknown set leave it, and a mounted light sits on its screen's back as a bias light in the
 * screen's set (a mount whose screen is gone is dropped). Returns the same object when nothing changes.
 */
export function settle(room: Room): Room {
  const pieces = new Map(room.furniture.map((item) => [item.id, item]));
  const sets = (room.desk_sets ?? []).filter((entry) => pieces.has(entry.base));
  const known = new Set(sets.map((entry) => entry.id));
  let changed = sets.length !== (room.desk_sets ?? []).length;
  const furniture = room.furniture.map((item) => {
    if (!item.set || known.has(item.set)) return item;
    changed = true;
    return { ...item, set: null };
  });
  const lights = room.lights.map((light) => {
    let next = light.set && !known.has(light.set) ? { ...light, set: null } : light;
    if (next.mount) {
      const screen = pieces.get(next.mount.screen);
      if (!screen) next = { ...next, mount: null };
      else {
        const spot = mountSpot(screen);
        const set = screen.set && known.has(screen.set) ? screen.set : null;
        if (next.x !== spot.x || next.y !== spot.y || next.elevation !== spot.z || next.resolved_elevation !== spot.z
          || next.rotation !== spot.rotation || next.role !== 'bias' || (next.set ?? null) !== set) {
          next = { ...next, x: spot.x, y: spot.y, elevation: spot.z, resolved_elevation: spot.z, rotation: spot.rotation, role: 'bias', set };
        }
      }
    }
    if (next !== light) changed = true;
    return next;
  });
  return changed ? { ...room, furniture, lights, desk_sets: sets } : room;
}

/** The set a piece (by id) or a light (by light id) belongs to. */
export function setOf(room: Room, id: string): DeskSet | null {
  const member = room.furniture.find((item) => item.id === id)?.set ?? room.lights.find((light) => light.light_id === id)?.set;
  return (member && room.desk_sets?.find((entry) => entry.id === member)) || null;
}

/** The room with a set moved by (dx, dy) and turned by `turn` degrees about its base, then settled. */
export function moveSetBy(room: Room, setId: string, dx: number, dy: number, turn = 0): Room {
  const entry = room.desk_sets?.find((e) => e.id === setId);
  const base = entry && room.furniture.find((item) => item.id === entry.base);
  if (!base) return room;
  const [cos, sin] = [Math.cos(rad(turn)), Math.sin(rad(turn))];
  const carry = <T extends { x: number; y: number; rotation: number }>(thing: T): T => {
    const [rx, ry] = [thing.x - base.x, thing.y - base.y];
    return { ...thing, x: r2(base.x + dx + rx * cos - ry * sin), y: r2(base.y + dy + rx * sin + ry * cos), rotation: norm(thing.rotation + turn) };
  };
  return settle({
    ...room,
    furniture: room.furniture.map((item) => (item.set === setId ? carry(item) : item)),
    lights: room.lights.map((light) => (light.set === setId ? carry(light) : light)),
  });
}

/** Where a set's base stands, for saving a move in one call. */
export function baseOf(room: Room, setId: string): Furniture | undefined {
  const entry = room.desk_sets?.find((e) => e.id === setId);
  return entry && room.furniture.find((item) => item.id === entry.base);
}

