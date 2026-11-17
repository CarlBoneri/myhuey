// What the plan and the 3D view draw while a lighting card is being shown: the live lights with
// the card's results laid over them. Pure; nothing here touches a light.
import type { BridgeLight, SceneResult } from '../types';
import { useMemo } from 'react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { kelvinToHex } from './color';

type ShowingState = ReturnType<typeof useUi.getState>['showing'];

const toBridge = (percent: number, on: boolean): number => (on ? Math.max(1, Math.round((percent / 100) * 254)) : 1);

export function shownLights(live: Record<string, BridgeLight>, showing: SceneResult[] | null): Record<string, BridgeLight> {
  if (!showing) return live;
  const out = { ...live };
  for (const result of showing) {
    const base = live[result.light_id];
    if (!base) continue;
    const color = result.color ?? (result.color_temp ? kelvinToHex(result.color_temp) : base.color);
    out[result.light_id] = {
      ...base,
      on: result.on,
      brightness: result.on ? toBridge(result.brightness, true) : base.brightness,
      color,
      color_temp: result.color_temp ?? base.color_temp,
      gradient: result.gradient?.length
        ? { modes: [], points_capable: result.gradient.length, pixel_count: 0, ...base.gradient, mode: result.mode ?? base.gradient?.mode ?? 'interpolated_palette', points: result.gradient }
        : null,
    };
  }
  return out;
}

/** Each light's level in percent (0-100), the unit glare limits are written in. The bridge's 1-254 is converted here. */
export function shownLevels(lights: Record<string, BridgeLight>): Record<string, { on: boolean; brightness: number }> {
  const out: Record<string, { on: boolean; brightness: number }> = {};
  for (const [id, light] of Object.entries(lights)) {
    out[id] = { on: light.on && light.reachable, brightness: Math.round(((light.brightness ?? 254) / 254) * 100) };
  }
  return out;
}

export function glareBadge(overCount: number, watchCount: number): string {
  if (!overCount && !watchCount) return 'No glare risk';
  return `${overCount} over the limit · ${watchCount} to watch`;
}

/** The lights to draw for a room: the live ones, or the card being shown while it is for this room. */
export function useDrawnLights(room: string): { lights: Record<string, BridgeLight>; showing: ShowingState } {
  const live = useStore((state) => state.lights);
  const showing = useUi((state) => state.showing);
  const mine = showing && showing.room === room ? showing : null;
  const lights = useMemo(() => shownLights(live, mine?.results ?? null), [live, mine]);
  return { lights, showing: mine };
}
