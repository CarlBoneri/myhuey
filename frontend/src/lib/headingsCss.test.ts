import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A simulated DOM has no layout, so the heading rules are checked in the stylesheet's own text.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of every rule whose selector list contains this exact selector, at the start of a line or after a comma.
function bodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...css.matchAll(new RegExp(`(?:^|,\\s*)${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gm'))].map((match) => match[1]);
  expect(found.length, `a rule for ${selector} exists`).toBeGreaterThan(0);
  return found;
}

describe('path headings', () => {
  it('shows names as typed inside path headings', () => {
    expect(bodies('.page-head .as-typed').join('\n')).toContain('text-transform: none');
  });

  it('sizes the scene name field as heading text', () => {
    const body = bodies('.page-head .title-input').join('\n');
    expect(body).toMatch(/font:\s*inherit|font-size:\s*inherit/);
    expect(body).toContain('max-width: 100%');
    expect(body).not.toContain('font-size: 28px');
  });

  it('keeps fixed heading words lowercase', () => {
    expect(bodies('.page-head h1').join('\n')).toContain('text-transform: lowercase');
  });
});
