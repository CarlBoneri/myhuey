import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, snap } from './units';
import { area, ellipsePoints, pointInPolygon, rectPoints, simplify } from './geometry';
import { gradientStops, harmonies, hctToHex, hexToHct, hexToOklch, normalizeHex, oklchToHex, tonalPalette } from './color';
import { effectiveLength, placedProfile } from './lights';
import type { Placement, ProfileTable } from '../types';

describe('units (mirrors myhuey/units.py)', () => {
  it('parses feet, inches, and meters to centimeters', () => {
    expect(parseLength(`12'6"`)).toBeCloseTo(381);
    expect(parseLength('12ft 6in')).toBeCloseTo(381);
    expect(parseLength('3.5m')).toBeCloseTo(350);
    expect(parseLength('10')).toBeCloseTo(304.8);
    expect(parseLength('4.2', 'metric')).toBeCloseTo(420);
    expect(parseLength('a lot')).toBeNull();
  });
  it('formats lengths', () => {
    expect(formatLength(381)).toBe(`12' 6"`);
    expect(formatLength(381, 'metric')).toBe('3.81 m');
    expect(snap(100, 'imperial')).toBeCloseTo(99.06); // 39 whole inches
  });
});

describe('geometry', () => {
  const L: [number, number][] = [[0, 0], [200, 0], [200, 100], [100, 100], [100, 200], [0, 200]];
  it('handles concave rooms', () => {
    expect(area(L)).toBe(30000);
    expect(pointInPolygon([50, 150], L)).toBe(true);
    expect(pointInPolygon([150, 150], L)).toBe(false);
  });
  it('builds zone shapes', () => {
    expect(rectPoints([10, 10], [0, 0])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(ellipsePoints(0, 0, 10, 5, 4)[0]).toEqual([10, 0]);
    expect(simplify([[0, 0], [1, 0], [5, 0], [5.5, 0]], 3)).toEqual([[0, 0], [5, 0]]);
  });
});

describe('color', () => {
  it('round-trips through OKLCH and HCT', () => {
    expect(oklchToHex(hexToOklch('#3b82f6'))).toBe('#3b82f6');
    expect(hctToHex(hexToHct('#8b5cf6'))).toBe('#8b5cf6');
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('zzz')).toBeNull();
  });
  it('clips out-of-gamut colors by chroma, keeping lightness', () => {
    const hex = oklchToHex({ l: 0.7, c: 0.37, h: 150 });
    expect(hexToOklch(hex).l).toBeCloseTo(0.7, 1);
  });
  it('makes palettes', () => {
    const tones = tonalPalette('#8b5cf6', [0, 50, 100]);
    expect(tones[0]).toBe('#000000');
    expect(tones[2]).toBe('#ffffff');
    expect(harmonies('#ff0000').find((h) => h.name === 'Triadic')!.colors).toHaveLength(3);
    expect(gradientStops(['#ff0000', '#0000ff'], 5)).toHaveLength(5);
  });
});

describe('light profiles', () => {
  const table: ProfileTable = {
    default: { kind: 'round', length: 15, width: 15, icon: 'bulb-classic', gradient: false, adjustable: false, linear: false, label: 'Light' },
    archetype: { huelightstrip: { kind: 'strip', length: 200, width: 1.6, icon: 'lightstrip', gradient: false, adjustable: true, linear: true, label: 'Lightstrip' } },
    product: {},
    model: {},
  };
  const placement: Placement = { light_id: '1', label: 'Strip', x: 0, y: 0, rotation: 0, length: 300, product: { archetype: 'huelightstrip' }, metadata: {} };
  it('falls back to the saved product when the bridge is away', () => {
    const profile = placedProfile(placement, undefined, table);
    expect(profile.kind).toBe('strip');
    expect(effectiveLength(placement, profile)).toBe(300);
    expect(effectiveLength({ ...placement, length: null }, profile)).toBe(200);
  });
});

describe('grouping lights by room', () => {
  it('lists a light under every room it is placed in, in room order', async () => {
    const { groupLightsByRoom } = await import('./lights');
    const placed = (id: string) => ({ light_id: id }) as Placement;
    const rooms = [
      { name: 'Office', lights: [placed('37'), placed('26')] },
      { name: 'Demo studio', lights: [placed('37')] },
    ];
    const groups = groupLightsByRoom(['26', '37', '99'], rooms);
    expect(groups).toEqual([
      ['Office', ['37', '26']],
      ['Demo studio', ['37']],
      ['Not placed', ['99']],
    ]);
  });
});

