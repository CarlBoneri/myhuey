// Lengths are stored in centimeters. These mirror myhuey/units.py so the UI and CLI agree.
import type { Units } from '../types';

export const CM_PER_INCH = 2.54;
export const CM_PER_FOOT = 30.48;

const FEET_INCHES = /^\s*(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*,?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches))?\s*$/i;
const WITH_UNIT = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*$/i;
const BARE = /^\s*\d+(?:\.\d+)?\s*$/;

/** Parse 12'6", 12ft 6in, 3.5m, 350cm. A bare number is feet (imperial) or meters (metric). */
export function parseLength(text: string, units: Units = 'imperial'): number | null {
  const raw = text.trim();
  if (!raw) return null;
  if (BARE.test(raw)) return Number(raw) * (units === 'imperial' ? CM_PER_FOOT : 100);
  let match = raw.match(WITH_UNIT);
  if (match) return Number(match[1]) * ({ mm: 0.1, cm: 1, m: 100 } as Record<string, number>)[match[2].toLowerCase()];
  match = raw.match(FEET_INCHES);
  if (match && (match[1] || match[2])) return Number(match[1] || 0) * CM_PER_FOOT + Number(match[2] || 0) * CM_PER_INCH;
  return null;
}

export function formatLength(cm: number, units: Units = 'imperial'): string {
  if (units === 'metric') return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${Math.round(cm)} cm`;
  const total = Math.round(cm / CM_PER_INCH);
  const feet = Math.floor(total / 12);
  const inches = total % 12;
  if (!feet) return `${inches}"`;
  return inches ? `${feet}' ${inches}"` : `${feet}'`;
}

export function formatArea(cm2: number, units: Units = 'imperial'): string {
  return units === 'metric' ? `${(cm2 / 10000).toFixed(1)} m²` : `${Math.round(cm2 / (CM_PER_FOOT * CM_PER_FOOT))} sq ft`;
}

/** Grid spacing for the plan: 1 ft or 50 cm, coarser when zoomed out. */
export function gridStep(units: Units, cmPerPixel: number): number {
  const base = units === 'imperial' ? CM_PER_FOOT : 50;
  let step = base;
  while (step / cmPerPixel < 14) step *= units === 'imperial' ? 2 : 2;
  return step;
}

/** Snap to a whole inch or centimeter. */
export function snap(cm: number, units: Units): number {
  const unit = units === 'imperial' ? CM_PER_INCH : 1;
  return Math.round(cm / unit) * unit;
}
