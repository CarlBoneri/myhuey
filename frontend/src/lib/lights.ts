// How a placed light is drawn: its physical profile and effective length.
import type { BridgeLight, Placement, Profile, ProfileTable } from '../types';

export function placedProfile(placement: Placement, bridge: BridgeLight | undefined, table: ProfileTable | null): Profile {
  if (bridge?.profile) return bridge.profile;
  const fallback: Profile = table?.default ?? {
    kind: 'round', length: 15, width: 15, icon: 'bulb-classic', gradient: false, adjustable: false, linear: false, label: 'Light',
  };
  if (!table) return fallback;
  const { archetype = '', productname = '', modelid = '' } = placement.product || {};
  return table.model[modelid] ?? table.product[productname.trim().toLowerCase()] ?? table.archetype[archetype.toLowerCase()] ?? fallback;
}

export function effectiveLength(placement: Placement, profile: Profile): number {
  return placement.length && profile.adjustable ? placement.length : profile.length;
}

/** The colors a light shows along its length right now: its gradient points when it has
 * them, else its single color. Null when it is off or unreachable. */
export function liveColors(light: BridgeLight | undefined): string[] | null {
  const color = liveColor(light);
  if (!color) return null;
  const points = light?.gradient?.points ?? [];
  return points.length > 1 ? points : [color];
}

/** The light's color as the UI should paint it: off is dark, on uses its live color. */
export function liveColor(light: BridgeLight | undefined): string | null {
  if (!light || !light.on || !light.reachable) return null;
  return light.color ?? '#fff4dc';
}

/**
 * Light IDs grouped by the rooms they are placed in, in room order. A light placed in
 * several rooms appears under each; lights placed nowhere come last, as "Not placed".
 */
export function groupLightsByRoom(
  lightIds: string[],
  rooms: { name: string; lights: { light_id: string }[] }[],
): [string, string[]][] {
  const known = new Set(lightIds);
  const groups: [string, string[]][] = rooms
    .map((room): [string, string[]] => [room.name, room.lights.map((l) => l.light_id).filter((id) => known.has(id))])
    .filter(([, ids]) => ids.length > 0);
  const placed = new Set(groups.flatMap(([, ids]) => ids));
  const unplaced = lightIds.filter((id) => !placed.has(id));
  if (unplaced.length) groups.push(['Not placed', unplaced]);
  return groups;
}

export interface GradientSetting { colors: string[]; mode: string; effect?: string | null }
export type LightWrite = { type: 'gradient'; colors: string[]; mode: string } | { type: 'effect'; effect: string };

/**
 * The writes that move a gradient light from `sent` to `next`, in order. On the bridge an
 * effect clears the gradient points and a gradient cancels the effect, so: a new effect is
 * sent alone; stopping an effect is done by sending the gradient (which also restores the
 * colors); color or mode edits made while an effect runs wait until it stops.
 */
export function lightWrites(sent: GradientSetting, next: GradientSetting): LightWrite[] {
  const effect = next.effect ?? 'no_effect';
  const wasEffect = sent.effect ?? 'no_effect';
  if (effect !== 'no_effect') return effect !== wasEffect ? [{ type: 'effect', effect }] : [];
  const gradientChanged = next.colors.join() !== sent.colors.join() || next.mode !== sent.mode;
  if (gradientChanged || wasEffect !== 'no_effect') return [{ type: 'gradient', colors: next.colors, mode: next.mode }];
  return [];
}

/**
 * Sends gradient and effect changes to one light, one write at a time. Each round compares
 * the latest wanted setting with what was last sent, so a change made while a write is in
 * flight is never lost and writes never land out of order. `reset` records a setting read
 * back from the bridge as already sent.
 */
export function createLightWriter(send: (write: LightWrite) => Promise<void>, initial: GradientSetting) {
  let sent = initial;
  let wanted = initial;
  let running: Promise<void> | null = null;

  const run = async () => {
    while (true) {
      const target = wanted;
      const writes = lightWrites(sent, target);
      if (!writes.length) {
        sent = target;
        if (wanted === target) return;
        continue;
      }
      for (const write of writes) await send(write);
      sent = target;
      if (wanted === target) return;
    }
  };

  return {
    push(next: GradientSetting): Promise<void> {
      wanted = next;
      if (!running) {
        running = run().finally(() => { running = null; });
      }
      return running;
    },
    reset(value: GradientSetting) {
      if (!running) sent = wanted = value;
    },
  };
}