describe('rendering a gradient in its mode', () => {
  it('draws hard bands for segmented_palette', async () => {
    const { renderStops } = await import('./color');
    expect(renderStops(['#ff0000', '#0000ff'], 'segmented_palette', 4)).toEqual(['#ff0000', '#ff0000', '#0000ff', '#0000ff']);
  });
  it('mirrors around the middle for interpolated_palette_mirrored', async () => {
    const { renderStops } = await import('./color');
    const stops = renderStops(['#ff0000', '#0000ff'], 'interpolated_palette_mirrored', 7);
    expect(stops).toEqual([...stops].reverse());
    expect(stops[0]).toBe('#ff0000');
    expect(stops[3]).toBe('#0000ff');
  });
  it('blends end to end by default and handles one or no colors', async () => {
    const { renderStops } = await import('./color');
    const blend = renderStops(['#ff0000', '#0000ff'], 'interpolated_palette', 5);
    expect(blend[0]).toBe('#ff0000');
    expect(blend[4]).toBe('#0000ff');
    expect(renderStops(['#00ff00'], 'segmented_palette', 3)).toEqual(['#00ff00', '#00ff00', '#00ff00']);
    expect(renderStops([], 'interpolated_palette', 3)).toEqual([]);
  });
  it('scatters only the given colors, the same way every time, for random_pixelated', async () => {
    const { renderStops } = await import('./color');
    const a = renderStops(['#ff0000', '#0000ff'], 'random_pixelated', 12);
    expect(new Set(a)).toEqual(new Set(['#ff0000', '#0000ff']));
    expect(renderStops(['#ff0000', '#0000ff'], 'random_pixelated', 12)).toEqual(a);
  });
});

describe('ordering writes to a gradient light', () => {
  const base = { colors: ['#ff0000', '#0000ff'], mode: 'interpolated_palette', effect: 'no_effect' };
  it('sends only the effect when one starts (it replaces the colors anyway)', async () => {
    const { lightWrites } = await import('./lights');
    expect(lightWrites(base, { ...base, effect: 'fire' })).toEqual([{ type: 'effect', effect: 'fire' }]);
  });
  it('restores the colors by sending the gradient when the effect stops', async () => {
    const { lightWrites } = await import('./lights');
    expect(lightWrites({ ...base, effect: 'fire' }, base)).toEqual([{ type: 'gradient', colors: base.colors, mode: base.mode }]);
  });
  it('sends the gradient when colors or mode change, and nothing when nothing did', async () => {
    const { lightWrites } = await import('./lights');
    expect(lightWrites(base, { ...base, mode: 'segmented_palette' })).toEqual([{ type: 'gradient', colors: base.colors, mode: 'segmented_palette' }]);
    expect(lightWrites(base, { ...base })).toEqual([]);
  });
  it('lets a running effect win over color edits made while it runs', async () => {
    const { lightWrites } = await import('./lights');
    expect(lightWrites({ ...base, effect: 'fire' }, { ...base, colors: ['#00ff00', '#0000ff'], effect: 'fire' })).toEqual([]);
  });
});

describe('the light write queue', () => {
  it('does not lose a change made while an earlier write is still in flight', async () => {
    const { createLightWriter } = await import('./lights');
    const writes: unknown[] = [];
    const gates: (() => void)[] = [];
    const send = (write: unknown) => new Promise<void>((resolve) => { writes.push(write); gates.push(resolve); });
    const base = { colors: ['#ff0000', '#0000ff'], mode: 'interpolated_palette', effect: 'no_effect' };
    const writer = createLightWriter(send, base);

    const first = writer.push({ ...base, effect: 'candle' });   // starts sending candle
    const second = writer.push({ ...base, effect: 'no_effect' }); // user picks None mid-flight
    await Promise.resolve();
    gates.shift()!();                                             // candle lands
    await new Promise((r) => setTimeout(r, 0));
    gates.shift()?.();                                            // the follow-up write lands
    await Promise.all([first, second]);

    expect(writes).toEqual([{ type: 'effect', effect: 'candle' }, { type: 'gradient', colors: base.colors, mode: base.mode }]);
  });

  it('treats a resync from the bridge as already sent', async () => {
    const { createLightWriter } = await import('./lights');
    const writes: unknown[] = [];
    const base = { colors: ['#ff0000', '#0000ff'], mode: 'interpolated_palette', effect: 'no_effect' };
    const writer = createLightWriter(async (w) => { writes.push(w); }, base);
    writer.reset({ ...base, colors: ['#00ff00', '#00ff00'] }); // another app changed the light
    await writer.push(base);                                    // user edits back to the old colors
    expect(writes).toEqual([{ type: 'gradient', colors: base.colors, mode: base.mode }]);
  });
});
