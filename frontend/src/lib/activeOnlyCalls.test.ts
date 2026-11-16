import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setOpenLayout } from '../api';
import { LAYOUT_HEADER } from './layout';

afterEach(() => { vi.unstubAllGlobals(); setOpenLayout(null); });

function record() {
  const sent: (string | undefined)[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    sent.push((init.headers as Record<string, string>)[LAYOUT_HEADER]);
    return new Response('[]', { status: 200 });
  }));
  return sent;
}

describe('home-screen calls skip the open sandbox', () => {
  it('sends the sandbox only when the call is not Active-only', async () => {
    setOpenLayout('sb');
    const sent = record();
    const scene = { id: 's' } as never;
    await api.applyScene('x', true);
    await api.applyScene('x');
    await api.suggest('Office', { mode: 'code' }, true);
    await api.suggest('Office', { mode: 'code' });
    await api.applySuggestion('Office', scene, true);
    await api.applySuggestion('Office', scene);
    await api.scenes(true);
    await api.scenes();
    expect(sent).toEqual([undefined, 'sb', undefined, 'sb', undefined, 'sb', undefined, 'sb']);
  });
});
