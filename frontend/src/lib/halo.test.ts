import { describe, expect, it } from 'vitest';
import type { Furniture, Room } from '../types';
import { HALO_REACH_CM, haloOf, loopOf } from './halo';

const room: Pick<Room, 'outline' | 'ceiling'> = { outline: [[0, 0], [400, 0], [400, 400], [0, 400]], ceiling: 250 };
const screen = (more: Partial<Furniture> = {}): Furniture => ({
  id: 's', kind: 'tv', label: 'TV', x: 200, y: 30, width: 60, depth: 10, rotation: 0, shape: 'rect', elevation: 80, height: 40, ...more,
});
const length = (points: number[][]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]), 0);

describe('haloOf', () => {
  it('lays the screen, grown by its spread, on the wall behind it', () => {
    // The back face is 25 cm off the wall: spread 10 + 0.9 * 25 = 32.5 on every side.
    const halo = haloOf(room, screen())!;
    expect(halo.gap).toBeCloseTo(25);
    expect(halo.opacity).toBeCloseTo(0.55 * (1 - 25 / HALO_REACH_CM));
    const xs = halo.corners.map((c) => c[0]);
    const zs = halo.corners.map((c) => c[2]);
    expect(halo.corners.every((c) => c[1] === 0)).toBe(true);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([137.5, 262.5]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([47.5, 152.5]);
  });
  it('finds the wall a turned screen backs onto', () => {
    // Turned 90°, the front faces -x, so the back looks at the x = 400 wall.
    const halo = haloOf(room, screen({ x: 370, y: 200, rotation: 90 }))!;
    expect(halo.gap).toBeCloseTo(25);
    expect(halo.corners.every((c) => c[0] === 400)).toBe(true);
  });
  it('shows nothing when no wall is near behind the screen', () => {
    expect(haloOf(room, screen({ y: 230 }))).toBeNull();
  });
  it('stops at the floor and the ceiling', () => {
    const low = haloOf(room, screen({ elevation: 0 }))!;
    expect(Math.min(...low.corners.map((c) => c[2]))).toBe(0);
    const high = haloOf(room, screen({ elevation: 220 }))!;
    expect(Math.max(...high.corners.map((c) => c[2]))).toBe(250);
  });
});

describe('loopOf', () => {
  it('runs all the way round the back, 6 cm in from the edges, when the strip is long enough', () => {
    const loop = loopOf(screen(), 200);
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(length(loop)).toBeCloseTo(2 * (48 + 28));
    expect(loop.every((p) => p[1] < 25)).toBe(true); // just behind the back face
  });
  it('makes a U open at the bottom when the strip is shorter, using its length', () => {
    const loop = loopOf(screen(), 80);
    expect(length(loop)).toBeCloseTo(80);
    const zs = loop.map((p) => p[2]);
    expect(Math.max(...zs)).toBeCloseTo(100 + 14); // the top run
    expect(loop[0][2]).toBeCloseTo(loop[loop.length - 1][2]); // both ends at the same height
  });
});
