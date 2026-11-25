import { describe, expect, it } from 'vitest';
import { SIDEBAR_WIDTH, inspectorAfterDrag, shouldScrollOnFold, sidebarAfterDrag, splitAfterDrag, unfoldForLighting } from './paneDrag';

describe('splitAfterDrag', () => {
  it('does not jump when the bar is pressed and not moved', () => {
    expect(splitAfterDrag(0.62, 400, 400, 800)).toBeCloseTo(0.62);
  });
  it('moves by the distance dragged over the column height', () => {
    expect(splitAfterDrag(0.5, 400, 480, 800)).toBeCloseTo(0.6);
  });
  it('clamps at both ends', () => {
    expect(splitAfterDrag(0.5, 400, 5000, 800)).toBe(0.85);
    expect(splitAfterDrag(0.5, 400, -5000, 800)).toBe(0.2);
  });
});

describe('inspectorAfterDrag', () => {
  it('grows as the pointer moves left', () => {
    expect(inspectorAfterDrag(380, 1000, 900)).toBe(480);
  });
  it('clamps at both ends', () => {
    expect(inspectorAfterDrag(380, 1000, 0)).toBe(680);
    expect(inspectorAfterDrag(380, 1000, 5000)).toBe(280);
  });
});

describe('shouldScrollOnFold', () => {
  it('scrolls only when the click folds the glare table in a narrow window', () => {
    expect(shouldScrollOnFold(true, true)).toBe(true);
    expect(shouldScrollOnFold(false, true)).toBe(false);
    expect(shouldScrollOnFold(true, false)).toBe(false);
    expect(shouldScrollOnFold(false, false)).toBe(false);
  });
});

describe('unfoldForLighting', () => {
  const sizes = (inspector: boolean) => ({ split: 0.6, inspector: 380, collapsed: { view: false, audit: true, inspector } });
  it('unfolds a folded inspector when the lighting panel opens, and leaves the other panes alone', () => {
    expect(unfoldForLighting(sizes(true), true)).toEqual(sizes(false));
  });
  it('changes nothing when the panel is closed or the inspector is already open', () => {
    const folded = sizes(true);
    expect(unfoldForLighting(folded, false)).toBe(folded);
    const open = sizes(false);
    expect(unfoldForLighting(open, true)).toBe(open);
  });
});

describe('sidebarAfterDrag', () => {
  it('widens the sidebar when its bar moves left, and narrows it moving right', () => {
    expect(sidebarAfterDrag(360, 800, 700)).toBe(460);
    expect(sidebarAfterDrag(360, 800, 840)).toBe(320);
  });
  it('keeps the sidebar between its narrowest and widest', () => {
    expect(sidebarAfterDrag(360, 800, 0)).toBe(SIDEBAR_WIDTH.max);
    expect(sidebarAfterDrag(360, 800, 2000)).toBe(SIDEBAR_WIDTH.min);
    expect(SIDEBAR_WIDTH).toEqual({ min: 280, max: 760, initial: 360 });
  });
});
