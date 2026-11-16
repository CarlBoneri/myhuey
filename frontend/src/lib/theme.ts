// The app's colour theme. The page sets data-theme="<theme id>" on <html>; styles.css holds a token
// set per theme. The choice is a preference (shared with the CLI): one theme, or "system", which
// follows the operating system with a chosen theme for each mode. A copy in localStorage avoids
// a flash of the wrong theme before the preferences load.

export type ThemeId = 'neon' | 'monokai' | 'dracula' | 'nord' | 'graphite' | 'solarized-light' | 'light';
export type Theme = ThemeId | 'system';
export type ThemePrefs = { theme: string; theme_dark?: string; theme_light?: string };

export const THEMES: { id: ThemeId; label: string; kind: 'dark' | 'light' }[] = [
  { id: 'neon', label: 'Neon', kind: 'dark' },
  { id: 'monokai', label: 'Monokai', kind: 'dark' },
  { id: 'dracula', label: 'Dracula', kind: 'dark' },
  { id: 'nord', label: 'Nord', kind: 'dark' },
  { id: 'graphite', label: 'Graphite', kind: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', kind: 'light' },
  { id: 'light', label: 'Light', kind: 'light' },
];

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
