import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { THEMES } from './theme';

// The hand-made themes and the imported ones are held to the same rules.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../themes.generated.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector} exists`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

// Controls drawn on the page background must read on both themes, so they take their colours from tokens.
const THEMED = ['.icon-button.lit', '.room-power.on circle', '.room-power.on path', '.mid-handle path', '.swatch', '.swatch.active', '.setup-rail li.done span'];

describe('light theme', () => {
  it.each(THEMED)('%s uses theme tokens, not light-on-dark literals', (selector) => {
    expect(rule(selector)).not.toMatch(/#ffd98a|#fff\b|\bwhite\b|#6ee7b7|rgba\(255, 255, 255/);
  });

});

describe('quick settings menu', () => {
  it('sits above the other room tiles and hides what is behind it', () => {
    // Each tile is its own stacking layer, so without this the next tiles paint over the open menu.
    expect(rule('.room-tile:has(.quick-menu)')).toContain('z-index');
    expect(rule('.quick-menu')).toContain('var(--bg-2)');
    // A colour can only be the last background layer; "var(--panel-bg), var(--bg-2)" is now invalid and left it see-through.
    expect(rule('.quick-menu')).not.toMatch(/background:[^;]*var\(--[\w-]+\),/);
  });
});

describe('group chips', () => {
  it('draw the keyboard focus ring inside the chip, which clips anything outside it', () => {
    expect(rule('.group-chip button:focus-visible')).toMatch(/outline-offset:\s*-2px/);
  });
});

/** The custom properties set in one block, by its exact selector. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector} exists`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(':root');

/** A colour with alpha (rgba or #rrggbbaa) laid over a solid hex, as the screen shows it. */
function over(top: string, bottom: string): string {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = top.match(/rgba?\(([\d.\s,]+)\)/);
  const [r, g, b, a] = rgba ? rgba[1].split(',').map(Number) : [...hex(top), top.length === 9 ? parseInt(top.slice(7), 16) / 255 : 1];
  const base = hex(bottom);
  const mix = [r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}
const NOT_COLOURS = ['--radius-xl', '--radius-l', '--radius-m', '--radius-s', '--font', '--mono', '--glass-blur'];
const NEW_TOKENS = ['--ansi-red', '--ansi-green', '--ansi-yellow', '--ansi-blue', '--ansi-magenta', '--ansi-cyan',
  '--glass-bg', '--glass-border', '--glass-highlight', '--glass-blur', '--glow-lit', '--selection'];

describe('theme token sets', () => {
  it('the base set (Neon) has every token, the new ones included', () => {
    for (const name of NEW_TOKENS) expect(root, name).toHaveProperty(name);
    expect(root['--bg']).toBe('#1f1f23');
    expect(root['--accent']).toBe('#5a7dff');
  });

  it.each(THEMES.map((t) => [t.id, t.kind] as const))('%s has readable text (4.5:1 or better)', (id, kind) => {
    const own = id === 'neon' ? {} : tokens(`:root[data-theme="${id}"]`);
    if (kind === 'light') {
      // A light theme cannot inherit dark colours, so it sets every colour itself.
      for (const name of Object.keys(root).filter((n) => !NOT_COLOURS.includes(n))) expect(own, `${id} ${name}`).toHaveProperty(name);
    }
    const set = { ...root, ...own };
    expect(contrastRatio(set['--on-accent'], set['--accent']), `${id} text on the accent`).toBeGreaterThanOrEqual(4.5);
    for (const text of ['--text', '--text-2', '--text-3']) {
      for (const bg of ['--bg', '--bg-2']) {
        expect(contrastRatio(set[text], set[bg]), `${id} ${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(THEMES.map((t) => [t.id, t.swatches] as const))('%s picker swatches match its ANSI tokens', (id, swatches) => {
    const set = { ...root, ...(id === 'neon' ? {} : tokens(`:root[data-theme="${id}"]`)) };
    expect(['--ansi-red', '--ansi-green', '--ansi-yellow', '--ansi-blue', '--ansi-magenta', '--ansi-cyan'].map((n) => set[n])).toEqual(swatches);
  });

  // Text sits on the page, on panels, and on hovered rows and cards inside panels (--surface-2 over the page).
  const TEXT = ['--text', '--text-2', '--text-3', '--warn-text', '--danger-text', '--link'];
  it.each(THEMES.map((t) => [t.id] as const))('%s: every text colour reads at 4.5:1 on the page and on cards', (id) => {
    const set = { ...root, ...(id === 'neon' ? {} : tokens(`:root[data-theme="${id}"]`)) };
    const grounds = { '--bg': set['--bg'], '--bg-2': set['--bg-2'], 'surface-2 on bg': over(set['--surface-2'], set['--bg']) };
    for (const text of TEXT) {
      for (const [name, ground] of Object.entries(grounds)) {
        expect(contrastRatio(set[text], ground), `${id} ${text} on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(THEMES.map((t) => [t.id] as const))('%s: text on the accent reads on every stop of the accent gradient', (id) => {
    const set = { ...root, ...(id === 'neon' ? {} : tokens(`:root[data-theme="${id}"]`)) };
    const stops = set['--accent-gradient'].match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length, `${id} gradient stops`).toBeGreaterThanOrEqual(2);
    for (const stop of stops) expect(contrastRatio(set['--on-accent'], stop), `${id} on ${stop}`).toBeGreaterThanOrEqual(4.5);
  });

  it('status and link text use the readable text tokens, not the palette colours', () => {
    for (const selector of ['.warn-text, .error-text', '.field small', '.save-state.dirty', '.pill.warn']) expect(rule(selector)).toContain('var(--warn-text)');
    for (const selector of ['\n.error-text', '.button.danger']) expect(rule(selector)).toContain('var(--danger-text)');
    for (const selector of ['.notice', '.link-button', '.sandbox-note a', '.quick-footer a']) expect(rule(selector)).toContain('var(--link)');
  });

  it('numbers on accent dots in photo setup use the text-on-accent colour', () => {
    expect(rule('.corner-map text')).toContain('var(--on-accent)');
  });

  it('decorative path and bracket characters are hidden from screen readers', () => {
    expect(rule('.page-head .eyebrow::before')).toMatch(/content: "~ \/ " \/ ""/);
    expect(rule('.page-head h1::before')).toMatch(/content: " \/ " \/ ""/);
    expect(rule('.page-head h1::after')).toMatch(/content: "▌" \/ ""/);
    expect(rule('.segmented button::before')).toMatch(/content: "\[ " \/ ""/);
    expect(rule('.segmented button::after')).toMatch(/content: " \]" \/ ""/);
  });

  it('graphite and light keep today\'s backgrounds', () => {
    expect(tokens(':root[data-theme="graphite"]')['--bg']).toBe('#0b0a12');
    expect(tokens(':root[data-theme="light"]')['--bg']).toBe('#f6f5fb');
  });
});

describe('glass and reduce transparency', () => {
  it('never blurs the canvases (plans, photos, scenes draw inside .stage)', () => {
    expect(rule('.stage')).not.toContain('backdrop-filter');
    expect(rule('.photo-stage')).not.toContain('backdrop-filter');
  });
  it('writes only the standard backdrop-filter, so the build keeps it for Chrome', () => {
    // With both spellings written, the CSS build merged them into the -webkit- one only, which
    // Chrome ignores: panels lost their blur. The build adds the Safari prefix by itself.
    expect(css).not.toMatch(/-webkit-backdrop-filter/);
  });

  it('panels are glass blocks built from the glass tokens', () => {
    expect(rule('.panel')).toContain('var(--glass-bg)');
    expect(rule('.panel')).toContain('blur(var(--glass-blur))');
    expect(rule('.panel')).toContain('var(--glass-highlight)');
  });
  it('reduce transparency turns every blur off and makes panels solid', () => {
    const reduced = tokens(':root[data-transparency="reduced"]');
    expect(reduced['--glass-blur']).toBe('0px');
    expect(reduced['--glass-bg']).toBe('var(--bg-2)');
    expect(reduced['--glow-lit']).toBe('transparent');
    expect(rule(':root[data-transparency="reduced"] *')).toMatch(/backdrop-filter:\s*none !important/);
  });
  it('the flat editor background has no colour wash', () => {
    expect(css).not.toMatch(/\.backdrop\s*\{/);
  });
  it('uses JetBrains Mono everywhere', () => {
    expect(root['--font'].startsWith("'JetBrains Mono Variable'")).toBe(true);
  });
});

describe('IDE touches', () => {
  it('page headings read as a path with a cursor', () => {
    expect(rule('.page-head .eyebrow::before')).toContain('content: "~ / "');
    expect(rule('.page-head h1::after')).toContain('▌');
  });
  it('the cursor holds still for people who ask for less motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.page-head h1::after\s*\{\s*animation: none/);
  });
  it('segmented options are bracketed like terminal flags', () => {
    expect(rule('.segmented button::before')).toContain('content: "[ "');
    expect(rule('.segmented button::after')).toContain('content: " ]"');
  });
});
