/** Photo helpers: tag keys, height presets, and the glow drawn over a room photo. */
import type { Furniture, Placement, Room } from '../types';

export type TagKind = 'light' | 'furniture' | 'opening';
export type HeightPreset = 'floor' | 'desk' | 'eye' | 'ceiling' | 'auto';

export const tagKey = (kind: TagKind, id: string) => `${kind}:${id}`;

export function parseTag(key: string): { kind: TagKind; id: string } | null {
  const at = key.indexOf(':');
  const kind = key.slice(0, at) as TagKind;
  const id = key.slice(at + 1);
  return at > 0 && id && ['light', 'furniture', 'opening'].includes(kind) ? { kind, id } : null;
}

const DESKS = ['desk', 'desk-l', 'desk-standing'];
export const EYE_SEATED = 115;
export const EYE_STANDING = 155;

function covers(item: Furniture, x: number, y: number): boolean {
  const angle = (-item.rotation * Math.PI) / 180;
  const dx = x - item.x;
  const dy = y - item.y;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  if (item.shape === 'ellipse') return (lx / (item.width / 2)) ** 2 + (ly / (item.depth / 2)) ** 2 <= 1;
  return Math.abs(lx) <= item.width / 2 && Math.abs(ly) <= item.depth / 2;
}

/** The height (cm) a preset means for this light, or null for "auto" (or no desk to use). */
export function heightPreset(preset: HeightPreset, room: Room, light: Placement): number | null {
  if (preset === 'floor') return 0;
  if (preset === 'ceiling') return room.ceiling;
  if (preset === 'auto') return null;
  const desks = room.furniture.filter((item) => DESKS.includes(item.kind));
  if (preset === 'eye') return desks.some((item) => item.kind === 'desk-standing') ? EYE_STANDING : EYE_SEATED;
  if (!desks.length) return null;
  const under = desks.find((item) => covers(item, light.x, light.y));
  const pick = under ?? desks.reduce((best, item) =>
    Math.hypot(item.x - light.x, item.y - light.y) < Math.hypot(best.x - light.x, best.y - light.y) ? item : best);
  return (pick.elevation ?? 0) + (pick.height ?? 75);
}

export interface GlowInput { light_id: string; on: boolean; color: string | null; brightness: number; gradient: string[] | null }
export interface Spot { x: number; y: number; rotation?: number; scale?: number }
export interface Blob { key: string; cx: number; cy: number; r: number; color: string; opacity: number }

const BASE_RADIUS = 0.07; // of the photo's shorter side, for a full-brightness light at marker size 1

/** Soft light blobs for the lit, tagged lights, in photo pixels. Gradient lights get one per color. */
export function glowLayout(results: GlowInput[], tags: Record<string, Spot>, size: { width: number; height: number }): Blob[] {
  const blobs: Blob[] = [];
  for (const result of results) {
    const spot = tags[tagKey('light', result.light_id)];
    if (!spot || !result.on || !result.color) continue;
    const level = Math.max(0, Math.min(100, result.brightness)) / 100;
    const r = Math.min(size.width, size.height) * BASE_RADIUS * (spot.scale ?? 1) * (0.4 + 0.6 * level);
    const opacity = Math.round((0.35 + 0.65 * level) * 100) / 100;
    const colors = result.gradient && result.gradient.length > 1 ? result.gradient : [result.color];
    const angle = ((spot.rotation ?? 0) * Math.PI) / 180;
    const step = r * 0.9;
    colors.forEach((color, index) => {
      const along = (index - (colors.length - 1) / 2) * step;
      blobs.push({
        key: `${result.light_id}-${index}`,
        cx: spot.x * size.width + Math.cos(angle) * along,
        cy: spot.y * size.height + Math.sin(angle) * along,
        r, color, opacity,
      });
    });
  }
  return blobs;
}

const MAX_DARKNESS = 0.55;

/** How much to darken the photo (0 to 0.55) so a dim scene looks dim: from the lit lights' average level. */
export function darkness(results: GlowInput[]): number {
  const lit = results.filter((result) => result.on && result.color);
  if (!lit.length) return MAX_DARKNESS;
  const level = lit.reduce((sum, result) => sum + result.brightness, 0) / lit.length / 100;
  return Math.round(MAX_DARKNESS * (1 - Math.max(0, Math.min(1, level))) * 1000) / 1000;
}
