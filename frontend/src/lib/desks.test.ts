import { describe, expect, it } from 'vitest';
import type { Furniture, Placement, Room } from '../types';
import { moveSetBy, setOf, settle } from './desks';
import { moveRig, posedRoom } from './rig';

// The same Den as tests/test_desk_sets.py: a desk set (desk, 27" screen, chair) and a strip mounted on the screen.
const piece = (more: Partial<Furniture>): Furniture => ({
  id: 'x', kind: 'desk', label: 'x', x: 0, y: 0, width: 50, depth: 50, rotation: 0, shape: 'rect', elevation: 0, height: 75, ...more,
});
const DESK = piece({ id: 'd1', kind: 'desk', x: 200, y: 150, width: 140, depth: 70, set: 's1' });
const SCREEN = piece({ id: 'm1', kind: 'monitor-27', x: 200, y: 130, width: 61, depth: 20, elevation: 75, height: 40, set: 's1' });
const CHAIR = piece({ id: 'c1', kind: 'chair', x: 200, y: 210, set: 's1', seat: 46 });
const light = (more: Partial<Placement>): Placement => ({
  light_id: 'l', label: 'l', x: 0, y: 0, rotation: 0, length: null, product: {}, metadata: {}, role: 'auto', ...more,
});
const den = (furniture: Furniture[] = [DESK, SCREEN, CHAIR], lights: Placement[] = [light({ light_id: '3', mount: { screen: 'm1' } })]): Room => ({
  name: 'Den', x: 0, y: 0, units: 'metric', outline: [[0, 0], [400, 0], [400, 400], [0, 400]], width: 400, height: 400,
  ceiling: 250, openings: [], photo: null, furniture, lights, desk_sets: [{ id: 's1', name: 'My desk', base: 'd1' }],
});
const byId = (room: Room, id: string) => room.lights.find((l) => l.light_id === id)!;

describe('settle', () => {
  it('sits a mounted light on its screen back as a bias light in the screen set', () => {
    const strip = byId(settle(den()), '3');
    expect([strip.x, strip.y, strip.elevation, strip.resolved_elevation, strip.rotation]).toEqual([200, 120, 95, 95, 0]);
    expect([strip.role, strip.set]).toEqual(['bias', 's1']);
  });
  it('follows a turned screen', () => {
    const strip = byId(settle(den([DESK, { ...SCREEN, x: 230, rotation: 90 }, CHAIR])), '3');
    expect([strip.x, strip.y, strip.rotation]).toEqual([240, 130, 90]);
  });
  it('drops the mount of a light whose screen is gone, and leaves the light', () => {
    const strip = byId(settle(den([DESK, CHAIR], [light({ light_id: '3', x: 7, y: 8, mount: { screen: 'm1' } })])), '3');
    expect([strip.mount, strip.x, strip.y]).toEqual([null, 7, 8]);
  });
  it('dissolves a set whose base is gone', () => {
    const room = settle(den([SCREEN, CHAIR]));
    expect(room.desk_sets).toEqual([]);
    expect(room.furniture.map((f) => f.set ?? null)).toEqual([null, null]);
  });
  it('returns the same room when nothing needs settling', () => {
    const plain = { ...den([piece({ id: 'p' })], [light({ light_id: '1' })]), desk_sets: [] };
    expect(settle(plain)).toBe(plain);
  });
});

describe('moving a set', () => {
  it('turns and moves every member about its base, carrying set lights and mounted lights', () => {
    const lamp = light({ light_id: '1', x: 260, y: 160, set: 's1' });
    const room = moveSetBy(settle(den([DESK, SCREEN, CHAIR], [lamp, light({ light_id: '3', mount: { screen: 'm1' } })])), 's1', -100, 150, 90);
    const at = (id: string) => room.furniture.find((f) => f.id === id)!;
    expect([at('d1').x, at('d1').y, at('d1').rotation]).toEqual([100, 300, 90]);
    expect([at('m1').x, at('m1').y]).toEqual([120, 300]);
    expect([at('c1').x, at('c1').y]).toEqual([40, 300]);
    expect([byId(room, '1').x, byId(room, '1').y, byId(room, '1').rotation]).toEqual([90, 360, 90]);
    expect([byId(room, '3').x, byId(room, '3').y]).toEqual([130, 300]);
  });
  it('finds the set of a piece or a light', () => {
    const room = settle(den());
    expect(setOf(room, 'm1')?.id).toBe('s1');
    expect(setOf(room, '3')?.id).toBe('s1');
    expect(setOf(room, 'nope')).toBeNull();
  });
  it('moves the whole set when any member is dragged', () => {
    const room = moveRig(settle(den()), 'm1', 10, 0);
    expect(room.furniture.map((f) => f.x)).toEqual([210, 210, 210]);
    expect(byId(room, '3').x).toBe(210);
  });
  it('carries a light mounted on a screen that is not in a set (a TV on a wall)', () => {
    const tv = piece({ id: 'tv', kind: 'tv', x: 100, y: 10, width: 145, depth: 8, elevation: 100, height: 84 });
    const room = moveRig(settle({ ...den([tv], [light({ light_id: '3', mount: { screen: 'tv' } })]), desk_sets: [] }), 'tv', 50, 0);
    expect(byId(room, '3').x).toBe(150);
  });
});

describe('standing at a desk set', () => {
  it('raises a screen on an arm past the desk edge when it is in the set, and leaves the chair down', () => {
    const arm = { ...SCREEN, x: 300 }; // 30 cm past the desk's right edge
    const room = posedRoom(settle(den([DESK, arm, CHAIR])), 'standing');
    expect(room.furniture.find((f) => f.id === 'm1')!.elevation).toBe(110);
    expect(room.furniture.find((f) => f.id === 'c1')!.elevation).toBe(0);
    expect(byId(room, '3').resolved_elevation).toBe(130);
  });
  it('raises a light mounted on a screen that rises, even off the desk footprint and with no set', () => {
    const desk = { ...DESK, set: null };
    const screen = { ...SCREEN, set: null, y: 120 }; // still over the desk, so it rides
    const strip = light({ light_id: '3', mount: { screen: 'm1' } });
    const room = posedRoom(settle({ ...den([desk, screen], [strip]), desk_sets: [] }), 'standing');
    expect(byId(room, '3').resolved_elevation).toBe(130);
  });
  it('does not raise that screen when there is no set', () => {
    const loose = [{ ...DESK, set: null }, { ...SCREEN, x: 300, set: null }];
    const room = posedRoom({ ...den(loose, []), desk_sets: [] }, 'standing');
    expect(room.furniture.find((f) => f.id === 'm1')!.elevation).toBe(75);
  });
});
