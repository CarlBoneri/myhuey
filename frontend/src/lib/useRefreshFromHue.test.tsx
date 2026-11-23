// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from '../test/dom';
import { ApiError, api } from '../api';
import { useStore } from '../store';
import type { RefreshPlan } from '../types';
import { useRefreshFromHue } from './useRefreshFromHue';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { refreshPreview: vi.fn(), refreshApply: vi.fn() },
}));

const plan = (fingerprint: string, room = 'Office'): RefreshPlan => ({
  fingerprint,
  rooms: [{ room, hue_room: '1', hue_name: room, status: 'changed', arrive: [], leave: [], link: false }],
});

const toast = vi.fn();
const refreshRooms = vi.fn(async () => {});

beforeEach(() => {
  vi.mocked(api.refreshPreview).mockReset();
  vi.mocked(api.refreshApply).mockReset();
  toast.mockClear();
  refreshRooms.mockClear();
  useStore.setState({ layout: null, toast, refreshRooms } as never);
});

describe('useRefreshFromHue', () => {
  it('applies the preview it holds, then drops it', async () => {
    vi.mocked(api.refreshPreview).mockResolvedValueOnce(plan('a'));
    vi.mocked(api.refreshApply).mockResolvedValueOnce(plan('a'));
    const { result } = renderHook(() => useRefreshFromHue());
    await act(() => result.current.preview());
    await act(() => result.current.apply());
    expect(api.refreshApply).toHaveBeenCalledWith('a');
    expect(toast).toHaveBeenCalledWith('Refreshed Office', false);
    expect(refreshRooms).toHaveBeenCalledTimes(1);
    expect(result.current.plan).toBeNull();
  });

  it('shows a fresh preview when Hue changed since the last one (409)', async () => {
    vi.mocked(api.refreshPreview).mockResolvedValueOnce(plan('a')).mockResolvedValueOnce(plan('b', 'Den'));
    vi.mocked(api.refreshApply).mockRejectedValueOnce(new ApiError('The Hue rooms changed since the preview. Look again before applying.', 409));
    const { result } = renderHook(() => useRefreshFromHue());
    await act(() => result.current.preview());
    await act(() => result.current.apply());
    expect(toast).toHaveBeenCalledWith('The Hue rooms changed since the preview. Look again before applying.', true);
    expect(result.current.plan?.fingerprint).toBe('b');
    expect(result.current.busy).toBe(false);
    expect(refreshRooms).not.toHaveBeenCalled();
  });

  it('keeps the preview on another failure', async () => {
    vi.mocked(api.refreshPreview).mockResolvedValueOnce(plan('a'));
    vi.mocked(api.refreshApply).mockRejectedValueOnce(new ApiError('The bridge did not answer', 502));
    const { result } = renderHook(() => useRefreshFromHue());
    await act(() => result.current.preview());
    await act(() => result.current.apply());
    expect(api.refreshPreview).toHaveBeenCalledTimes(1);
    expect(result.current.plan?.fingerprint).toBe('a');
  });

  it('drops the preview when another layout is opened', async () => {
    vi.mocked(api.refreshPreview).mockResolvedValueOnce(plan('a'));
    const { result } = renderHook(() => useRefreshFromHue());
    await act(() => result.current.preview());
    expect(result.current.plan).not.toBeNull();
    act(() => useStore.setState({ layout: 'sandbox-1' }));
    expect(result.current.plan).toBeNull();
  });

  it('does not show a preview that comes back after another layout was opened', async () => {
    let answer: (value: RefreshPlan) => void = () => {};
    vi.mocked(api.refreshPreview).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useRefreshFromHue());
    let asked: Promise<void> = Promise.resolve();
    act(() => { asked = result.current.preview(); });
    act(() => useStore.setState({ layout: 'sandbox-1' }));
    await act(async () => { answer(plan('a')); await asked; });
    expect(result.current.plan).toBeNull();
  });

  it('Cancel drops the preview', async () => {
    vi.mocked(api.refreshPreview).mockResolvedValueOnce(plan('a'));
    const { result } = renderHook(() => useRefreshFromHue());
    await act(() => result.current.preview());
    act(() => result.current.cancel());
    expect(result.current.plan).toBeNull();
  });
});
