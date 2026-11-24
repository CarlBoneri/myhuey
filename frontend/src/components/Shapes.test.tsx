// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '../test/dom';
import type { Furniture } from '../types';
import { FurnitureShape } from './Shapes';

const g9 = (curve: number | null): Furniture => ({
  id: 'g9', kind: 'monitor-49', label: 'G9', x: 0, y: 0, width: 119.8, depth: 10, rotation: 0, shape: 'rect', elevation: 75, height: 33.7, curve,
});
const draw = (item: Furniture) => render(<svg><FurnitureShape item={item} cmPerPx={1} /></svg>).container;

describe('FurnitureShape screens', () => {
  it('draws a curved screen as an arc band instead of a box', () => {
    const svg = draw(g9(1000));
    expect(svg.querySelector('path.furniture-screen-arc')).toBeTruthy();
    expect(svg.querySelector('rect.furniture')).toBeNull();
  });
  it('bends the band toward the front, as far as the wings reach', () => {
    // An SVG arc lists only its ends: the front wing tips sit half the chord (56.4) out and the
    // sagitta (17.4) in front of the panel middle at y = depth / 2; the back tips sit 110 cm
    // (R + depth) from the axis at y = 105.
    const d = draw(g9(1000)).querySelector('path.furniture-screen-arc')!.getAttribute('d')!;
    const tips = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(tips).toHaveLength(4);
    const [left, right, backRight, backLeft] = tips;
    expect(left[0]).toBeCloseTo(-56.38, 1);
    expect(right[0]).toBeCloseTo(56.38, 1);
    expect(left[1]).toBeCloseTo(5 + 17.41, 1);
    expect(backRight[1]).toBeCloseTo(105 - 110 * Math.cos(0.599), 1);
    expect(backLeft[0]).toBeCloseTo(-backRight[0], 2);
  });
  it('keeps the box for a flat monitor', () => {
    const svg = draw(g9(null));
    expect(svg.querySelector('rect.furniture')).toBeTruthy();
    expect(svg.querySelector('.furniture-screen-arc')).toBeNull();
  });
});
