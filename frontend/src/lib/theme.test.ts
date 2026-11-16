import { describe, expect, it } from 'vitest';
import { resolveTheme, toggledTheme } from './theme';

describe('theme', () => {
  it('follows the system when asked', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });
  it('keeps an explicit choice', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
  it('toggles to the opposite of what is showing', () => {
    expect(toggledTheme('system', true)).toBe('light');
    expect(toggledTheme('light', true)).toBe('dark');
  });
});
