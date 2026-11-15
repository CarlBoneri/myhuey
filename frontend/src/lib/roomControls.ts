// The room's master dimmer: what it shows and when it appears.
import type { BridgeLight, Preferences, Room } from '../types';

/** Average brightness (1-100 %) of the room's lights that are on, or null when none is on. */
export function roomBrightness(room: Room, lights: Record<string, BridgeLight>): number | null {
  const on = room.lights.map((p) => lights[p.light_id]).filter((l): l is BridgeLight => !!l && l.on);
  if (!on.length) return null;
  const average = on.reduce((sum, l) => sum + (l.brightness ?? 254), 0) / on.length;
  return Math.max(1, Math.round((average / 254) * 100));
}

/** Whether the room gets a brightness slider, per the preferences. */
export function showRoomSlider(prefs: Pick<Preferences, 'room_sliders' | 'room_sliders_when_on_only'>, room: Room, lights: Record<string, BridgeLight>): boolean {
  if (!prefs.room_sliders) return false;
  if (!room.lights.some((p) => lights[p.light_id])) return false;
  return !prefs.room_sliders_when_on_only || roomBrightness(room, lights) !== null;
}
