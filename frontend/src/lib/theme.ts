// The app's colour theme. The page sets data-theme="<theme id>" on <html>; styles.css holds a token
// set per theme. The choice is a preference (shared with the CLI): one theme, or "system", which
// follows the operating system with a chosen theme for each mode. A copy in localStorage avoids
// a flash of the wrong theme before the preferences load.

import { GENERATED_THEMES } from './themes.generated';

type BuiltInThemeId = 'neon' | 'monokai' | 'dracula' | 'nord' | 'graphite' | 'solarized-light' | 'light';
export type ThemeId = BuiltInThemeId | (typeof GENERATED_THEMES)[number]['id'];
export interface ThemeInfo { id: ThemeId; label: string; kind: 'dark' | 'light'; source: string; swatches: readonly string[] }
export type Theme = ThemeId | 'system';
export type ThemePrefs = { theme: string; theme_dark?: string; theme_light?: string };

/** Each theme's six ANSI colours (red, green, yellow, blue, magenta, cyan), shown in the picker; styles.css holds the same values. */
const BUILT_IN: Omit<ThemeInfo, 'source'>[] = [
  { id: 'neon', label: 'Neon', kind: 'dark', swatches: ['#ff4060', '#a6e22e', '#e6db74', '#5a7dff', '#ff2eea', '#37f6ff'] },
  { id: 'monokai', label: 'Monokai', kind: 'dark', swatches: ['#f92672', '#a6e22e', '#e6db74', '#66d9ef', '#ae81ff', '#a1efe4'] },
  { id: 'dracula', label: 'Dracula', kind: 'dark', swatches: ['#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd'] },
  { id: 'nord', label: 'Nord', kind: 'dark', swatches: ['#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0'] },
  { id: 'graphite', label: 'Graphite', kind: 'dark', swatches: ['#f87171', '#34d399', '#fbbf24', '#60a5fa', '#c084fc', '#22d3ee'] },
  { id: 'solarized-light', label: 'Solarized Light', kind: 'light', swatches: ['#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198'] },
  { id: 'light', label: 'Light', kind: 'light', swatches: ['#dc2626', '#059669', '#b45309', '#2563eb', '#c026d3', '#0891b2'] },
];

/** Every theme: MyHuey's own seven, then the ones imported from VS Code and Starship (scripts/import_editor_themes.py). */
export const THEMES: ThemeInfo[] = [...BUILT_IN.map((theme) => ({ ...theme, source: 'MyHuey' })), ...GENERATED_THEMES];

/** The themes of one kind (or all), grouped by where they come from, for a menu. */
export function themeGroups(kind?: 'dark' | 'light'): { label: string; themes: ThemeInfo[] }[] {
  const groups: { label: string; themes: ThemeInfo[] }[] = [];
  for (const mode of ['dark', 'light'] as const) {
    if (kind && kind !== mode) continue;
    for (const source of [...new Set(THEMES.map((theme) => theme.source))]) {
      const themes = THEMES.filter((theme) => theme.kind === mode && theme.source === source);
      if (themes.length) groups.push({ label: `${mode === 'dark' ? 'Dark' : 'Light'} · ${source}`, themes });
    }
  }
  return groups;
}

const CACHE_KEY = 'myhuey.theme';
const DEFAULTS = { theme: 'neon' as Theme, theme_dark: 'neon' as ThemeId, theme_light: 'light' as ThemeId };

const kindOf = (id: string) => THEMES.find((t) => t.id === id)?.kind;

/** A stored theme as the app reads it: the old "dark" and anything unknown become Neon. */
export function normalizeTheme(value: unknown): Theme {
  if (value === 'system') return 'system';
  return kindOf(String(value)) ? (value as ThemeId) : 'neon';
}

/** The chosen theme for one mode, or that mode's default when missing or of the other kind. */
function modeTheme(value: string | undefined, kind: 'dark' | 'light'): ThemeId {
  return value && kindOf(value) === kind ? (value as ThemeId) : kind === 'dark' ? DEFAULTS.theme_dark : DEFAULTS.theme_light;
}

/** The theme to show now. */
export function resolveTheme(prefs: ThemePrefs, systemDark: boolean): ThemeId {
  const theme = normalizeTheme(prefs.theme);
  if (theme !== 'system') return theme;
  return systemDark ? modeTheme(prefs.theme_dark, 'dark') : modeTheme(prefs.theme_light, 'light');
}

/** What the rail's sun/moon button saves: the other mode's theme, remembering the one on screen
 * as its mode's choice, so an explicit pick like Monokai is never lost. */
export function themeToggle(prefs: ThemePrefs, systemDark: boolean): Partial<{ theme: Theme; theme_dark: ThemeId; theme_light: ThemeId }> {
  const showing = resolveTheme(prefs, systemDark);
  const dark = kindOf(showing) === 'dark';
  const target = dark ? modeTheme(prefs.theme_light, 'light') : modeTheme(prefs.theme_dark, 'dark');
  if (normalizeTheme(prefs.theme) === 'system') return { theme: target };
  return dark ? { theme: target, theme_dark: showing } : { theme: target, theme_light: showing };
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
}

/** Show the theme the preferences ask for, and cache them for the next page load. */
export function applyTheme(prefs: ThemePrefs): void {
  document.documentElement.dataset.theme = resolveTheme(prefs, systemPrefersDark());
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: prefs.theme, theme_dark: prefs.theme_dark, theme_light: prefs.theme_light }));
  } catch {
    // storage blocked: the saved preferences still apply once they load
  }
}

export function readCachedTheme(): { theme: Theme; theme_dark: ThemeId; theme_light: ThemeId } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cached = raw && raw.startsWith('{') ? JSON.parse(raw) : { theme: raw };
    return {
      theme: normalizeTheme(cached.theme ?? 'neon'),
      theme_dark: modeTheme(cached.theme_dark, 'dark'),
      theme_light: modeTheme(cached.theme_light, 'light'),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Re-apply "system" when the operating system switches between light and dark. Returns a stop function. */
export function followSystemTheme(prefs: ThemePrefs): () => void {
  if (normalizeTheme(prefs.theme) !== 'system' || typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => applyTheme(prefs);
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
}

/** Solid panels instead of glass: "on" always, "off" never, "auto" when the system asks for less transparency. */
export function applyTransparency(setting: 'auto' | 'on' | 'off'): void {
  const system = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches;
  const reduce = setting === 'on' || (setting === 'auto' && system);
  if (reduce) document.documentElement.dataset.transparency = 'reduced';
  else delete document.documentElement.dataset.transparency;
}
