import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTry, loadTry, saveTry, type TryRecord } from './tryLook';

const HOUR = 3600_000;
const record = (at = 1_000_000): TryRecord => ({
  at, look: { a: { on: true, bri: 100 } }, skipped: ['b'], title: 'Code · Dusk', layout: null, capturedAt: '09:15',
});

function memoryStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
  return data;
}

beforeEach(() => { memoryStorage(); });
afterEach(() => vi.unstubAllGlobals());

describe('tryLook', () => {
  it('returns the record within 12 hours and null after', () => {
    saveTry('Office', record());
    expect(loadTry('Office', 1_000_000 + 11 * HOUR)).toEqual(record());
    expect(loadTry('Office', 1_000_000 + 12 * HOUR + 1)).toBeNull();
  });
  it('keeps rooms apart and clears one', () => {
    saveTry('Office', record());
    expect(loadTry('Den', 1_000_001)).toBeNull();
    clearTry('Office');
    expect(loadTry('Office', 1_000_001)).toBeNull();
  });
  it('survives throwing storage', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => saveTry('Office', record())).not.toThrow();
    expect(loadTry('Office')).toBeNull();
    expect(() => clearTry('Office')).not.toThrow();
  });
  it('ignores a damaged record', () => {
    localStorage.setItem('myhuey.try.Office', '{nope');
    expect(loadTry('Office', 1)).toBeNull();
  });
});
