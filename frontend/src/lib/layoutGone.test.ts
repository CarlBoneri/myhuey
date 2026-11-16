import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onLayoutGone, setOpenLayout } from '../api';

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  setOpenLayout(null);
  onLayoutGone(null);
  vi.unstubAllGlobals();
});

describe('a sandbox deleted elsewhere', () => {
  it('reports it once from any call, then still throws', async () => {
    vi.stubGlobal('fetch', answer(404, { detail: 'That layout no longer exists' }));
    const gone = vi.fn();
    onLayoutGone(gone);
    setOpenLayout('s1');
    await expect(api.lights()).rejects.toThrow('That layout no longer exists');
    await expect(api.rooms()).rejects.toThrow();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('ignores the same 404 when no sandbox is open', async () => {
    vi.stubGlobal('fetch', answer(404, { detail: 'That layout no longer exists' }));
    const gone = vi.fn();
    onLayoutGone(gone);
    await expect(api.rooms()).rejects.toThrow();
    expect(gone).not.toHaveBeenCalled();
  });
});
