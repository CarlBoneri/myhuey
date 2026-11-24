// A bias light stuck on a screen's back lights the wall behind it: a soft halo past every edge.
// The halo is the screen's rectangle laid on that wall, grown by how far the light spreads over
// the gap, and fainter the wider the gap; with no wall near behind the screen there is none.
import type { Furniture, Room } from '../types';
import type { Vec3 } from './view3d';
import { arcOf } from './screen';
import { mountSpot } from './desks';

export const HALO_REACH_CM = 150;
const LOOP_INSET_CM = 6;
const BEHIND_CM = 0.5; // the loop sits just behind the back face

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The halo a light on this screen's back throws on the wall behind it, or null when no wall is within reach. */
export function haloOf(room: Pick<Room, 'outline' | 'ceiling'>, screen: Furniture): { corners: Vec3[]; gap: number; opacity: number } | null {
  const spot = mountSpot(screen);
  const back: [number, number] = [Math.sin(rad(screen.rotation)), -Math.cos(rad(screen.rotation))];
  let best: { t: number; along: [number, number] } | null = null;
  const outline = room.outline;
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = [outline[i], outline[(i + 1) % outline.length]];
    const edge: [number, number] = [b[0] - a[0], b[1] - a[1]];
    const den = back[0] * edge[1] - back[1] * edge[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - spot.x) * edge[1] - (a[1] - spot.y) * edge[0]) / den;
    const s = ((a[0] - spot.x) * back[1] - (a[1] - spot.y) * back[0]) / den;
    if (t >= 0 && s >= 0 && s <= 1 && (!best || t < best.t)) {
      const len = Math.hypot(edge[0], edge[1]) || 1;
      best = { t, along: [edge[0] / len, edge[1] / len] };
    }
  }
  if (!best || best.t > HALO_REACH_CM) return null;
  const gap = best.t;
  const spread = 10 + 0.9 * gap;
  const hit: [number, number] = [spot.x + back[0] * gap, spot.y + back[1] * gap];
  const halfWidth = arcOf(screen).chord / 2 + spread;
  const halfHeight = (screen.height ?? 40) / 2 + spread;
  const [low, high] = [Math.max(0, spot.z - halfHeight), Math.min(room.ceiling, spot.z + halfHeight)];
  const [ux, uy] = best.along;
  const at = (side: number, z: number): Vec3 => [round(hit[0] + ux * side * halfWidth), round(hit[1] + uy * side * halfWidth), round(z)];
  return { corners: [at(-1, low), at(1, low), at(1, high), at(-1, high)], gap, opacity: 0.55 * (1 - gap / HALO_REACH_CM) };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Where a strip of `length` cm runs on the screen's back, as a path: all the way round, 6 cm in
 * from the edges, when it is long enough; otherwise a U open at the bottom, shortened evenly at
 * both ends.
 */
export function loopOf(screen: Furniture, length: number | null): Vec3[] {
  const spot = mountSpot(screen);
  const r = rad(screen.rotation);
  const u: [number, number] = [Math.cos(r), Math.sin(r)];
  const back: [number, number] = [Math.sin(r), -Math.cos(r)];
  const [cx, cy] = [spot.x + back[0] * BEHIND_CM, spot.y + back[1] * BEHIND_CM];
  const hw = Math.max(1, arcOf(screen).chord / 2 - LOOP_INSET_CM);
  const hh = Math.max(1, (screen.height ?? 40) / 2 - LOOP_INSET_CM);
  const p = (s: number, t: number): Vec3 => [round(cx + u[0] * s), round(cy + u[1] * s), round(spot.z + t)];
  const perimeter = 4 * hw + 4 * hh;
  const strip = length ?? perimeter;
  if (strip >= perimeter) return [p(-hw, -hh), p(-hw, hh), p(hw, hh), p(hw, -hh), p(-hw, -hh)];
  // A U: up the left side, across the top, down the right side, trimmed evenly at both ends.
  const full = 4 * hh + 2 * hw;
  const trim = Math.max(0, (full - strip) / 2);
  const corners: [number, number][] = [[-hw, -hh], [-hw, hh], [hw, hh], [hw, -hh]];
  const walk = (from: number, to: number): [number, number][] => {
    // Points along the U between distances `from` and `to` measured from its start.
    const out: [number, number][] = [];
    let at = 0;
    for (let i = 0; i < corners.length - 1; i++) {
      const [a, b] = [corners[i], corners[i + 1]];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lerp = (d: number): [number, number] => [a[0] + ((b[0] - a[0]) * (d - at)) / seg, a[1] + ((b[1] - a[1]) * (d - at)) / seg];
      if (from >= at && from <= at + seg && !out.length) out.push(lerp(from));
      if (to >= at && to <= at + seg) { out.push(lerp(to)); break; }
      if (out.length) out.push(b);
      at += seg;
    }
    return out;
  };
  return walk(trim, full - trim).map(([s, t]) => p(s, t));
}
