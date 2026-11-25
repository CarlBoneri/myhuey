import { describe, expect, it } from 'vitest';
import type { Furniture } from '../types';
import { covers } from './rig';
import { arcOf, DEFAULT_CURVES, diagonalOf, footprintOf, isCurved, legalCurve, screenSummary, sizeFromDiagonal } from './screen';

// The Samsung Odyssey G9: 49", 32:9, 1000R. At rotation 0 its front faces +y.
const g9 = (more: Partial<Furniture> = {}): Furniture => ({
  id: 'g9', kind: 'monitor-49', label: 'G9', x: 100, y: 50, width: 119.8, depth: 10, rotation: 0, shape: 'rect',
  elevation: 75, height: 33.7, curve: 1000, ...more,
});

describe('screen sizes', () => {
  it('turns a diagonal and aspect into panel width and height', () => {
    expect(sizeFromDiagonal(49, 32, 9)).toEqual({ width: 119.8, height: 33.7 });
    expect(sizeFromDiagonal(27, 16, 9)).toEqual({ width: 59.8, height: 33.6 });
  });
  it('reads the diagonal back', () => {
    expect(diagonalOf(g9())).toBe(49);
  });
  it('curves the 49-inch by default', () => {
    expect(DEFAULT_CURVES['monitor-49']).toBe(1000);
  });
});

describe('the arc', () => {
  it('gives the chord and how far the wings reach forward', () => {
    const arc = arcOf(g9());
    expect(arc.radius).toBe(100);
    expect(arc.chord).toBeCloseTo(112.76, 1);
    expect(arc.sagitta).toBeCloseTo(17.41, 1);
    expect(arc.angle).toBeCloseTo(1.198, 3);
  });
  it('is a straight line for a flat screen', () => {
    expect(arcOf(g9({ curve: null }))).toEqual({ radius: Infinity, angle: 0, chord: 119.8, sagitta: 0 });
  });
});

describe('the footprint', () => {
  it('matches the Python footprint for a curved screen', () => {
    const box = footprintOf(g9());
    expect(box.x).toBe(100);
    expect(box.y).toBeCloseTo(58.7, 1);
    expect(box.width).toBeCloseTo(112.8, 1);
    expect(box.depth).toBeCloseTo(27.4, 1);
  });
  it('is the item itself when flat', () => {
    expect(footprintOf(g9({ curve: null }))).toEqual({ x: 100, y: 50, width: 119.8, depth: 10 });
  });
  it('lets covers() find the wing tips and not the space behind', () => {
    expect(covers(g9(), 45, 67)).toBe(true);
    expect(covers(g9(), 100, 42)).toBe(false);
    expect(covers(g9({ curve: null }), 45, 67)).toBe(false);
  });
});

describe('curved or not', () => {
  it('is flat when portrait, whatever curve is saved', () => {
    expect(isCurved(g9())).toBe(true);
    expect(isCurved(g9({ curve: null }))).toBe(false);
    expect(isCurved(g9({ width: 33.6, height: 59.8 }))).toBe(false);
  });
  it('sums a screen up for the item list', () => {
    expect(screenSummary(g9())).toBe('49" 32:9 · 1000R');
    expect(screenSummary(g9({ curve: null, width: 33.6, height: 59.8 }))).toBe('27" portrait');
    expect(screenSummary(g9({ curve: null, width: 59.8, height: 33.6 }))).toBe('27" 16:9');
  });

describe('keeping a curve legal', () => {
  it('drops the curve when a screen becomes portrait, and leaves anything else alone', () => {
    expect(legalCurve(g9({ height: 130 })).curve).toBeNull();
    expect(legalCurve(g9())).toEqual(g9());
    expect(legalCurve(g9({ curve: null, height: 130 }))).toEqual(g9({ curve: null, height: 130 }));
  });
});
});
