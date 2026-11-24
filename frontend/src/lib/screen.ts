// A screen's shape: its size from the diagonal on the box, its curve (R in mm, as printed on the
// box), and the footprint it takes on the plan. Plan cm; at rotation 0 a screen's front faces +y.
// The footprint numbers match `footprint` in src/myhuey/placement.py.
import type { Furniture } from '../types';

const CM_PER_INCH = 2.54;
const round1 = (value: number) => Math.round(value * 10) / 10;

export const ASPECTS: { label: string; w: number; h: number }[] = [
  { label: '16:9', w: 16, h: 9 },
  { label: '16:10', w: 16, h: 10 },
  { label: '21:9', w: 21, h: 9 },
  { label: '32:9', w: 32, h: 9 },
];
/** The curves screens are sold with, in mm; null is flat. */
export const CURVES: (number | null)[] = [null, 1000, 1500, 1800, 2300, 3800];
export const CURVE_RANGE_MM: [number, number] = [500, 10000];
/** Screens that come curved: kind -> curve in mm. The 49" matches the Samsung Odyssey G9. */
export const DEFAULT_CURVES: Record<string, number> = { 'monitor-49': 1000 };

/** Panel width and height (cm, one decimal) for a diagonal in inches and an aspect such as 32:9. */
export function sizeFromDiagonal(inches: number, w: number, h: number): { width: number; height: number } {
  const per = (inches * CM_PER_INCH) / Math.hypot(w, h);
  return { width: round1(w * per), height: round1(h * per) };
}

/** The screen's diagonal in inches, one decimal. */
export const diagonalOf = (item: Furniture): number => round1(Math.hypot(item.width, item.height ?? 40) / CM_PER_INCH);

/** Curved, and landscape: a curve saved on a portrait screen is ignored. */
export const isCurved = (item: Furniture): boolean => !!item.curve && item.width >= (item.height ?? 0);

/** The piece as it may be saved: a screen made taller than wide loses its curve (the API refuses a curved portrait). */
export const legalCurve = (item: Furniture): Furniture => (item.curve != null && (item.height ?? 0) > item.width ? { ...item, curve: null } : item);

/** The arc the panel follows: radius (cm), the angle it spans (radians), its chord, and how far the wings reach forward. */
export function arcOf(item: Furniture): { radius: number; angle: number; chord: number; sagitta: number } {
  if (!isCurved(item)) return { radius: Infinity, angle: 0, chord: item.width, sagitta: 0 };
  const radius = item.curve! / 10;
  const angle = item.width / radius;
  return { radius, angle, chord: 2 * radius * Math.sin(angle / 2), sagitta: radius * (1 - Math.cos(angle / 2)) };
}

/**
 * The plan box the piece covers, turned like the piece. A curved screen keeps its body at (x, y),
 * so a curve never moves it; the box is the chord wide and depth + sagitta deep, centered half
 * the sagitta toward the front.
 */
export function footprintOf(item: Furniture): { x: number; y: number; width: number; depth: number } {
  const { chord, sagitta } = arcOf(item);
  if (!sagitta) return { x: item.x, y: item.y, width: item.width, depth: item.depth };
  const r = (item.rotation * Math.PI) / 180;
  return { x: item.x - Math.sin(r) * (sagitta / 2), y: item.y + Math.cos(r) * (sagitta / 2), width: chord, depth: item.depth + sagitta };
}

/** One line for the item list: `49" 32:9 · 1000R`, `27" portrait`, `27" 16:9`. */
export function screenSummary(item: Furniture): string {
  const height = item.height ?? 40;
  const parts = [`${diagonalOf(item)}"`];
  if (height > item.width) parts.push('portrait');
  else {
    const aspect = ASPECTS.find((a) => Math.abs(item.width / height - a.w / a.h) < 0.03);
    if (aspect) parts.push(aspect.label);
  }
  const text = parts.join(' ');
  return isCurved(item) ? `${text} · ${item.curve}R` : text;
}
