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

describe('sidebar widths', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  it('remembers each sidebar width across a reload, and forgets it on reset', async () => {
    const first = (await import('./uiStore')).useUi;
    expect(first.getState().sidebarWidths).toEqual({});
    first.getState().setSidebarWidth('designer', 520);
    vi.resetModules();
    const second = (await import('./uiStore')).useUi;
    expect(second.getState().sidebarWidths).toEqual({ designer: 520 });
    second.getState().setSidebarWidth('designer', null);
    vi.resetModules();
    expect((await import('./uiStore')).useUi.getState().sidebarWidths).toEqual({});
  });
  it('ignores a stored width that is not a number', async () => {
    localStorage.setItem('myhuey.sidebars', JSON.stringify({ designer: 'wide', scenes: 400 }));
    expect((await import('./uiStore')).useUi.getState().sidebarWidths).toEqual({ scenes: 400 });
  });
});
