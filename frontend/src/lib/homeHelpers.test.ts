import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomBrightness, roomSummary } from './roomControls';
import { traceHint } from './trace';
import { readQuickMode, storeQuickMode } from './suggest';
import type { BridgeLight, Room } from '../types';

afterEach(() => vi.unstubAllGlobals());

const bulb = (on: boolean, color: string | null, points?: string[]) =>
  ({ on, reachable: true, brightness: 200, color, gradient: points ? { points } : null }) as unknown as BridgeLight;

describe('room summary for a tile', () => {
  const room = { lights: [{ light_id: '1' }, { light_id: '2' }, { light_id: '3' }, { light_id: '9' }] } as Room;
  it('counts known and lit lights and lists distinct live colors', () => {
    const lights = { 1: bulb(true, '#ff0000'), 2: bulb(true, '#a', ['#a', '#b']), 3: bulb(false, '#00ff00') };
    expect(roomSummary(room, lights)).toEqual({ known: 3, on: 2, brightness: roomBrightness(room, lights), chips: ['#ff0000', '#a', '#b'] });
  });
  it('has no brightness or chips when everything is off', () => {
    const lights = { 1: bulb(false, '#ff0000'), 2: bulb(false, null) };
    expect(roomSummary(room, lights)).toEqual({ known: 2, on: 0, brightness: null, chips: [] });
  });
  it('keeps at most five chips', () => {
    const many = { lights: ['1', '2', '3'].map((light_id) => ({ light_id })) } as Room;
    const lights = { 1: bulb(true, '#1', ['#1', '#2', '#3']), 2: bulb(true, '#4', ['#4', '#5']), 3: bulb(true, '#6') };
    expect(roomSummary(many, lights).chips).toEqual(['#1', '#2', '#3', '#4', '#5']);
  });
});

describe('trace hint', () => {
  it('explains a failed trace and says nothing otherwise', () => {
    expect(traceHint(null)).toBeNull();
    expect(traceHint({ ok: true })).toBeNull();
    expect(traceHint({ ok: false, reason: 'leak' })).toContain('Close door gaps');
    expect(traceHint({ ok: false, reason: 'wall' })).toContain('wall');
  });
});

describe('quick settings mode', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it('remembers a known mode', () => {
    vi.stubGlobal('localStorage', memory());
    storeQuickMode('relax');
    expect(readQuickMode()).toBe('relax');
  });
  it('falls back to code for an unknown value or blocked storage', () => {
    const store = memory();
    store.setItem('myhuey.quickMode', 'toString');
    vi.stubGlobal('localStorage', store);
    expect(readQuickMode()).toBe('code');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readQuickMode()).toBe('code');
    expect(() => storeQuickMode('read')).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(readQuickMode()).toBe('code');
  });
});
