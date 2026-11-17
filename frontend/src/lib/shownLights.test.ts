import { describe, expect, it } from 'vitest';
import type { BridgeLight, SceneResult } from '../types';
import type { GlareReport } from './glareMath';
import { overLimit } from './glareLimits';
import { fixGlareState, glareBadge, shownLevels, shownLights } from './shownLights';

const live = (id: string, extra: Partial<BridgeLight> = {}): BridgeLight => ({
  id, name: id, type: 'x', on: true, reachable: true, brightness: 254, color: '#ff0000', color_temp: null,
  supports_color: true, supports_color_temp: true, archetype: '', productname: '', modelid: '', gradient_points: 0,
  profile: {} as never, gradient: null, effect: null, ...extra,
});
const result = (id: string, extra: Partial<SceneResult> = {}): SceneResult => ({
  light_id: id, label: id, on: true, keep: false, color: '#00ff00', xy: null, brightness: 50, gradient: null, mode: null, effect: null, override: false, ...extra,
});

describe('shownLights', () => {
  it('lays results over live lights and leaves the rest alone', () => {
    const map = { a: live('a'), b: live('b') };
    const out = shownLights(map, [result('a')]);
    expect(out.a.color).toBe('#00ff00');
    expect(out.a.reachable).toBe(true);
    expect(out.b).toBe(map.b);
    expect(map.a.color).toBe('#ff0000');
  });
  it('returns the live map when nothing is shown', () => {
    const map = { a: live('a') };
    expect(shownLights(map, null)).toBe(map);
  });
  it('turns percent into the bridge scale', () => {
    expect(shownLights({ a: live('a') }, [result('a', { brightness: 50 })]).a.brightness).toBe(127);
    expect(shownLights({ a: live('a') }, [result('a', { brightness: 0 })]).a.brightness).toBe(1);
  });
  it('turns a light off for an off result', () => {
    expect(shownLights({ a: live('a') }, [result('a', { on: false })]).a.on).toBe(false);
  });
  it('uses a white from the temperature when only that is set, and gradient points', () => {
    const w = shownLights({ a: live('a') }, [result('a', { color: null, color_temp: 2700 })]).a;
    expect(w.color).toMatch(/^#[0-9a-f]{6}$/i);
    const g = shownLights({ a: live('a') }, [result('a', { gradient: ['#111111', '#222222'] })]).a;
    expect(g.gradient?.points).toEqual(['#111111', '#222222']);
  });
  it('draws a planned light (no live entry) from its result, and not at all when nothing is shown', () => {
    const out = shownLights({}, [result('p', { label: 'Planned lamp', brightness: 40 })]);
    expect(out.p).toMatchObject({ id: 'p', name: 'Planned lamp', on: true, reachable: true, color: '#00ff00', brightness: 102 });
    expect(shownLights({}, null)).toEqual({});
  });
});

describe('shownLevels', () => {
  it('converts live 1-254 to percent so overLimit compares like with like', () => {
    const report = { hazards: 1, lights: [{ light_id: 'a', label: 'a', status: 'direct_fov', angle: 0, cap: { brightness: 15, kelvin: null }, hazards: [] }] } as unknown as GlareReport;
    const levels = shownLevels({ a: live('a', { brightness: 254 }) });
    expect(levels.a).toEqual({ on: true, brightness: 100 });
    expect(overLimit(report, levels)).toEqual(['a']);
    expect(overLimit(report, shownLevels({ a: live('a', { brightness: 30 }) }))).toEqual([]);
    expect(overLimit(report, shownLevels({ a: live('a', { on: false }) }))).toEqual([]);
    expect(overLimit(report, shownLevels(shownLights({ a: live('a') }, [result('a', { brightness: 10 })])))).toEqual([]);
  });
});

describe('glareBadge', () => {
  it('counts what is over and what to watch', () => {
    expect(glareBadge(0, 3)).toBe('0 over the limit · 3 to watch');
    expect(glareBadge(2, 1)).toBe('2 over the limit · 1 to watch');
  });
  it('says so when there is nothing', () => expect(glareBadge(0, 0)).toBe('No glare risk'));
});

describe('fixGlareState', () => {
  it('works as before when nothing is shown', () => {
    expect(fixGlareState(false, 2).disabled).toBe(false);
    expect(fixGlareState(false, 0).disabled).toBe(true);
  });
  it('is off, and says why, while a card is shown', () => {
    expect(fixGlareState(true, 2)).toEqual({ disabled: true, title: 'Fix glare changes your real lights. Show live first.' });
  });
});

describe('a shown planned light', () => {
  it('has a real profile, so nothing that reads it can throw', () => {
    const out = shownLights({}, [result('p', { label: 'Planned lamp' })]);
    expect(out.p.profile.label).toBeTruthy();
  });
});
