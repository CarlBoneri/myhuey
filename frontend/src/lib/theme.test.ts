import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES, normalizeTheme, readCachedTheme, resolveTheme, themeToggle } from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('theme ids', () => {
  it('lists seven themes, Neon first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['neon', 'monokai', 'dracula', 'nord', 'graphite', 'solarized-light', 'light']);
    expect(THEMES.filter((t) => t.kind === 'light').map((t) => t.id)).toEqual(['solarized-light', 'light']);
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

describe('the rail toggle', () => {
  it('keeps an explicit dark theme as the dark choice and shows the light one', () => {
    expect(themeToggle({ theme: 'monokai', theme_dark: 'neon', theme_light: 'light' }, true)).toEqual({ theme: 'light', theme_dark: 'monokai' });
  });
  it('goes back to the remembered dark theme', () => {
    expect(themeToggle({ theme: 'light', theme_dark: 'monokai', theme_light: 'light' }, true)).toEqual({ theme: 'monokai', theme_light: 'light' });
  });
  it('in system mode switches to the opposite of what is showing', () => {
    expect(themeToggle({ theme: 'system', theme_dark: 'nord', theme_light: 'light' }, true)).toEqual({ theme: 'light' });
    expect(themeToggle({ theme: 'system', theme_dark: 'nord', theme_light: 'light' }, false)).toEqual({ theme: 'nord' });
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
});

describe('theme swatches', () => {
  it('every theme carries six palette colours for the picker', () => {
    for (const theme of THEMES) expect(theme.swatches, theme.id).toHaveLength(6);
    expect(THEMES[0].swatches).toEqual(['#ff4060', '#a6e22e', '#e6db74', '#5a7dff', '#ff2eea', '#37f6ff']);
  });
});
