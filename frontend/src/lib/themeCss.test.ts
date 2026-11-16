import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('defines every light token once, shared by "light" and "system"', () => {
    expect(css.match(/--glass: rgba\(255, 255, 255, 0\.7\)/g)?.length).toBe(1);
  });
});

describe('quick settings menu', () => {
  it('sits above the other room tiles and hides what is behind it', () => {
    // Each tile is its own stacking layer, so without this the next tiles paint over the open menu.
    expect(rule('.room-tile:has(.quick-menu)')).toContain('z-index');
    expect(rule('.quick-menu')).toContain('var(--bg-2)');
  });
});

describe('group chips', () => {
  it('draw the keyboard focus ring inside the chip, which clips anything outside it', () => {
    expect(rule('.group-chip button:focus-visible')).toMatch(/outline-offset:\s*-2px/);
  });
});
