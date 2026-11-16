import { describe, expect, it } from 'vitest';
import { inspectorAfterDrag, shouldScrollOnFold, splitAfterDrag } from './paneDrag';

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
