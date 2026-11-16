import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOpenLayout } from '../api';
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

describe('a ?layout= link', () => {
  const home = { id: 'home', name: 'My home', active: true, rooms: 1, scenes: 0, updated: null };
  const office = { id: 'office', name: 'Office idea', active: false, rooms: 1, scenes: 0, updated: null };

  /** Load the app from `?layout=<id>` against a server holding `layouts`; returns the layouts each request asked for. */
  async function loadFrom(id: string, layouts: unknown[]) {
    const sent: (string | null)[] = [];
    vi.stubGlobal('location', { search: `?layout=${id}`, href: `http://127.0.0.1:8000/static/app/?layout=${id}#/studio` });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const layout = new Headers(init?.headers).get('X-Myhuey-Layout');
      sent.push(layout);
      if (layout && !layouts.some((item) => (item as { id: string }).id === layout)) {
        return new Response(JSON.stringify({ detail: 'That layout no longer exists' }), { status: 404 });
      }
      const body = path.startsWith('/api/layouts') ? layouts : path === '/api/setup/status' ? { configured: false } : path === '/api/health' ? { api: 99 } : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    setOpenLayout(null);
    useStore.setState({ layout: null, layouts: [], toasts: [] });
    await useStore.getState().load();
    return sent;
  }

  afterEach(() => {
    setOpenLayout(null);
    useStore.getState().toasts.forEach((toast) => useStore.getState().dismiss(toast.id));
  });

  it('opens a sandbox that still is one', async () => {
    await loadFrom('office', [home, office]);
    expect(useStore.getState().layout).toBe('office');
  });

  it('stays on the active home when that sandbox has since been made active, and says so', async () => {
    const sent = await loadFrom('home', [{ ...home, id: 'home' }]);
    const { layout, toasts } = useStore.getState();
    expect(layout).toBeNull();
    expect(sent.every((header) => header === null)).toBe(true);
    expect(toasts).toEqual([{ id: expect.any(Number), message: '"My home" is now your active home, so that is what is open.', error: false }]);
  });

  it('still reports a sandbox that is gone', async () => {
    await loadFrom('deleted', [home]);
    const { layout, toasts } = useStore.getState();
    expect(layout).toBeNull();
    expect(toasts.map((toast) => toast.message)).toEqual(["That sandbox was deleted, so you're back on your active layout."]);
  });
});
