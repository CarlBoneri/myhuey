// Perceptual color helpers: OKLCH/OKLab through culori, HCT and tonal palettes through
// Material Color Utilities. Hex strings (#rrggbb) are the currency everywhere else.
import { clampChroma, converter, displayable, formatHex, interpolate, wcagContrast } from 'culori';
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export interface Oklch { l: number; c: number; h: number }
export interface HctColor { h: number; c: number; t: number }

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const toHsl = converter('hsl');
const toLab = converter('lab');

export function normalizeHex(value: string): string | null {
  const text = value.trim().replace(/^#/, '');
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toLowerCase()}` : null;
}

export function hexToOklch(hex: string): Oklch {
  const color = toOklch(hex);
  return { l: color?.l ?? 0, c: color?.c ?? 0, h: Number.isFinite(color?.h) ? (color!.h as number) : 0 };
}

export function inGamut({ l, c, h }: Oklch): boolean {
  return displayable({ mode: 'oklch', l, c, h });
}

/** OKLCH to hex. Out-of-gamut colors keep their lightness and hue and lose chroma. */
export function oklchToHex({ l, c, h }: Oklch): string {
  return formatHex(clampChroma({ mode: 'oklch', l, c, h }, 'oklch')) ?? '#000000';
}

export function hexToHct(hex: string): HctColor {
  const hct = Hct.fromInt(argbFromHex(hex));
  return { h: hct.hue, c: hct.chroma, t: hct.tone };
}

export function hctToHex({ h, c, t }: HctColor): string {
  return hexFromArgb(Hct.from(h, c, t).toInt());
}

export const TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

/** Material tonal palette for a color: the same hue and chroma at each tone. */
export function tonalPalette(hex: string, tones = TONES): string[] {
  const palette = TonalPalette.fromInt(argbFromHex(hex));
  return tones.map((tone) => hexFromArgb(palette.tone(tone)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const rgb = toRgb(hex)!;
  return [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return formatHex({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 }) ?? '#000000';
}

export function hexToHsl(hex: string): [number, number, number] {
  const hsl = toHsl(hex)!;
  return [Math.round(hsl.h ?? 0), Math.round((hsl.s ?? 0) * 100), Math.round((hsl.l ?? 0) * 100)];
}

export function hslToHex([h, s, l]: [number, number, number]): string {
  return formatHex({ mode: 'hsl', h, s: s / 100, l: l / 100 }) ?? '#000000';
}

export function hexToLab(hex: string): [number, number, number] {
  const lab = toLab(hex)!;
  return [Math.round(lab.l), Math.round(lab.a), Math.round(lab.b)];
}

export interface Harmony { name: string; colors: string[] }

/** Classic harmonies, rotated in OKLCH so lightness stays even across the set. */
export function harmonies(hex: string): Harmony[] {
  const base = hexToOklch(hex);
  const turn = (...degrees: number[]) => degrees.map((d) => oklchToHex({ ...base, h: (base.h + d + 360) % 360 }));
  return [
    { name: 'Complementary', colors: turn(0, 180) },
    { name: 'Analogous', colors: turn(-30, 0, 30) },
    { name: 'Triadic', colors: turn(0, 120, 240) },
    { name: 'Split complementary', colors: turn(0, 150, 210) },
    { name: 'Tetradic', colors: turn(0, 90, 180, 270) },
  ];
}

/** Shades (toward black), tints (toward white), and tones (toward gray), mixed in OKLab. */
export function mixes(hex: string, steps = 6): { shades: string[]; tints: string[]; tones: string[] } {
  const along = (target: string) => {
    const mix = interpolate([hex, target], 'oklab');
    return Array.from({ length: steps }, (_, i) => formatHex(mix(i / steps)) ?? hex);
  };
  return { shades: along('#000000'), tints: along('#ffffff'), tones: along('#808080') };
}

/** A gradient's colors between stops, interpolated in OKLCH (no muddy middles). */
export function gradientStops(colors: string[], count: number): string[] {
  if (colors.length === 1) return Array(count).fill(colors[0]);
  const mix = interpolate(colors, 'oklch');
  // formatHex clips each channel; a chroma clamp would visibly shift pure endpoints like #0000ff.
  return Array.from({ length: count }, (_, i) => formatHex(mix(i / Math.max(1, count - 1))) ?? colors[0]);
}

export function readableOn(hex: string): string {
  return wcagContrast(hex, '#000000') > wcagContrast(hex, '#ffffff') ? '#0b0a12' : '#ffffff';
}

/** Kelvin to an approximate sRGB hex (Tanner Helland's fit), matching the backend. */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return rgbToHex([clamp(r), clamp(g), clamp(b)]);
}

export type GradientMode = 'interpolated_palette' | 'interpolated_palette_mirrored' | 'segmented_palette' | 'random_pixelated';

/**
 * `count` display colors for a Hue gradient drawn in its mode: a blend in OKLCH, the blend
 * mirrored around the middle, equal hard bands, or the given colors scattered (the same
 * scatter every time, so the drawing does not flicker on each poll).
 */
export function renderStops(colors: string[], mode: string, count: number): string[] {
  if (!colors.length || count < 1) return [];
  if (colors.length === 1) return Array(count).fill(colors[0]);
  switch (mode) {
    case 'segmented_palette':
      return Array.from({ length: count }, (_, i) => colors[Math.min(colors.length - 1, Math.floor((i * colors.length) / count))]);
    case 'interpolated_palette_mirrored': {
      const mix = interpolate(colors, 'oklch');
      return Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0 : 1 - Math.abs((2 * i) / (count - 1) - 1);
        return formatHex(mix(t)) ?? colors[0];
      });
    }
    case 'random_pixelated':
      return Array.from({ length: count }, (_, i) => colors[Math.abs(Math.imul(i + 1, 2654435761) >> 7) % colors.length]);
    default:
      return gradientStops(colors, count);
  }
}
