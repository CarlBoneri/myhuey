import { describe, expect, it } from 'vitest';
import { isMac, isResizePress } from './pointer';

describe('isResizePress', () => {
  it('accepts the main button', () => expect(isResizePress({ button: 0, ctrlKey: false }, true)).toBe(true));
  it('rejects the right button', () => expect(isResizePress({ button: 2, ctrlKey: false }, false)).toBe(false));
  it('rejects the middle button', () => expect(isResizePress({ button: 1, ctrlKey: false }, false)).toBe(false));
  it('rejects Ctrl+click on a Mac, where it is a right-click', () => expect(isResizePress({ button: 0, ctrlKey: true }, true)).toBe(false));
  it('accepts Ctrl+click elsewhere', () => expect(isResizePress({ button: 0, ctrlKey: true }, false)).toBe(true));
});

describe('isMac', () => {
  it('is false when there is no navigator', () => expect(typeof navigator === 'undefined' ? isMac() : false).toBe(false));
});
