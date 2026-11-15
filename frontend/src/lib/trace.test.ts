import { describe, expect, it } from 'vitest';
import { otsu, scaleToFit, toGray, traceRoom, type Gray } from './trace';
import type { Pt } from '../types';

/** A white image with black wall rectangles [x0, y0, x1, y1) drawn on it. */
function plan(width: number, height: number, walls: [number, number, number, number][]): Gray {
  const data = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of walls) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * width + x] = 0;
  }
  return { width, height, data };
}

/** A box room: walls 4 px thick, inside from (14, 14) to (86, 66). */
const boxWalls = (gapAt?: number): [number, number, number, number][] => [
  ...(gapAt === undefined ? [[10, 10, 90, 14] as [number, number, number, number]] : [[10, 10, gapAt, 14], [gapAt + 6, 10, 90, 14]] as [number, number, number, number][]),
  [10, 66, 90, 70], [10, 10, 14, 70], [86, 10, 90, 70],
];

const near = (outline: Pt[], target: Pt, tolerance = 2) => outline.some(([x, y]) => Math.abs(x - target[0]) <= tolerance && Math.abs(y - target[1]) <= tolerance);

describe('trace', () => {
  it('converts RGBA to gray and finds a threshold between ink and paper', () => {
    const gray = toGray(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 250, 250, 250, 255, 10, 10, 10, 255]), 2, 2);
    expect(Array.from(gray.data)).toEqual([0, 255, 250, 10]);
    const t = otsu(gray);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(250);
  });

  it('traces a box room to four corners at the inner wall face', () => {
    const result = traceRoom(plan(100, 80, boxWalls()), [50, 40]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline).toHaveLength(4);
    for (const corner of [[14, 14], [86, 14], [86, 66], [14, 66]] as Pt[]) expect(near(result.outline, corner)).toBe(true);
  });

  it('leaks through a door gap unless the gap is closed', () => {
    const image = plan(100, 80, boxWalls(40));
    expect(traceRoom(image, [50, 40], { gap: 0 })).toEqual({ ok: false, reason: 'leak' });
    const closed = traceRoom(image, [50, 40], { gap: 4 });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(near(closed.outline, [14, 14], 3) && near(closed.outline, [86, 66], 3)).toBe(true);
  });

  it('refuses a seed on a wall', () => {
    expect(traceRoom(plan(100, 80, boxWalls()), [12, 40])).toEqual({ ok: false, reason: 'wall' });
  });

  it('reports a leak when the fill covers most of the image', () => {
    // A frame line around the whole drawing: the fill never reaches the image edge.
    const framed = plan(100, 80, [[0, 0, 100, 1], [0, 79, 100, 80], [0, 0, 1, 80], [99, 0, 100, 80], [40, 30, 44, 34]]);
    expect(traceRoom(framed, [10, 10])).toEqual({ ok: false, reason: 'leak' });
  });

  it('reports a leak when a gap lets the fill wrap around the building inside a frame line', () => {
    // A frame line at the image edge, a building inside it split into two rooms, and a 12 px gap in its left wall.
    const image = plan(200, 200, [
      [0, 0, 200, 1], [0, 199, 200, 200], [0, 0, 1, 200], [199, 0, 200, 200],
      [15, 15, 185, 19], [15, 181, 185, 185], [181, 15, 185, 185], [98, 15, 102, 185],
      [15, 15, 19, 90], [15, 102, 19, 185],
    ]);
    expect(traceRoom(image, [50, 100])).toEqual({ ok: false, reason: 'leak' });
    expect(traceRoom(image, [8, 8])).toEqual({ ok: false, reason: 'leak' });
    expect(traceRoom(image, [140, 100]).ok).toBe(true); // the closed room still traces
  });

  it('traces an L-shaped room to six corners', () => {
    const L = plan(100, 100, [
      [10, 10, 90, 14], [10, 10, 14, 90], [10, 86, 50, 90], [46, 50, 50, 90], [46, 50, 90, 54], [86, 10, 90, 54],
    ]);
    const result = traceRoom(L, [30, 30]);
    expect(result.ok && result.outline.length).toBe(6);
  });

  it('scales big images down to 1600 px', () => {
    expect(scaleToFit(3200, 1000)).toBe(0.5);
    expect(scaleToFit(800, 600)).toBe(1);
  });
});
