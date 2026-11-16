import { describe, expect, it } from 'vitest';
import { groupState, pick, pickAll } from './selection';
import type { BridgeLight } from '../types';

describe('picking lights', () => {
  it('a plain click selects just that light; a modifier click adds or removes it', () => {
    expect(pick(['a', 'b'], 'c', false)).toEqual(['c']);
    expect(pick(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c']);
    expect(pick(['a', 'b'], 'a', true)).toEqual(['b']);
  });
  it('selects a whole room, or clears it when the room is already all selected', () => {
    expect(pickAll(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(pickAll(['a', 'b', 'c'], ['b', 'c'])).toEqual(['a']);
    expect(pickAll(['b'], ['b', 'c'])).toEqual(['b', 'c']);
  });
});

describe('a group of lights', () => {
  const light = (on: boolean, brightness: number | null, color = false, ct = false) =>
    ({ on, brightness, supports_color: color, supports_color_temp: ct }) as BridgeLight;
  it('averages the brightness of the lights that are on and says what any of them can do', () => {
    expect(groupState([light(true, 254, true), light(true, 128, false, true), light(false, 10)])).toEqual({
      count: 3, on: 2, brightness: 191, dimmable: true, color: true, colorTemp: true,
    });
  });
  it('has no brightness when all are off, and nothing to dim without dimmable lights', () => {
    expect(groupState([light(false, 100), light(false, null)])).toMatchObject({ on: 0, brightness: null, dimmable: true });
    expect(groupState([light(true, null)])).toMatchObject({ dimmable: false, brightness: null });
  });
});
