import { describe, expect, it } from 'vitest';
import type { Furniture, Pt } from '../types';
import {
  axes, clipNear, facesCamera, fitOrbit, footprint, lightPool, orbitCamera, prism, project, projectPolygon, seatCamera,
  unprojectToHeight, wallFacing, wallOpacity, walls, winding, zoomAt, type Vec3,
} from './view3d';

const viewport = { width: 800, height: 600 };
const square: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
const room = { outline: square, ceiling: 240, openings: [] };
const near = (a: number[], b: number[]) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 6));

describe('the camera', () => {
  it('looks straight down like the plan at pitch 90: x right, y down', () => {
    const camera = orbitCamera({ target: [200, 150, 0], yaw: 0, pitch: 90, distance: 1000, zoom: 1 }, 1);
    near(axes(camera).forward, [0, 0, -1]);
    near(axes(camera).right, [1, 0, 0]);
    const center = project([200, 150, 0], camera, viewport);
    const right = project([300, 150, 0], camera, viewport);
    const down = project([200, 250, 0], camera, viewport);
    near([center.x, center.y, center.scale], [400, 300, 1]);
    near([right.x - center.x, right.y - center.y], [100, 0]);
    near([down.x - center.x, down.y - center.y], [0, 100]);
  });
  it('draws nearer things larger', () => {
    const camera = orbitCamera({ target: [200, 150, 0], yaw: 0, pitch: 30, distance: 1000, zoom: 1 }, 1);
    expect(project([200, 300, 0], camera, viewport).scale).toBeGreaterThan(project([200, 0, 0], camera, viewport).scale);
    expect(project([200, 150, 200], camera, viewport).y).toBeLessThan(project([200, 150, 0], camera, viewport).y); // up is up
  });
  it('zoom scales the picture without changing the perspective', () => {
    const at = (zoom: number) => project([300, 150, 0], orbitCamera({ target: [200, 150, 0], yaw: 20, pitch: 40, distance: 900, zoom }, 1), viewport);
    expect((at(2).x - 400) / (at(1).x - 400)).toBeCloseTo(2, 6);
  });
  it('puts the seat camera at the eye, looking at the screen', () => {
    const camera = seatCamera([200, 160, 115], [200, 100, 95], { yaw: 0, pitch: 0 }, 1, viewport);
    const p = project([200, 100, 95], camera, viewport);
    near([p.x, p.y], [400, 300]);
    expect(project([230, 100, 95], camera, viewport).x).toBeGreaterThan(400); // +x is to the right when facing -y
  });
});

describe('from the screen back into the room', () => {
  it('finds the floor point under the cursor, at any angle, zoom, and pan', () => {
    const camera = orbitCamera({ target: [200, 150, 96], yaw: -30, pitch: 34, distance: 900, zoom: 1.7 }, 0.9);
    const pan: Pt = [40, -25];
    for (const point of [[120, 80, 0], [333, 250, 75], [10, 290, 180]] as Vec3[]) {
      const screen = project(point, camera, viewport, pan);
      near(unprojectToHeight([screen.x, screen.y], point[2], camera, viewport, pan)!, [point[0], point[1]]);
    }
  });
  it('gives up when the ray never reaches that height', () => {
    const level = seatCamera([200, 160, 115], [200, 100, 115], { yaw: 0, pitch: 0 }, 1, viewport);
    expect(unprojectToHeight([400, 100], 0, level, viewport)).toBeNull(); // looking above the horizon: no floor there
  });
  it('keeps the point under the cursor fixed while zooming, and stays in range', () => {
    const camera = (zoom: number) => orbitCamera({ target: [200, 150, 96], yaw: -30, pitch: 34, distance: 900, zoom }, 0.9);
    const before = project([120, 80, 0], camera(1), viewport, [10, 5]);
    const { zoom, pan } = zoomAt(1, [10, 5], 1.5, [before.x, before.y], viewport);
    const after = project([120, 80, 0], camera(zoom), viewport, pan);
    near([after.x, after.y], [before.x, before.y]);
    expect(zoomAt(3, [0, 0], 4, [0, 0], viewport).zoom).toBe(3.5);
    expect(zoomAt(1, [0, 0], 0.01, [0, 0], viewport).zoom).toBe(0.45);
  });
  it('cuts polygons at the near plane instead of drawing what is behind the camera', () => {
    expect(clipNear([[0, 0, -50], [10, 0, -50], [10, 10, -20]])).toEqual([]);
    const cut = clipNear([[0, 0, 100], [100, 0, 100], [100, 0, -100], [0, 0, -100]]);
    expect(cut).toHaveLength(4);
    expect(Math.min(...cut.map((p) => p[2]))).toBe(8);
    const behind = seatCamera([200, 160, 115], [200, 100, 95], { yaw: 0, pitch: 0 }, 1, viewport);
    expect(projectPolygon([[0, 300, 0], [400, 300, 0], [400, 300, 240], [0, 300, 240]], behind, viewport)).toEqual([]);
  });
  it('fits the whole room in view', () => {
    const { orbit, base } = fitOrbit(room, viewport);
    const camera = orbitCamera(orbit, base);
    for (const [x, y] of square) for (const z of [0, 240]) {
      const p = project([x, y, z], camera, viewport);
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(800);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(600);
    }
  });
});

