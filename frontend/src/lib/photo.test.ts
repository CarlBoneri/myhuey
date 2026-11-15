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
