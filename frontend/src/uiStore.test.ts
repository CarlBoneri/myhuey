// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('the lighting panel flag', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  it('starts closed and is remembered across a reload', async () => {
    const first = (await import('./uiStore')).useUi;
    expect(first.getState().lightingOpen).toBe(false);
    first.getState().setLightingOpen(true);
    vi.resetModules();
    const second = (await import('./uiStore')).useUi;
    expect(second.getState().lightingOpen).toBe(true);
    second.getState().setLightingOpen(false);
    vi.resetModules();
    expect((await import('./uiStore')).useUi.getState().lightingOpen).toBe(false);
  });
});
