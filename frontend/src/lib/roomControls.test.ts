import { describe, expect, it } from 'vitest';
import { roomBrightness, showRoomSlider } from './roomControls';
import type { BridgeLight, Preferences, Room } from '../types';

const light = (id: string, on: boolean, brightness: number | null) => ({ id, on, brightness }) as BridgeLight;
const room = { lights: [{ light_id: '1' }, { light_id: '2' }, { light_id: '3' }, { light_id: '9' }] } as Room;
const lights = { 1: light('1', true, 254), 2: light('2', true, 127), 3: light('3', false, 254) };
const prefs = { room_sliders: true, room_sliders_when_on_only: true } as Preferences;

describe('room brightness slider', () => {
  it('shows the average brightness of the lights that are on, as a percent', () => {
    expect(roomBrightness(room, lights)).toBe(75);
    expect(roomBrightness(room, { 3: light('3', false, 254) })).toBeNull();
    expect(roomBrightness(room, { 1: light('1', true, null) })).toBe(100);
  });
  it('appears per the preferences', () => {
    expect(showRoomSlider(prefs, room, lights)).toBe(true);
    expect(showRoomSlider(prefs, room, { 3: light('3', false, 254) })).toBe(false);
    expect(showRoomSlider({ ...prefs, room_sliders_when_on_only: false }, room, { 3: light('3', false, 254) })).toBe(true);
    expect(showRoomSlider({ ...prefs, room_sliders_when_on_only: false }, room, {})).toBe(false); // no lights on the bridge
    expect(showRoomSlider({ ...prefs, room_sliders: false }, room, lights)).toBe(false);
  });
});