describe('walls', () => {
  it('point their normals into the room whichever way the outline was drawn', () => {
    expect(winding(square)).toBe(1);
    near(walls(room)[0].inward, [0, 1]);
    const reversed = [...square].reverse();
    expect(winding(reversed)).toBe(-1);
    for (const wall of walls({ ...room, outline: reversed })) {
      const mid: Pt = [(wall.a[0] + wall.b[0]) / 2 + wall.inward[0], (wall.a[1] + wall.b[1]) / 2 + wall.inward[1]];
      expect(mid[0] > 0 && mid[0] < 400 && mid[1] > 0 && mid[1] < 300).toBe(true);
    }
  });
  it('know which side the camera is on', () => {
    const [north, , south] = walls(room);
    const eye: Vec3 = [200, 900, 300]; // outside, past the south wall
    expect(wallFacing(north, eye)).toBeGreaterThan(0.9);
    expect(wallFacing(south, eye)).toBeLessThan(-0.9);
  });
  it('are more solid behind the room than in front of it', () => {
    expect(wallOpacity(1)).toBeGreaterThan(wallOpacity(-1));
    for (const facing of [-1, -0.5, 0, 0.5, 1]) {
      expect(wallOpacity(facing)).toBeGreaterThanOrEqual(0);
      expect(wallOpacity(facing)).toBeLessThanOrEqual(1);
    }
  });
  it('place a window between its sill and top, and a door from the floor', () => {
    const openings = [
      { id: 'w', kind: 'window' as const, edge: 0, offset: 100, width: 90, sill: 90, top: 210 },
      { id: 'd', kind: 'door' as const, edge: 1, offset: 50, width: 81, sill: null, top: 203 },
    ];
    const [north, east] = walls({ ...room, openings });
    expect(north.openings[0].quad).toEqual([[100, 0, 90], [190, 0, 90], [190, 0, 210], [100, 0, 210]]);
    expect(east.openings[0].quad).toEqual([[400, 50, 0], [400, 131, 0], [400, 131, 203], [400, 50, 203]]);
  });
});

describe('furniture', () => {
  const desk: Furniture = { id: 'd', kind: 'desk', label: '', x: 200, y: 150, width: 140, depth: 70, rotation: 90, shape: 'rect', elevation: 0, height: 75 };
  it('turns the footprint with the piece', () => {
    expect(footprint(desk).map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([[235, 80], [235, 220], [165, 220], [165, 80]]);
    expect(footprint({ ...desk, shape: 'ellipse' })).toHaveLength(20);
  });
  it('shows only the faces turned toward the camera', () => {
    const faces = prism({ ...desk, rotation: 0 });
    expect(faces).toHaveLength(6);
    const visible = faces.filter((face) => facesCamera(face, [200, 900, 400]));
    expect(visible.map((face) => face.normal)).toEqual([[0, 0, 1], [0, 1, 0]]); // the top and the side facing +y
  });
  it('spreads and fades a light pool with height', () => {
    expect(lightPool(240, 100).radius).toBeGreaterThan(lightPool(40, 100).radius);
    expect(lightPool(240, 100).opacity).toBeLessThan(lightPool(40, 100).opacity);
    expect(lightPool(100, 10).opacity).toBeLessThan(lightPool(100, 90).opacity);
  });
});
