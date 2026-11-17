// The glare check as limits the server can hold a suggestion to. Every number comes from the
// report (glareMath.ts); nothing is restated here.
import type { GlareReport, GlareStatus } from './glareMath';

export type GlareReason = 'reflection' | 'direct' | 'peripheral';
export interface GlareCapBody { brightness: number; kelvin: number | null; reason: GlareReason }
export interface GlareLimits { checked: boolean; caps: Record<string, GlareCapBody> }

const REASONS: Partial<Record<GlareStatus, GlareReason>> = {
  screen_reflection: 'reflection',
  direct_fov: 'direct',
  peripheral_warn: 'peripheral',
};

/** The desk presets the glare limits apply to; read and chill get none. */
export function glareModeFor(mode: string): 'code' | 'work' | 'study' | null {
  return mode === 'code' || mode === 'work' || mode === 'study' ? mode : null;
}

/** `checked` is false when there is no desk with a screen to judge from, so a caller never reads that as "all clear". */
export function glareLimits(report: GlareReport, hasDesk: boolean): GlareLimits {
  const caps: Record<string, GlareCapBody> = {};
  if (!hasDesk) return { checked: false, caps };
  for (const light of report.lights) {
    const reason = REASONS[light.status];
    if (reason && light.cap) caps[light.light_id] = { brightness: light.cap.brightness, kelvin: light.cap.kelvin, reason };
  }
  return { checked: true, caps };
}

/** Lights that are lit above their cap (levels are percent). */
export function overLimit(report: GlareReport, shown: Record<string, { on: boolean; brightness: number }>): string[] {
  return report.lights
    .filter((light) => {
      const level = shown[light.light_id];
      return !!light.cap && !!level && level.on && level.brightness > light.cap.brightness;
    })
    .map((light) => light.light_id);
}
