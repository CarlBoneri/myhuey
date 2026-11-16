import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A simulated DOM has no layout, so the Studio's layout rules are checked in the stylesheet's own text.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of every rule in this text whose selector list contains this exact selector.
function bodiesIn(text: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  return [...text.matchAll(new RegExp(`(?:^|[\\s,])${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gm'))].map((match) => match[1]);
}

// The inside of the `@media (max-width: 980px)` block that holds the 3D screen's rules, found by brace matching.
function narrowStudioBlock(): string {
  for (const start of css.matchAll(/@media \(max-width: 980px\)\s*\{/g)) {
    let depth = 1;
    let at = start.index! + start[0].length;
    while (depth > 0 && at < css.length) {
      if (css[at] === '{') depth++;
      else if (css[at] === '}') depth--;
      at++;
    }
    const block = css.slice(start.index! + start[0].length, at - 1);
    if (block.includes('.studio3d')) return block;
  }
  throw new Error('no 980px block holds the .studio3d rules');
}

describe('studio layout', () => {
  it('makes the work area the Workflows drawer\'s positioning container', () => {
    expect(bodiesIn(css, '.workspace').join('\n')).toMatch(/position:\s*relative/);
  });

  it('gives the stacked 3D panes real heights in a narrow window', () => {
    const block = narrowStudioBlock();
    expect(bodiesIn(block, '.studio3d-main > .pane').join('\n')).toMatch(/flex:\s*none\s*!important/);
    expect(bodiesIn(block, '.studio3d .pane-body.stage').join('\n')).toMatch(/height:\s*clamp\(320px, 62vh, 620px\)/);
    expect(bodiesIn(block, '.studio3d .pane-body.audit').join('\n')).toMatch(/max-height:\s*50vh/);
    expect(bodiesIn(block, '.studio3d .splitter.row').join('\n')).toMatch(/display:\s*none/);
  });

  it('keeps pane bars out of text selection', () => {
    expect(bodiesIn(css, '.splitter').join('\n')).toMatch(/user-select:\s*none/);
  });
});
