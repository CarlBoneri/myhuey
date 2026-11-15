import { describe, expect, it } from 'vitest';
import { cardTitle, creditText, lightFill, nowHHMM, quarterHours } from './suggest';

describe('suggest helpers', () => {
  it('titles a card by mode and palette', () => {
    expect(cardTitle('code', { name: 'Dusk' })).toBe('Code · Dusk');
  });

  it('credits each palette source', () => {
    expect(creditText({ source: 'colourlovers', credit: { author: 'sam', url: 'https://x' } })).toBe('Palette by sam on COLOURlovers (CC BY-NC-SA 3.0)');
    expect(creditText({ source: 'met', credit: { title: 'Wheat Field', artist: 'Vincent van Gogh', url: 'https://y' } })).toBe('Colors from “Wheat Field” by Vincent van Gogh, The Met (CC0)');
    expect(creditText({ source: 'met', credit: { title: 'Bowl', url: 'https://y' } })).toBe('Colors from “Bowl”, The Met (CC0)');
    expect(creditText({ source: 'generated', credit: {} })).toBe('');
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
