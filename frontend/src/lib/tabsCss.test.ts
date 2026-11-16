import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A simulated DOM has no layout, so the tab rail's layout rules are checked in the stylesheet's own text.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of every rule whose selector list contains this exact selector, at the start of a line or after a comma.
function bodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...css.matchAll(new RegExp(`(?:^|,\\s*)${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gm'))].map((match) => match[1]);
  expect(found.length, `a rule for ${selector} exists`).toBeGreaterThan(0);
  return found;
}

// Every rule whose selector mentions this text, whatever else it names.
function rulesAbout(text: string): { selector: string; body: string }[] {
  return [...css.matchAll(/^([^{}\n/][^{}]*)\{([^}]*)\}/gm)].filter((match) => match[1].includes(text)).map((match) => ({ selector: match[1], body: match[2] }));
}

describe('tab rail layout', () => {
  it('declares the rail width default once and uses it without fallbacks', () => {
    expect(css.match(/--rail-w:\s*210px/g)).toHaveLength(1);
    expect(css).not.toMatch(/var\(--rail-w,/);
  });

  it('keeps the resize handle in the flow, in a lane of its own', () => {
    const handle = rulesAbout('.rail-handle').filter((found) => !found.selector.includes(':focus-visible'));
    expect(handle.length).toBeGreaterThan(0);
    const body = handle.map((found) => found.body).join('\n');
    expect(body).not.toMatch(/position:\s*absolute/);
    expect(body).not.toMatch(/(?:left|right):\s*-5px/);
    expect(body).toMatch(/width:\s*7px/);
  });

  it('stops scrolling short of the pinned buttons', () => {
    expect(bodies('.tabs').join('\n')).toMatch(/scroll-padding-inline-end:\s*32px/);
    expect(bodies('.tabs.rail').join('\n')).toMatch(/scroll-padding:\s*34px 0 32px/);
  });
});
