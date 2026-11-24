import { describe, expect, it } from 'vitest';
import type { Furniture, Room } from '../types';
import { roomGlare } from './roomGlare';

const screen: Furniture = { id: 'm', kind: 'monitor-27', label: '27', x: 200, y: 100, width: 60, depth: 2, rotation: 0, shape: 'rect', elevation: 75, height: 40 };
const room: Room = { name: 'R', x: 0, y: 0, units: 'metric', outline: [[0, 0], [400, 0], [400, 400], [0, 400]], width: 400, height: 400,
  lights: [], furniture: [screen], photo: null, ceiling: 244, openings: [] };

describe('roomGlare', () => {
  it('traces from your own eye height', () => {
    expect(roomGlare(room, 'seated', 'code', {}, null).scene.eye![2]).toBe(115);
    expect(roomGlare(room, 'seated', 'code', {}, null, { eye_sitting: 80, eye_standing: 170, screen_distance: 70 }).scene.eye).toEqual([200, 170, 126]);
  });
});
