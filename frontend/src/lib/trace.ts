// Click-to-trace: find the room around a point on a scanned floor plan. Runs in the browser
// on a copy of the plan no larger than 1600 px. Dark pixels are walls; door openings are
// closed by growing the walls by `gap` px before the room is flood-filled.
import type { Pt } from '../types';
import { area } from './geometry';

export interface Gray { width: number; height: number; data: Uint8Array }
export type TraceResult = { ok: true; outline: Pt[] } | { ok: false; reason: 'wall' | 'leak' | 'tiny' };

export const MAX_TRACE_SIDE = 1600;
/** A fill covering more than this share of the image escaped the room (through a gap or a frame line). */
export const LEAK_FRACTION = 0.6;
const MIN_REGION_PX = 50;
/** An outline enclosing this many times the pixels actually filled wrapped around other rooms. */
export const WRAP_RATIO = 1.5;

/** The factor (at most 1) that fits an image inside MAX_TRACE_SIDE. */
export function scaleToFit(width: number, height: number, max = MAX_TRACE_SIDE): number {
  return Math.min(1, max / Math.max(width, height));
}

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255; // transparent pixels read as paper
    const luma = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    data[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return { width, height, data };
}

/** Otsu's threshold: gray levels at or below it are ink. */
export function otsu(gray: Gray): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of gray.data) histogram[value]++;
  const total = gray.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
  let sumBelow = 0;
  let countBelow = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 255; t++) {
    countBelow += histogram[t];
    if (!countBelow) continue;
    const countAbove = total - countBelow;
    if (!countAbove) break;
    sumBelow += t * histogram[t];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (sumAll - sumBelow) / countAbove;
    const between = countBelow * countAbove * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Grow a binary mask by `radius` px in every direction (a square brush), in O(pixels). */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const pass = (source: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(source.length);
    const [lines, length] = horizontal ? [height, width] : [width, height];
    const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
    for (let line = 0; line < lines; line++) {
      let count = 0;
      for (let i = 0; i < Math.min(radius, length); i++) count += source[at(line, i)];
      for (let i = 0; i < length; i++) {
        if (i + radius < length) count += source[at(line, i + radius)];
        if (i - radius - 1 >= 0) count -= source[at(line, i - radius - 1)];
        out[at(line, i)] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** 4-connected flood fill of the cells where `blocked` is 0. */
function fill(blocked: Uint8Array, width: number, height: number, seed: number): { region: Uint8Array; count: number; touchesEdge: boolean } {
  const region = new Uint8Array(blocked.length);
  const stack = [seed];
  region[seed] = 1;
  let count = 0;
  let touchesEdge = false;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
    const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
    for (const n of next) {
      if (n >= 0 && !region[n] && !blocked[n]) {
        region[n] = 1;
        stack.push(n);
      }
    }
  }
  return { region, count, touchesEdge };
}

// Directions in screen coordinates (y down), clockwise: east, south, west, north.
const DIRS: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// For a vertex (corner between pixels) and a heading, the pixel ahead on the left and on the right,
// as offsets from the vertex to the pixel's top-left corner.
const AHEAD: { left: Pt; right: Pt }[] = [
  { left: [0, -1], right: [0, 0] }, // east
  { left: [0, 0], right: [-1, 0] }, // south
  { left: [-1, 0], right: [-1, -1] }, // west
  { left: [-1, -1], right: [0, -1] }, // north
];

/** The outer boundary of a region, along pixel edges, as the corners where it turns. */
function boundary(region: Uint8Array, width: number, height: number): Pt[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && region[y * width + x] === 1;
  const first = region.indexOf(1);
  const startX = first % width;
  const startY = (first - startX) / width;
  let [x, y, dir] = [startX, startY, 0];
  const corners: Pt[] = [];
  const limit = 4 * (width + 1) * (height + 1);
  for (let steps = 0; steps < limit; steps++) {
    const { left, right } = AHEAD[dir];
    let next = dir;
    if (inside(x + left[0], y + left[1])) next = (dir + 3) % 4;
    else if (!inside(x + right[0], y + right[1])) next = (dir + 1) % 4;
    if (next !== dir || steps === 0) corners.push([x, y]);
    dir = next;
    x += DIRS[dir][0];
    y += DIRS[dir][1];
    if (x === startX && y === startY && dir === 3) break; // back at the start, arriving from below
  }
  return corners;
}

/** Douglas–Peucker on a closed polygon, split at its two most distant corners. */
export function simplifyPolygon(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 4) return points;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farDistance) [far, farDistance] = [i, d];
  }
  const open = (line: Pt[]): Pt[] => {
    if (line.length < 3) return line;
    const [a, b] = [line[0], line[line.length - 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let index = 0;
    let max = 0;
    for (let i = 1; i < line.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - line[i][1]) - (a[0] - line[i][0]) * (b[1] - a[1])) / length;
      if (d > max) [index, max] = [i, d];
    }
    if (max <= epsilon) return [a, b];
    return [...open(line.slice(0, index + 1)).slice(0, -1), ...open(line.slice(index))];
  };
  const firstHalf = open(points.slice(0, far + 1));
  const secondHalf = open([...points.slice(far), points[0]]);
  return [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
}

/** The room around `seed` (image px), as an outline in image px along the inner wall faces. */
export function traceRoom(gray: Gray, seed: Pt, { gap = 3, epsilon = 1.5 }: { gap?: number; epsilon?: number } = {}): TraceResult {
  const { width, height, data } = gray;
  const sx = Math.floor(seed[0]);
  const sy = Math.floor(seed[1]);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return { ok: false, reason: 'leak' };
  const threshold = otsu(gray);
  const walls = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) walls[i] = data[i] <= threshold ? 1 : 0;
  const closed = dilate(walls, width, height, Math.round(gap));
  const start = sy * width + sx;
  if (closed[start]) return { ok: false, reason: 'wall' };

  const { region, count, touchesEdge } = fill(closed, width, height, start);
  if (touchesEdge || count > LEAK_FRACTION * width * height) return { ok: false, reason: 'leak' };
  if (count < MIN_REGION_PX) return { ok: false, reason: 'tiny' };

  // Grow the room back over the band the walls were grown by, but never into a real wall.
  const grown = dilate(region, width, height, Math.round(gap));
  for (let i = 0; i < grown.length; i++) if (walls[i]) grown[i] = 0;
  const refilled = fill(Uint8Array.from(grown, (v) => 1 - v), width, height, start);

  // A fill that escapes through a gap in an outer wall can flow around the whole building
  // inside a frame line without touching the image edge. Its outer boundary then encloses
  // far more than it filled: the other rooms sit inside it as holes.
  const corners = boundary(refilled.region, width, height);
  if (area(corners) > WRAP_RATIO * refilled.count) return { ok: false, reason: 'leak' };

  const outline = simplifyPolygon(corners, epsilon);
  return outline.length >= 3 ? { ok: true, outline } : { ok: false, reason: 'tiny' };
}
