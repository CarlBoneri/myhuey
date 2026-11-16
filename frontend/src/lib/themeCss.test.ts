import { describe, expect, it } from 'vitest';
import css from '../styles.css?raw';

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
