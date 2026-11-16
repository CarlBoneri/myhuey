import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A simulated DOM has no layout, so type size and leftover colours are checked in the stylesheet's own text.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Every font-size declaration with the line it sits on.
const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => ({ value: match[1].trim(), line: css.slice(0, match.index).split('\n').length }));

// Rules that may keep a violet value, listed by selector: the image swatch's rainbow is a picture of colours.
const allowedViolet = ['.dot.image'];

describe('legibility', () => {
  it('sets no font size under 12px', () => {
    const px = sizes.filter((size) => /^[\d.]+px$/.test(size.value));
    expect(px.length).toBeGreaterThan(0);
    expect(px.filter((size) => parseFloat(size.value) < 12).map((size) => `line ${size.line}: ${size.value}`)).toEqual([]);
  });

  it('never lets a relative size shrink text under 12px', () => {
    const relative = sizes.filter((size) => /^[\d.]+(em|rem|%)$/.test(size.value));
    const shrinking = relative.filter((size) => {
      const n = parseFloat(size.value);
      return size.value.endsWith('%') ? n < 100 : n < 1;
    });
    expect(shrinking.map((size) => `line ${size.line}: ${size.value}`)).toEqual([]);
  });

  it('leaves no hard-coded violet outside theme palettes', () => {
    const rest = css.replace(/^:root[^{]*\{[^}]*\}/gm, '');
    const rules = [...rest.matchAll(/^([^{}\n/][^{}]*)\{([^}]*)\}/gm)];
    const violet = /167,\s*139,\s*250|139,\s*92,\s*246|124,\s*58,\s*237|#a78bfa|#8b5cf6|#7c3aed/i;
    const found = rules.filter((rule) => violet.test(rule[2]) && !allowedViolet.includes(rule[1].trim())).map((rule) => rule[1].trim());
    expect(found).toEqual([]);
  });
});
