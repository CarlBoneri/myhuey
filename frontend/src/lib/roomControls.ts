// The room's master dimmer: what it shows and when it appears.
import type { BridgeLight, Preferences, Room } from '../types';
import { liveColors } from './lights';

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

/** The level to send for a slider value, or null when it would not change the room
 * (the same whole percent, e.g. a Tab keyup, or every light is off). */
export function brightnessToSend(value: number, live: number | null): number | null {
  if (live === null) return null;
  const level = Math.round(value);
  return level === live ? null : level;
}

/** What a room tile shows: how many of its lights the bridge knows and has on, the room's
 * brightness, and up to five distinct live colors as chips. */
export function roomSummary(room: Room, lights: Record<string, BridgeLight>): { known: number; on: number; brightness: number | null; chips: string[] } {
  const known = room.lights.map((p) => lights[p.light_id]).filter((l): l is BridgeLight => !!l);
  const chips = [...new Set(known.flatMap((light) => liveColors(light) ?? []))].slice(0, 5);
  return { known: known.length, on: known.filter((l) => l.on).length, brightness: roomBrightness(room, lights), chips };
}
