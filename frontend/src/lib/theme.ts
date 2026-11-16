// The app's colour theme. The page sets data-theme on <html>; styles.css holds both colour sets.
// The choice is a preference (shared with the CLI); a copy in localStorage avoids a dark flash
// before the preferences load.

export type Theme = 'dark' | 'light' | 'system';
const CACHE_KEY = 'myhuey.theme';

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): 'dark' | 'light' {
  return theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;
}

/** What the rail's sun/moon button switches to: the opposite of what is showing now. */
export function toggledTheme(theme: Theme, systemPrefersDark: boolean): 'dark' | 'light' {
  return resolveTheme(theme, systemPrefersDark) === 'dark' ? 'light' : 'dark';
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // storage blocked: the saved preference still applies once it loads
  }
}

export function readCachedTheme(): Theme {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached === 'light' || cached === 'system' || cached === 'dark') return cached;
  } catch {
    // fall through
  }
  return 'dark';
}
