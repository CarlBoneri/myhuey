import { describe, expect, it } from 'vitest';
import { DEFAULT_WHITE, clampKelvin, withColors, withWhite } from './overrides';

describe('override helpers', () => {
  it('choosing white drops colors and the gradient mode, keeping the rest', () => {
    const next = withWhite({ colors: ['#ff0000', '#00ff00'], mode: 'interpolated_palette', brightness: 40, on: true }, 3000);
    expect(next).toEqual({ white: 3000, brightness: 40, on: true });
    expect('colors' in next || 'mode' in next).toBe(false);
  });

  it('editing colors drops white, keeping the rest', () => {
    const next = withColors({ white: 2700, brightness: 30, effect: 'candle' }, ['#ffaa00']);
    expect(next).toEqual({ colors: ['#ffaa00'], brightness: 30, effect: 'candle' });
    expect('white' in next).toBe(false);
  });

  it('editing colors can set the gradient mode too', () => {
    expect(withColors({ white: 2700 }, ['#ff0000', '#0000ff'], 'segmented_palette')).toEqual({ colors: ['#ff0000', '#0000ff'], mode: 'segmented_palette' });
  });

  it('keeps kelvin to the range scenes accept, in 100 K steps', () => {
    expect(clampKelvin(1500)).toBe(2000);
    expect(clampKelvin(9000)).toBe(6500);
    expect(clampKelvin(4049)).toBe(4000);
    expect(clampKelvin(null)).toBe(DEFAULT_WHITE);
  });
});
