import { describe, expect, it } from 'vitest';
import { calibrate, imageToPlan, lightsOutside, openingAt, openingSegment, planToImage, reanchorOpenings, snapPoint } from './plan';
import type { HomePlan, Opening, Placement, Pt } from '../types';

const plan: HomePlan = { file: 'x.png', cm_per_px: 2, offset: [100, 50], rotation: 90, opacity: 0.5, width: 800, height: 600, room_opacity: 0.4 };
const SQUARE: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];

describe('plan transforms', () => {
  it('maps image pixels onto the home and back', () => {
    const [x, y] = imageToPlan([10, 0], plan);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(70); // 10 px * 2 cm turned 90° clockwise points down
    const back = planToImage([x, y], plan);
    expect(back[0]).toBeCloseTo(10);
    expect(back[1]).toBeCloseTo(0);
  });

  it('calibrates from a line over a printed dimension', () => {
    expect(calibrate([0, 0], [300, 400], 1000)).toBe(2);
    expect(calibrate([0, 0], [2, 2], 100)).toBeNull(); // too short to measure
    expect(calibrate([0, 0], [100, 0], 0)).toBeNull();
    expect(calibrate([0, 0], [100, 0], Number.NaN)).toBeNull();
    expect(calibrate([0, 0], [10, 0], 5000)).toBeNull(); // 500 cm per px is a typo
  });
});

describe('drawing snaps', () => {
  const options = { units: 'metric' as const, radius: 10, corners: [[100, 100]] as Pt[], edges: [[[0, 200], [400, 200]]] as [Pt, Pt][] };
  it('prefers a nearby corner over an edge', () => {
    expect(snapPoint([104, 103], options)).toEqual([100, 100]);
    expect(snapPoint([95, 195], { ...options, corners: [[100, 196]] })).toEqual([100, 196]);
  });
  it('slides onto a nearby edge, else snaps to the grid', () => {
    expect(snapPoint([250.4, 206], options)).toEqual([250.4, 200]);
    expect(snapPoint([250.4, 150.6], options)).toEqual([250, 151]);
  });
});

describe('openings', () => {
  const door: Opening = { id: 'd', kind: 'door', edge: 1, offset: 50, width: 80, sill: null, top: 203 };
  it('finds the wall segment an opening covers', () => {
    expect(openingSegment(SQUARE, door)).toEqual([[400, 50], [400, 130]]);
  });
  it('has no segment for an edge the outline no longer has', () => {
    expect(openingSegment(SQUARE.slice(0, 3), { ...door, edge: 3 })).toBeNull();
  });
  it('keeps openings on their wall when corners are removed, added, or renumbered', () => {
    const onBottom: Opening = { ...door, edge: 2, offset: 100, width: 81 };
    // A corner inserted on the top edge shifts the bottom wall from edge 2 to edge 3.
    const inserted: Pt[] = [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]];
    expect(reanchorOpenings(SQUARE, inserted, [onBottom])).toEqual([{ ...onBottom, edge: 3 }]);
    // Removing the bottom-right corner removes the bottom wall: the door goes.
    expect(reanchorOpenings(SQUARE, [[0, 0], [400, 0], [0, 300]], [onBottom])).toEqual([]);
  });
  it('places an opening centered on a click near a wall, inside the wall', () => {
    expect(openingAt(SQUARE, [200, 6], 90, 20)).toEqual({ edge: 0, offset: 155, width: 90 });
    expect(openingAt(SQUARE, [395, 290], 90, 20)).toEqual({ edge: 1, offset: 210, width: 90 });
    expect(openingAt(SQUARE, [200, 150], 90, 20)).toBeNull();
    expect(openingAt([[0, 0], [50, 0], [50, 300]], [25, 2], 90, 20)).toEqual({ edge: 0, offset: 0, width: 50 });
  });
});

it('lists lights left outside a new outline', () => {
  const lights = [{ light_id: '1', x: 50, y: 50 }, { light_id: '2', x: 350, y: 50 }] as Placement[];
  expect(lightsOutside(lights, [[0, 0], [200, 0], [200, 300], [0, 300]]).map((l) => l.light_id)).toEqual(['2']);
});

import { snapCorner } from './plan';

describe('snapping a corner while reshaping on the plan', () => {
  const neighbors: [[number, number], [number, number]] = [[0, 0], [300, 200]];
  const base = { units: 'metric' as const, radius: 12, corners: [] as [number, number][], edges: [] as [[number, number], [number, number]][] };

  it("lands on another room's corner first", () => {
    expect(snapCorner([403, 197], neighbors, { ...base, corners: [[400, 200]] }, false)).toEqual([400, 200]);
  });

  it("lands on another room's wall when no corner is close", () => {
    const p = snapCorner([405, 120], neighbors, { ...base, edges: [[[400, 0], [400, 300]]] }, false);
    expect(p[0]).toBeCloseTo(400);
  });

  it('squares up against its neighbors otherwise, unless Alt is held', () => {
    expect(snapCorner([297, 103], neighbors, base, false)[0]).toBe(300);
    expect(snapCorner([297, 103], neighbors, base, true)[0]).not.toBe(300);
  });
});
