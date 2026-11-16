import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac, isResizePress } from './pointer';

describe('isResizePress', () => {
  it('accepts the main button', () => expect(isResizePress({ button: 0, ctrlKey: false }, true)).toBe(true));
  it('rejects the right button', () => expect(isResizePress({ button: 2, ctrlKey: false }, false)).toBe(false));
  it('rejects the middle button', () => expect(isResizePress({ button: 1, ctrlKey: false }, false)).toBe(false));
  it('rejects Ctrl+click on a Mac, where it is a right-click', () => expect(isResizePress({ button: 0, ctrlKey: true }, true)).toBe(false));
  it('accepts Ctrl+click elsewhere', () => expect(isResizePress({ button: 0, ctrlKey: true }, false)).toBe(true));
});

describe('isMac', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is true for a Mac navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isMac()).toBe(true);
  });
  it('is false for a Windows navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(isMac()).toBe(false);
  });
  it('prefers userAgentData.platform over navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgentData: { platform: 'macOS' } });
    expect(isMac()).toBe(true);
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgentData: { platform: 'Windows' } });
    expect(isMac()).toBe(false);
  });
});
