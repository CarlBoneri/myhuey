// What the plan and the 3D view draw while a lighting card is being shown: the live lights with
// the card's results laid over them. Pure; nothing here touches a light.
import type { BridgeLight, SceneResult } from '../types';
import { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { kelvinToHex } from './color';

type ShowingState = ReturnType<typeof useUi.getState>['showing'];

const toBridge = (percent: number): number => Math.max(1, Math.round((percent / 100) * 254));

export function shownLights(live: Record<string, BridgeLight>, showing: SceneResult[] | null): Record<string, BridgeLight> {
  if (!showing) return live;
  const out = { ...live };
  for (const result of showing) {
    const base = live[result.light_id] ?? planned(result);
    const color = result.color ?? (result.color_temp ? kelvinToHex(result.color_temp) : base.color);
    out[result.light_id] = {
      ...base,
      on: result.on,
      brightness: result.on ? toBridge(result.brightness) : base.brightness,
      color,
      color_temp: result.color_temp ?? base.color_temp,
      gradient: result.gradient?.length
        ? { modes: [], points_capable: result.gradient.length, pixel_count: 0, ...base.gradient, mode: result.mode ?? base.gradient?.mode ?? 'interpolated_palette', points: result.gradient }
        : null,
    };
  }
  return out;
}

/** A planned light has no bridge entry; a shown result gets a neutral record so it can be drawn. */
function planned(result: SceneResult): BridgeLight {
  return {
    id: result.light_id, name: result.label, type: 'planned', on: true, reachable: true, brightness: 254, color: null, color_temp: null,
    supports_color: true, supports_color_temp: true, archetype: '', productname: '', modelid: '', gradient_points: 0,
    profile: { kind: 'round', length: 15, width: 15, icon: 'bulb-classic', gradient: false, adjustable: false, linear: false, label: 'Planned light' },
    gradient: null, effect: null,
  };
}

/** Fix glare dims real lights, so it waits while a card is being shown. */
export function fixGlareState(showing: boolean, toDimCount: number): { disabled: boolean; title: string } {
  if (showing) return { disabled: true, title: 'Fix glare changes your real lights. Show live first.' };
  return {
    disabled: !toDimCount,
    title: toDimCount ? 'Lowers only the lit lights that are over their limit. Nothing is brightened.' : 'No lit light is over its limit right now.',
  };
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

/** Stops showing a card, if one is being shown for this room. */
export function dropShowing(room: string): void {
  const now = useUi.getState().showing;
  if (now && now.room === room) useUi.getState().setShowing(null);
}

/**
 * For the screen that holds the lighting panel: what is shown ends when the room changes, when the
 * panel closes (`open` false), and when the screen goes. Switching views inside the screen keeps it.
 */
export function useShowingFor(room: string, open: boolean): void {
  useEffect(() => () => dropShowing(room), [room]);
  useEffect(() => { if (!open) dropShowing(room); }, [open, room]);
}
