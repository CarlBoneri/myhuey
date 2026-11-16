import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES, normalizeTheme, readCachedTheme, resolveTheme } from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('theme ids', () => {
  it('lists seven themes, Neon first', () => {
    expect(THEMES.slice(0, 7).map((t) => t.id)).toEqual(['neon', 'monokai', 'dracula', 'nord', 'graphite', 'solarized-light', 'light']);
    expect(THEMES.filter((t) => t.kind === 'light').map((t) => t.id).slice(0, 2)).toEqual(['solarized-light', 'light']);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    // Imported themes are named for where they came from, so they can never take a built-in id.
    for (const theme of THEMES.slice(7)) expect(theme.id).toMatch(/^(vscode|starship)-[a-z0-9-]+$/);
  });
  it('reads an old "dark" or an unknown value as Neon', () => {
    expect(normalizeTheme('dark')).toBe('neon');
    expect(normalizeTheme('bogus')).toBe('neon');
    expect(normalizeTheme(undefined)).toBe('neon');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('system')).toBe('system');
  });
});

describe('resolving a theme', () => {
  const sys = { theme: 'system', theme_dark: 'dracula', theme_light: 'solarized-light' };
  it('follows the system with the chosen theme for each mode', () => {
    expect(resolveTheme(sys, true)).toBe('dracula');
    expect(resolveTheme(sys, false)).toBe('solarized-light');
  });
  it('keeps an explicit choice whatever the system says', () => {
    expect(resolveTheme({ theme: 'monokai' }, false)).toBe('monokai');
  });
  it('falls back to Neon and Light for missing or wrong-kind mode choices', () => {
    expect(resolveTheme({ theme: 'system', theme_dark: 'light' }, true)).toBe('neon');
    expect(resolveTheme({ theme: 'system' }, false)).toBe('light');
  });
});

describe('the cached theme', () => {
  it('reads back what was cached, and defaults when storage is blocked', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    data.set('myhuey.theme', JSON.stringify({ theme: 'dracula', theme_dark: 'nord', theme_light: 'solarized-light' }));
    expect(readCachedTheme()).toEqual({ theme: 'dracula', theme_dark: 'nord', theme_light: 'solarized-light' });
    data.set('myhuey.theme', 'dark'); // what the old app cached
    expect(readCachedTheme()).toEqual({ theme: 'neon', theme_dark: 'neon', theme_light: 'light' });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readCachedTheme()).toEqual({ theme: 'neon', theme_dark: 'neon', theme_light: 'light' });
  });
});

describe('reduce transparency', () => {
  const page = () => {
    const attrs: Record<string, string> = {};
    vi.stubGlobal('document', { documentElement: { dataset: attrs } });
    return attrs;
  };
  it('reduces when on, never when off, and follows the system when auto', async () => {
    const { applyTransparency } = await import('./theme');
    const attrs = page();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-transparency') }));
    applyTransparency('on');
    expect(attrs.transparency).toBe('reduced');
    applyTransparency('off');
    expect(attrs.transparency).toBeUndefined();
    applyTransparency('auto');
    expect(attrs.transparency).toBe('reduced');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    applyTransparency('auto');
    expect(attrs.transparency).toBeUndefined();
  });
  it('re-applies "auto" when the system setting changes, and stops when told', async () => {
    const { followSystemTransparency } = await import('./theme');
    const attrs = page();
    const query = {
      matches: false,
      listener: undefined as undefined | (() => void),
      addEventListener: vi.fn((_: string, fn: () => void) => { query.listener = fn; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => query);
    const stop = followSystemTransparency('auto');
    expect(query.addEventListener).toHaveBeenCalledWith('change', query.listener);
    query.matches = true;
    query.listener!();
    expect(attrs.transparency).toBe('reduced');
    query.matches = false;
    query.listener!();
    expect(attrs.transparency).toBeUndefined();
    stop();
    expect(query.removeEventListener).toHaveBeenCalledWith('change', query.listener);
  });
  it('listens to nothing for "on" and "off"', async () => {
    const { followSystemTransparency } = await import('./theme');
    page();
    const addEventListener = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener, removeEventListener: vi.fn() }));
    expect(followSystemTransparency('on')).toBeTypeOf('function');
    expect(followSystemTransparency('off')).toBeTypeOf('function');
    expect(addEventListener).not.toHaveBeenCalled();
  });
});

describe('theme swatches', () => {
  it('every theme carries six palette colours for the picker', () => {
    for (const theme of THEMES) expect(theme.swatches, theme.id).toHaveLength(6);
    expect(THEMES[0].swatches).toEqual(['#ff4060', '#a6e22e', '#e6db74', '#5a7dff', '#ff2eea', '#37f6ff']);
  });
});
