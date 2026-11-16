// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '../test/dom';
import { NARROW_QUERY } from './tabs';
import { useNarrow } from './useNarrow';

function Probe() { return <span data-testid="narrow">{String(useNarrow())}</span>; }

// A matchMedia whose answer can be flipped and whose `change` listeners can be fired.
function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  return { matchMedia, flip: (matches: boolean) => { query.matches = matches; listeners.forEach((fn) => fn()); } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('useNarrow', () => {
  it('follows the window as it crosses the narrow width', () => {
    const media = stubMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('narrow').textContent).toBe('true');
    act(() => media.flip(false));
    expect(screen.getByTestId('narrow').textContent).toBe('false');
  });
  it('asks with the shared query', () => {
    const media = stubMedia(false);
    render(<Probe />);
    expect(media.matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
  });
});
