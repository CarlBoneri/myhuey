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

  it('gives the 3D view most of a narrow window when the glare table is folded', () => {
    const body = bodiesIn(narrowStudioBlock(), '.studio3d.audit-folded .pane-body.stage').join('\n');
    expect(body).toMatch(/height:\s*\S/);
    expect(body).not.toMatch(/height:\s*clamp\(320px, 62vh, 620px\)/);
    expect(body).toContain('clamp(320px, calc(100dvh - 190px), 1200px)');
  });

  it('keeps pane bars out of text selection', () => {
    expect(bodiesIn(css, '.splitter').join('\n')).toMatch(/user-select:\s*none/);
  });

  it('puts the plan Showing label at the bottom centre, clear of the top toolbar and hints', () => {
    const toolbar = bodiesIn(css, '.toolbar.floating').find((body) => /position:\s*absolute/.test(body))!;
    expect(toolbar).toMatch(/top:[^;]+;\s*left:\s*14px/);
    const label = bodiesIn(css, '.showing-label').find((body) => /position:\s*absolute/.test(body))!;
    expect(label).toMatch(/left:\s*50%/);
    expect(label).toMatch(/bottom:\s*\d+px/);
    expect(label).not.toMatch(/\btop:/);
    expect(label).toMatch(/transform:\s*translateX\(-50%\)/);
    // In the 3D view the top-left holds the stage's own hint, so the label sits at the top right there.
    const in3d = bodiesIn(css, '.pane-body.stage .showing-label').join('\n');
    expect(in3d).toMatch(/right:\s*\d+px/);
    expect(in3d).toMatch(/left:\s*auto/);
    expect(in3d).toMatch(/top:\s*\d+px/);
    expect(in3d).toMatch(/bottom:\s*auto/);
  });
});
