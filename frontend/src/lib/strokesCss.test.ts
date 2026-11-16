import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Strokes are checked in the source text: a simulated DOM resolves no theme colours.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../styles.css');

describe('plan strokes', () => {
  it('declares one line colour built from the text colour', () => {
    expect(css.match(/--plan-line:\s*color-mix\(in srgb, var\(--text\)/g)).toHaveLength(1);
  });

  it('draws no white stroke straight onto a theme background', () => {
    for (const file of ['../views/SceneEditor.tsx', '../components/PlanLightsPanel.tsx', '../components/Shapes.tsx']) {
      const source = read(file);
      expect(source, file).not.toContain('stroke="#fff"');
      expect(source, file).not.toContain("stroke={selected ? '#fff'");
      expect(source, file).not.toContain('stroke="rgba(255,255,255');
    }
    const handle = css.match(/\.end-handle circle\s*\{[^}]*\}/)?.[0] ?? '';
    expect(handle).toContain('stroke');
    expect(handle).not.toContain('stroke: #fff');
  });

  it('draws light rings and strip outlines in the line colour', () => {
    const source = read('../components/Shapes.tsx');
    expect(source).not.toContain('rgba(255,255,255,0.55)');
    expect(source).not.toContain('rgba(255,255,255,0.4)');
    expect(source).toContain("stroke: 'var(--plan-line)'");
    expect(css).toMatch(/--plan-line:\s*color-mix\(in srgb, var\(--text\) 55%/);
  });

  it('draws the string light wire in the line colour', () => {
    expect(read('../components/Shapes.tsx')).not.toContain('stroke="rgba(255,255,255,0.35)"');
  });

  it('keeps the scene thumbnails a dark room', () => {
    expect(read('../views/ScenesView.tsx')).toContain("'#15131f'");
  });
});
