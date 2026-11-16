import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

describe('contrast ratio', () => {
  it('follows WCAG: black on white is 21, and Neon\'s bright black is too dim for text', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastRatio('#5c6370', '#1f1f23')).toBeLessThan(3);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'));
  });
  it('refuses anything but a six-digit hex', () => {
    expect(() => contrastRatio('rgba(0,0,0,1)', '#ffffff')).toThrow();
  });
});
