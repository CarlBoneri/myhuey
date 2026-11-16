import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { THEMES } from './theme';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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
