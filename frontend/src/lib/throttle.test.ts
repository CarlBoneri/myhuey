import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttleLatest } from './throttle';

afterEach(() => vi.useRealTimers());

describe('throttleLatest', () => {
  it('sends the first value at once, then at most one value per window: the latest', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const send = throttleLatest((v: number) => sent.push(v), 200);
    send(1); send(2); send(3); send(4);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([1, 4]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1, 4]);
  });
  it('flush sends a waiting value now and nothing twice', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const send = throttleLatest((v: number) => sent.push(v), 200);
    send(1); send(9);
    send.flush();
    expect(sent).toEqual([1, 9]);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1, 9]);
  });
});
