// The whole-home plan: mapping a scanned plan image onto home centimeters, snapping while
// drawing rooms, and placing doors and windows on room edges.
import type { HomePlan, Opening, Placement, Pt, Units } from '../types';
import { nearestOnSegment, pointInPolygon } from './geometry';
import { snap } from './units';

const turn = ([x, y]: Pt, degrees: number): Pt => {
  const r = (degrees * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

/** Where an image pixel of the plan lands on the home, in cm. Rotation is clockwise on screen, like SVG. */
export function imageToPlan(p: Pt, plan: Pick<HomePlan, 'cm_per_px' | 'offset' | 'rotation'>): Pt {
  const [x, y] = turn([p[0] * plan.cm_per_px, p[1] * plan.cm_per_px], plan.rotation);
  return [plan.offset[0] + x, plan.offset[1] + y];
}

export function planToImage(p: Pt, plan: Pick<HomePlan, 'cm_per_px' | 'offset' | 'rotation'>): Pt {
  const [x, y] = turn([p[0] - plan.offset[0], p[1] - plan.offset[1]], -plan.rotation);
  return [x / plan.cm_per_px, y / plan.cm_per_px];
}

/** cm per image pixel, from a line drawn over a printed dimension of `cm`. Null when it cannot be trusted. */
export function calibrate(a: Pt, b: Pt, cm: number): number | null {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (px < 5 || !(cm > 0) || !Number.isFinite(cm)) return null;
  const scale = cm / px;
  return scale <= 100 ? scale : null;
}

/** Snap a drawing point: to a nearby corner, else onto a nearby edge, else to the inch or cm grid. */
export function snapPoint(p: Pt, { units, radius, corners, edges }: { units: Units; radius: number; corners: Pt[]; edges: [Pt, Pt][] }): Pt {
  let best: Pt | null = null;
  let bestDistance = radius;
  for (const c of corners) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d <= bestDistance) [best, bestDistance] = [c, d];
  }
  if (best) return best;
  for (const [a, b] of edges) {
    const near = nearestOnSegment(p, a, b);
    if (near.distance <= bestDistance) [best, bestDistance] = [near.point, near.distance];
  }
  return best ?? [snap(p[0], units), snap(p[1], units)];
}

const SQUARE_PX = 10;

/**
 * Where a dragged outline corner lands: on another room's corner or wall when it's close
 * (so shared walls line up), otherwise squared up against its two neighbors (unless `free`,
 * Alt held), otherwise on the grid. Everything is in the same coordinates as `target`.
 */
export function snapCorner(
  target: Pt, neighbors: [Pt, Pt],
  { units, radius, corners, edges }: { units: Units; radius: number; corners: Pt[]; edges: [Pt, Pt][] },
  free: boolean,
): Pt {
  const onOther = snapPoint(target, { units, radius, corners, edges });
  const touched = corners.some((c) => c[0] === onOther[0] && c[1] === onOther[1])
    || edges.some(([a, b]) => nearestOnSegment(target, a, b).distance <= radius);
  if (touched) return onOther;
  let p: Pt = [snap(target[0], units), snap(target[1], units)];
  if (!free) {
    const tolerance = (radius / 12) * SQUARE_PX;
    for (const n of neighbors) {
      if (Math.abs(target[0] - n[0]) < tolerance) p = [n[0], p[1]];
      if (Math.abs(target[1] - n[1]) < tolerance) p = [p[0], n[1]];
    }
  }
  return p;
}

function edgeOf(outline: Pt[], index: number): { a: Pt; length: number; unit: Pt } | null {
  if (index < 0 || index >= outline.length) return null;
  const a = outline[index];
  const b = outline[(index + 1) % outline.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { a, length, unit: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
}

/** The stretch of wall a door or window covers, start to end, in room cm. */
export function openingSegment(outline: Pt[], opening: Pick<Opening, 'edge' | 'offset' | 'width'>): [Pt, Pt] | null {
  const edge = edgeOf(outline, opening.edge);
  if (!edge) return null;
  const { a, unit } = edge;
  const at = (d: number): Pt => [a[0] + unit[0] * d, a[1] + unit[1] * d];
  return [at(opening.offset), at(opening.offset + opening.width)];
}

/** An opening `width` wide centered on the wall nearest `p`, kept inside that wall. Null if no wall is within `maxDistance`. */
export function openingAt(outline: Pt[], p: Pt, width: number, maxDistance: number): { edge: number; offset: number; width: number } | null {
  let found: { edge: number; t: number; distance: number } | null = null;
  outline.forEach((a, edge) => {
    const near = nearestOnSegment(p, a, outline[(edge + 1) % outline.length]);
    if (near.distance <= maxDistance && (!found || near.distance < found.distance)) found = { edge, t: near.t, distance: near.distance };
  });
  if (!found) return null;
  const { edge, t } = found;
  const { length } = edgeOf(outline, edge)!;
  const fitted = Math.min(width, length);
  const offset = Math.min(Math.max(t * length - fitted / 2, 0), length - fitted);
  const round = (v: number) => Math.round(v * 10) / 10;
  return { edge, offset: round(offset), width: round(fitted) };
}

/** How far a wall may move and keep its doors and windows. Mirrors OPENING_FOLLOW_CM in models.py. */
export const OPENING_FOLLOW_CM = 30;

/** Move each opening onto the wall of `next` nearest to where it sat on `previous`; drop those whose wall is gone. */
export function reanchorOpenings(previous: Pt[], next: Pt[], openings: Opening[]): Opening[] {
  return openings.flatMap((opening) => {
    const segment = openingSegment(previous, opening);
    if (!segment) return [];
    const mid: Pt = [(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2];
    const spot = openingAt(next, mid, opening.width, OPENING_FOLLOW_CM);
    if (!spot || spot.width < opening.width - 0.5) return [];
    return [{ ...opening, edge: spot.edge, offset: spot.offset }];
  });
}

/** Placed lights whose center falls outside a room outline (room cm). */
export function lightsOutside(lights: Placement[], outline: Pt[]): Placement[] {
  return lights.filter((light) => !pointInPolygon([light.x, light.y], outline));
}
