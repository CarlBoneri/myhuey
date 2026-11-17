import { describe, expect, it } from 'vitest';
import { DIRECT_CAP, PERIPHERAL_CAP, REFLECTION_CAP, type GlareLight, type GlareReport, type GlareStatus } from './glareMath';
import { glareLimits, glareModeFor, overLimit } from './glareLimits';

const cap: Record<GlareStatus, GlareLight['cap']> = {
  screen_reflection: REFLECTION_CAP,
  direct_fov: { brightness: DIRECT_CAP, kelvin: null },
  peripheral_warn: { brightness: PERIPHERAL_CAP, kelvin: null },
  bias_ok: null,
  clear: null,
};
const report = (...statuses: GlareStatus[]): GlareReport => ({
  hazards: 0,
  lights: statuses.map((status, i) => ({ light_id: `l${i}`, label: `l${i}`, status, angle: null, cap: cap[status], hazards: [] })),
});

describe('glareModeFor', () => {
  it('names the desk presets and nothing else', () => {
    expect(glareModeFor('code')).toBe('code');
    expect(glareModeFor('work')).toBe('work');
    expect(glareModeFor('study')).toBe('study');
    expect(glareModeFor('read')).toBeNull();
    expect(glareModeFor('relax')).toBeNull();
  });
});

describe('glareLimits', () => {
  it('maps each status to the server reason and takes values from the report', () => {
    const out = glareLimits(report('screen_reflection', 'direct_fov', 'peripheral_warn', 'bias_ok', 'clear'), true);
    expect(out).toEqual({
      checked: true,
      caps: {
        l0: { brightness: REFLECTION_CAP.brightness, kelvin: REFLECTION_CAP.kelvin, reason: 'reflection' },
        l1: { brightness: DIRECT_CAP, kelvin: null, reason: 'direct' },
        l2: { brightness: PERIPHERAL_CAP, kelvin: null, reason: 'peripheral' },
      },
    });
  });
  it('is not checked without a desk', () => {
    expect(glareLimits(report('clear'), false)).toEqual({ checked: false, caps: {} });
  });
});

describe('overLimit', () => {
  it('counts only lit lights above their cap', () => {
    const r = report('direct_fov', 'direct_fov', 'direct_fov', 'clear');
    const shown = {
      l0: { on: true, brightness: DIRECT_CAP + 1 },
      l1: { on: false, brightness: 100 },
      l2: { on: true, brightness: DIRECT_CAP },
      l3: { on: true, brightness: 100 },
    };
    expect(overLimit(r, shown)).toEqual(['l0']);
  });
});
