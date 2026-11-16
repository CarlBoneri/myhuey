import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import type { LightGroup } from '../types';

afterEach(() => vi.unstubAllGlobals());

const group = (id: string, name: string, look: LightGroup['look'] = null): LightGroup => ({ id, name, lights: ['1'], look });

describe('saved groups in the store', () => {
  it('keeps a group made while a slow look save is still running', async () => {
    let finishLook: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('/look')) {
        await new Promise<void>((resolve) => { finishLook = resolve; });
        return new Response(JSON.stringify(group('a', 'A', { 1: { on: false } })), { status: 200 });
      }
      if (init.method === 'POST') return new Response(JSON.stringify(group('b', 'B')), { status: 200 });
      return new Response('[]', { status: 200 });
    }));
    useStore.setState({ groups: [group('a', 'A')] });
    const saving = useStore.getState().saveGroupLook('a');
    await useStore.getState().createGroup('B', ['1']);
    finishLook!();
    await saving;
    expect(useStore.getState().groups.map((g) => [g.id, !!g.look])).toEqual([['a', true], ['b', false]]);
  });

  it('drops a deleted group without touching the others', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    useStore.setState({ groups: [group('a', 'A'), group('b', 'B')] });
    await useStore.getState().deleteGroup('a');
    expect(useStore.getState().groups.map((g) => g.id)).toEqual(['b']);
  });
});
