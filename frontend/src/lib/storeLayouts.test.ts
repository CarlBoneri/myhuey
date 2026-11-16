import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';

afterEach(() => vi.unstubAllGlobals());

describe('layout counts', () => {
  it('refresh with the rooms, so the Layouts panel never shows a stale room count', async () => {
    const layouts = [{ id: 'a', name: 'My home', active: true, rooms: 2, scenes: 0, updated: null }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) =>
      new Response(JSON.stringify(path.startsWith('/api/layouts') ? layouts : []), { status: 200 })));
    useStore.setState({ layouts: [{ ...layouts[0], rooms: 1 }] });
    await useStore.getState().refreshRooms();
    expect(useStore.getState().layouts[0].rooms).toBe(2);
  });
});
