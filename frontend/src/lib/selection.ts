// Picking several lights on the Lights tab, and what the picked group looks like together.
import type { BridgeLight } from '../types';

/** A plain click picks just `id`; with a modifier (Cmd, Ctrl, Shift, or the checkbox) it toggles `id`. */
export function pick(selected: string[], id: string, additive: boolean): string[] {
  if (!additive) return [id];
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/** Add every light in a room, or take them all out when every one is already picked. */
export function pickAll(selected: string[], ids: string[]): string[] {
  if (ids.every((id) => selected.includes(id))) return selected.filter((item) => !ids.includes(item));
  return [...selected, ...ids.filter((id) => !selected.includes(id))];
}

/** The group's state: how many are on, their average brightness (1-254, lights that are on and
 * dimmable only), and whether any light can dim, take a color, or take a white temperature. */
export function groupState(lights: BridgeLight[]) {
  const lit = lights.filter((light) => light.on);
  const levels = lit.map((light) => light.brightness).filter((value): value is number => value !== null);
  return {
    count: lights.length,
    on: lit.length,
    brightness: levels.length ? Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length) : null,
    dimmable: lights.some((light) => light.brightness !== null),
    color: lights.some((light) => light.supports_color),
    colorTemp: lights.some((light) => light.supports_color_temp),
  };
}

/** Whether two lists name the same lights, whatever the order or repeats. */
export function sameLights(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}
