import { describe, expect, it } from 'vitest';
import { href, parseRoute } from './router';

describe('plan route', () => {
  it('opens the floor plan, optionally with a room selected for reshaping', () => {
    expect(parseRoute('#/plan')).toEqual({ view: 'plan' });
    expect(parseRoute('#/plan/Living%20room')).toEqual({ view: 'plan', room: 'Living room' });
    expect(href({ view: 'plan', room: 'Living room' })).toBe('#/plan/Living%20room');
    expect(href({ view: 'plan' })).toBe('#/plan');
  });
});
