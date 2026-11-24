import { describe, expect, it } from 'vitest';
import { darkness, glowLayout, heightPreset, parseTag, tagKey } from './photo';
import type { Furniture, Placement, Room } from '../types';

const desk = (extra: Partial<Furniture> = {}): Furniture => ({
  id: 'd', kind: 'desk', label: 'Desk', x: 200, y: 150, width: 140, depth: 70, rotation: 0, shape: 'rect', elevation: 0, height: 75, ...extra,
});
const light = (x: number, y: number): Placement => ({
  light_id: '1', label: 'L', x, y, rotation: 0, length: null, product: {}, metadata: {},
});
const room = (furniture: Furniture[] = [desk()]): Room => ({
  name: 'R', x: 0, y: 0, units: 'metric', outline: [[0, 0], [400, 0], [400, 300], [0, 300]], width: 400, height: 300,
  lights: [], furniture, photo: null, ceiling: 250, openings: [],
});

describe('photo tags', () => {
  it('builds and reads tag keys', () => {
    expect(tagKey('furniture', 'ab')).toBe('furniture:ab');
    expect(parseTag('light:26')).toEqual({ kind: 'light', id: '26' });
    expect(parseTag('nonsense')).toBeNull();
  });
});

describe('height presets', () => {
  it('floor, ceiling, and auto', () => {
    expect(heightPreset('floor', room(), light(0, 0))).toBe(0);
    expect(heightPreset('ceiling', room(), light(0, 0))).toBe(250);
    expect(heightPreset('auto', room(), light(0, 0))).toBeNull();
  });
  it('desk top uses the desk under the light, else the nearest desk', () => {
    const tall = desk({ id: 't', kind: 'desk-standing', x: 50, y: 50, height: 110 });
    expect(heightPreset('desk', room([desk(), tall]), light(200, 150))).toBe(75);
    expect(heightPreset('desk', room([desk(), tall]), light(60, 60))).toBe(110);
    expect(heightPreset('desk', room([desk(), tall]), light(390, 290))).toBe(75);
    expect(heightPreset('desk', room([]), light(0, 0))).toBeNull();
  });
  it('eye level is standing height when the room has a standing desk', () => {
    expect(heightPreset('eye', room(), light(0, 0))).toBe(115);
    expect(heightPreset('eye', room([desk({ kind: 'desk-standing' })]), light(0, 0))).toBe(155);
    // Your own numbers, and the chair marked as your seat.
    const body = { eye_sitting: 80, eye_standing: 170, screen_distance: 60 };
    expect(heightPreset('eye', room(), light(0, 0), body)).toBe(126);
    expect(heightPreset('eye', room([desk({ kind: 'desk-standing' })]), light(0, 0), body)).toBe(170);
    expect(heightPreset('eye', room([desk(), desk({ id: 'c', kind: 'chair', seat: 50 })]), light(0, 0))).toBe(119);
  });
});

describe('glow on the photo', () => {
  const size = { width: 1000, height: 500 };
  const spot = { x: 0.5, y: 0.5, rotation: 0, scale: 1 };

  it('puts a blob at each lit tagged light, bigger and stronger when brighter', () => {
    const dim = glowLayout([{ light_id: '1', on: true, color: '#ff8800', brightness: 20, gradient: null }], { 'light:1': spot }, size);
    const bright = glowLayout([{ light_id: '1', on: true, color: '#ff8800', brightness: 100, gradient: null }], { 'light:1': spot }, size);
    expect(dim).toHaveLength(1);
    expect(dim[0]).toMatchObject({ cx: 500, cy: 250, color: '#ff8800' });
    expect(bright[0].r).toBeGreaterThan(dim[0].r);
    expect(bright[0].opacity).toBeGreaterThan(dim[0].opacity);
  });

  it('skips lights that are off or not tagged', () => {
    expect(glowLayout([{ light_id: '1', on: false, color: null, brightness: 0, gradient: null }], { 'light:1': spot }, size)).toEqual([]);
    expect(glowLayout([{ light_id: '2', on: true, color: '#fff', brightness: 50, gradient: null }], { 'light:1': spot }, size)).toEqual([]);
  });

  it('spreads gradient colors along the marker rotation', () => {
    const blobs = glowLayout([{ light_id: '1', on: true, color: '#f00', brightness: 80, gradient: ['#f00', '#0f0', '#00f'] }],
      { 'light:1': { ...spot, rotation: 90 } }, size);
    expect(blobs.map((b) => b.color)).toEqual(['#f00', '#0f0', '#00f']);
    expect(blobs[0].cx).toBeCloseTo(500);
    expect(blobs[0].cy).toBeLessThan(blobs[2].cy);
  });

  it('darkens the photo more for dimmer scenes', () => {
    const lights = (b: number) => [{ light_id: '1', on: true, color: '#fff', brightness: b, gradient: null }];
    expect(darkness(lights(100))).toBe(0);
    expect(darkness(lights(20))).toBeGreaterThan(darkness(lights(60)));
    expect(darkness([])).toBeCloseTo(0.55);
  });
});

import { nudge, resolvableTags } from './photo';

describe('safe photo saves and keyboard moves', () => {
  it('keeps only tags that name something in the room', () => {
    const r = { ...room([desk()]), lights: [light(0, 0)], openings: [] };
    const tags = { 'light:1': { x: 0.1, y: 0.1 }, 'light:9': { x: 0.2, y: 0.2 }, 'furniture:d': { x: 0.3, y: 0.3 }, 'furniture:x': { x: 0.4, y: 0.4 }, bogus: { x: 0, y: 0 } };
    expect(Object.keys(resolvableTags(tags, r)).sort()).toEqual(['furniture:d', 'light:1']);
  });

  it('nudges with the arrow keys, further with shift, inside the photo', () => {
    const spot = { x: 0.5, y: 0.5, rotation: 0, scale: 1 };
    expect(nudge(spot, 'ArrowLeft', false)).toMatchObject({ x: 0.49, y: 0.5 });
    expect(nudge(spot, 'ArrowDown', true)).toMatchObject({ x: 0.5, y: 0.55 });
    expect(nudge({ ...spot, x: 0.995 }, 'ArrowRight', true)).toMatchObject({ x: 1 });
    expect(nudge(spot, 'Enter', false)).toBeNull();
  });
});

import { roomCenter } from './photo';
import { pointInPolygon } from './geometry';

describe('room center', () => {
  it('is inside even an L-shaped room', () => {
    const L: [number, number][] = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
    expect(pointInPolygon(roomCenter(L), L)).toBe(true);
  });
  it('is the middle of a rectangle', () => {
    expect(roomCenter([[0, 0], [400, 0], [400, 300], [0, 300]])).toEqual([200, 150]);
  });
});
