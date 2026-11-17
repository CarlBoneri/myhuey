import { describe, expect, it } from 'vitest';
import { autoRoleLabel, cardTitle, creditText, lightFill, nowHHMM, quarterHours, scheduleWarning } from './suggest';

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
    expect(lightFill({ on: true, color: '#ff8800', brightness: 50 })).toEqual({ fill: '#ff8800', opacity: 0.6 });
  });
});

import { latestOnly, placementNeedsRefresh } from './suggest';

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
