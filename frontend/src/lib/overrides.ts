/** Pure helpers for a scene's per-light override: white (kelvin) or colors, never both. */
import type { LightOverride } from '../types';

export const WHITE_MIN = 2000; // the range scenes accept (scenes.WHITE_RANGE)
export const WHITE_MAX = 6500;
export const WHITE_STEP = 100;
export const DEFAULT_WHITE = 4000;

export function clampKelvin(kelvin: number | null | undefined): number {
  if (kelvin == null || Number.isNaN(kelvin)) return DEFAULT_WHITE;
  return Math.min(WHITE_MAX, Math.max(WHITE_MIN, Math.round(kelvin / WHITE_STEP) * WHITE_STEP));
}

/** The override as white light at `kelvin`: its colors and gradient mode go. */
export function withWhite(override: LightOverride, kelvin: number): LightOverride {
  const { colors: _colors, mode: _mode, ...rest } = override;
  return { ...rest, white: kelvin };
}

/** The override with these colors (and gradient mode, if given): any white goes, so the switch is visible. */
export function withColors(override: LightOverride, colors: string[], mode?: string): LightOverride {
  const { white: _white, mode: previousMode, ...rest } = override;
  const nextMode = mode ?? previousMode;
  return { ...rest, colors, ...(nextMode ? { mode: nextMode } : {}) };
}
