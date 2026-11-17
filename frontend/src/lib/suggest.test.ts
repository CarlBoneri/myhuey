import { describe, expect, it } from 'vitest';
import { glowColor, thumbFill, THUMB_FLOOR, autoRoleLabel, cardTitle, creditText, fullStrength, glowOpacity, lightFill, nowHHMM, quarterHours, scheduleWarning } from './suggest';
import { hexToRgb } from './color';

describe('suggest helpers', () => {
  it('titles a card by mode and palette', () => {
    expect(cardTitle('code', { name: 'Dusk' })).toBe('Code · Dusk');
  });

  it('credits each palette source', () => {
    expect(creditText({ source: 'colourlovers', credit: { author: 'sam', url: 'https://x' } })).toBe('Palette by sam on COLOURlovers (CC BY-NC-SA 3.0)');
    expect(creditText({ source: 'met', credit: { title: 'Wheat Field', artist: 'Vincent van Gogh', url: 'https://y' } })).toBe('Colors from “Wheat Field” by Vincent van Gogh, The Met (CC0)');
    expect(creditText({ source: 'met', credit: { title: 'Bowl', url: 'https://y' } })).toBe('Colors from “Bowl”, The Met (CC0)');
    expect(creditText({ source: 'generated', credit: {} })).toBe('');
    expect(creditText({ source: 'hue', credit: { set: 'Cozy', by: 'Philips Hue app scene gallery (2023-09-28); values recorded by Hypfer and coderph0x' } }))
      .toBe('A Hue app scene from the “Cozy” set (values recorded by Hypfer and coderph0x)');
    expect(creditText({ source: 'd3', credit: { scheme: 'Plasma', by: 'van der Walt and Smith for matplotlib, via d3-scale-chromatic', license: 'CC0' } }))
      .toBe('Plasma scheme by van der Walt and Smith for matplotlib, via d3-scale-chromatic (CC0)');
  });

  it('formats the time as HH:MM', () => {
    expect(nowHHMM(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
  });

  it('lists quarter hours', () => {
    const times = quarterHours();
    expect(times).toHaveLength(96);
    expect(times[0]).toBe('00:00');
    expect(times[95]).toBe('23:45');
  });

  it('fills a light from its preview, dark when off', () => {
    expect(lightFill({ on: false, color: null, brightness: 0 })).toEqual({ fill: '#2a2a2a', opacity: 1 });
    expect(lightFill({ on: true, color: '#ff8800', brightness: 50 })).toEqual({ fill: '#ff8800', opacity: 0.5 });
  });

  it('fades a dim light toward transparent and never darkens its color', () => {
    const dim = lightFill({ on: true, color: '#ffb46b', brightness: 5 });
    const bright = lightFill({ on: true, color: '#ffb46b', brightness: 100 });
    expect(dim.fill).toBe('#ffb46b');
    expect(bright).toEqual({ fill: '#ffb46b', opacity: 1 });
    expect(dim.opacity).toBeLessThan(0.2);
    expect(dim.opacity).toBeGreaterThan(0);
    // A dark palette color is drawn at the light's full strength: how bright it is goes in the opacity.
    const brown = lightFill({ on: true, color: '#3b2a1d', brightness: 10 });
    expect(Math.max(...hexToRgb(brown.fill))).toBe(255);
    expect(brown.opacity).toBe(glowOpacity(10));
    expect(fullStrength('#3b3b3b')).toBe('#ffffff');
    expect(fullStrength('#000000')).toBe('#ffffff');
    expect(glowOpacity(1)).toBeLessThan(glowOpacity(30));
  });
});

import { latestOnly, placementNeedsRefresh } from './suggest';
import { hexToHsl } from './color';

describe('glowColor', () => {
  it('lifts a dark color to a lightness floor and keeps its hue', () => {
    for (const hex of ['#1d2440', '#3b2416']) {
      const [h0] = hexToHsl(hex);
      const [h, , l] = hexToHsl(glowColor(hex));
      expect(l).toBeGreaterThanOrEqual(59);
      expect(Math.abs(h - h0)).toBeLessThanOrEqual(1);
    }
  });
  it('leaves an already light color alone', () => {
    expect(glowColor('#ffd29a')).toBe('#ffd29a');
    expect(glowColor('#ffffff')).toBe('#ffffff');
  });
});

describe('thumbFill', () => {
  it('keeps a dim light visible in a thumbnail and an off light solid', () => {
    const dim = thumbFill({ on: true, color: '#ffb46b', brightness: 3 });
    expect(dim.opacity).toBeGreaterThanOrEqual(THUMB_FLOOR);
    expect(THUMB_FLOOR).toBe(0.2);
    expect(thumbFill({ on: true, color: '#ffb46b', brightness: 100 }).opacity).toBe(1);
    expect(thumbFill({ on: false, color: null, brightness: 0 })).toEqual({ fill: '#2a2a2a', opacity: 1 });
  });
});

describe('request hygiene', () => {
  const base: { light_id: string; x: number; y: number; elevation: number | null; role: string } = { light_id: '1', x: 0, y: 0, elevation: null, role: 'auto' };

  it('refreshes rooms only when height or role changed', () => {
    expect(placementNeedsRefresh(base, { ...base, x: 10 })).toBe(false);
    expect(placementNeedsRefresh(base, { ...base, elevation: 90 })).toBe(true);
    expect(placementNeedsRefresh({ ...base, elevation: 90 }, { ...base, elevation: null })).toBe(true);
    expect(placementNeedsRefresh(base, { ...base, role: 'bias' })).toBe(true);
    expect(placementNeedsRefresh(undefined, base)).toBe(false);
  });

  it('keeps only the latest answer', () => {
    const guard = latestOnly();
    const first = guard.next();
    const second = guard.next();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });
});

describe('autoRoleLabel', () => {
  it('shows one role when every focus agrees', () => {
    expect(autoRoleLabel({ desk: 'task', read: 'task', sofa: 'task' })).toBe('Auto (task)');
  });

  it('shows the role per focus when they differ, calling sofa relax', () => {
    expect(autoRoleLabel({ desk: 'bias', read: 'ambient', sofa: 'ambient' })).toBe('Auto (desk: bias · read: ambient · relax: ambient)');
  });

  it('is plain Auto before the server has worked roles out', () => {
    expect(autoRoleLabel(undefined)).toBe('Auto');
    expect(autoRoleLabel({})).toBe('Auto');
  });
});

describe('scheduleWarning', () => {
  it('says nothing for an ordinary day, even across midnight', () => {
    expect(scheduleWarning('07:00', '23:00')).toBe('');
    expect(scheduleWarning('10:00', '02:00')).toBe('');
    expect(scheduleWarning('07:00', '13:00')).toBe('');
  });

  it('warns when wake time and bedtime are the same', () => {
    // curve.py reads equal times as a 24-hour day: bright all day, winding down just before the wake time
    expect(scheduleWarning('07:00', '07:00')).toBe('Wake time and bedtime are the same, so suggestions treat it as a 24-hour day with no night.');
  });

  it('warns about a day under six hours', () => {
    expect(scheduleWarning('07:00', '12:00')).toBe('Only 5 hours between waking and bedtime; suggestions will be dim most of the day.');
    expect(scheduleWarning('23:00', '00:00')).toBe('Only 1 hour between waking and bedtime; suggestions will be dim most of the day.');
    expect(scheduleWarning('07:00', '12:45')).toBe('Only 5 h 45 min between waking and bedtime; suggestions will be dim most of the day.');
    expect(scheduleWarning('07:00', '07:30')).toBe('Only 30 min between waking and bedtime; suggestions will be dim most of the day.');
  });
});

import { oneAtATime } from './suggest';

describe('one save at a time', () => {
  it('folds calls made during a save into one follow-up, and tells the last run it is last', async () => {
    const runs: boolean[] = [];
    let release: () => void = () => {};
    const save = oneAtATime(async (isLast) => {
      await new Promise<void>((resolve) => { release = resolve; });
      runs.push(isLast());
    });
    const first = save();
    void save(); void save(); void save();
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual([false, true]);
  });
});

describe('the relax preset is shown as Chill', () => {
  it('labels relax as Chill', async () => {
    const { MODE_LABELS } = await import('./suggest');
    expect(MODE_LABELS.relax).toBe('Chill');
  });
});

import { glareHeldLine, heldText } from './suggest';

describe('glare lines for the panel', () => {
  const cap = (brightness: number, reason: 'reflection' | 'direct' | 'peripheral', kelvin: number | null = null) => ({ brightness, kelvin, reason });
  const labels = { a: 'Desktop left', b: 'gradient_tube', c: 'Spot right', d: 'Desk lamp', e: 'Floor lamp' };

  it('names the held lights once, grouped by why and with the limit the request sent', () => {
    const limits = { checked: true, caps: { a: cap(18, 'reflection', 2700), d: cap(15, 'direct'), b: cap(18, 'reflection', 2700), c: cap(18, 'reflection', 2700) } };
    expect(glareHeldLine(limits, labels)).toBe(
      'Held for glare at the desk: Desktop left, gradient_tube, Spot right (reflect in the screen: ≤18%, warm white); Desk lamp (in view: ≤15%).',
    );
    expect(glareHeldLine({ checked: true, caps: { e: cap(35, 'peripheral'), x: cap(15, 'direct') } }, labels))
      .toBe('Held for glare at the desk: x (in view: ≤15%); Floor lamp (at the edge of view: ≤35%).');
  });

  it('says nothing when nothing is held or nothing was checked', () => {
    expect(glareHeldLine({ checked: true, caps: {} }, labels)).toBe('');
    expect(glareHeldLine({ checked: false, caps: { a: cap(18, 'reflection', 2700) } }, labels)).toBe('');
  });

  it('gives each card one short line', () => {
    expect(heldText({ time: '', glare: [], checked: true, held: 5 })).toBe('5 lights held for glare');
    expect(heldText({ time: '', glare: [], checked: true, held: 1 })).toBe('1 light held for glare');
    expect(heldText({ time: '', glare: ['No light would glare at the desk.'], checked: true, held: 0 })).toBe('');
    expect(heldText(undefined)).toBe('');
  });
});
