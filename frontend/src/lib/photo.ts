/** Photo helpers: tag keys, height presets, and the glow drawn over a room photo. */
import type { Placement, Pt, Room } from '../types';
import { bounds, pointInPolygon } from './geometry';
import { covers } from './rig';

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

/** Only the tags that name a light, furniture piece, or opening still in the room (what the server accepts). */
export function resolvableTags<T>(tags: Record<string, T>, room: Room): Record<string, T> {
  const ids: Record<TagKind, Set<string>> = {
    light: new Set(room.lights.map((l) => l.light_id)),
    furniture: new Set(room.furniture.map((f) => f.id)),
    opening: new Set(room.openings.map((o) => o.id)),
  };
  return Object.fromEntries(Object.entries(tags).filter(([key]) => {
    const tag = parseTag(key);
    return !!tag && ids[tag.kind].has(tag.id);
  }));
}

const NUDGES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** A tag moved by an arrow key: 1% of the photo, 5% with shift. Null for other keys. */
export function nudge<T extends Spot>(spot: T, key: string, shift: boolean): T | null {
  const step = NUDGES[key];
  if (!step) return null;
  const amount = shift ? 0.05 : 0.01;
  const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
  return { ...spot, x: clamp(spot.x + step[0] * amount), y: clamp(spot.y + step[1] * amount) };
}

/** A point well inside the room: its area centroid, or the inside point nearest to it (L-shaped rooms). */
export function roomCenter(outline: Pt[]): Pt {
  let area = 0, cx = 0, cy = 0;
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  });
  const center: Pt = area ? [cx / (3 * area), cy / (3 * area)] : outline[0] ?? [0, 0];
  if (pointInPolygon(center, outline)) return center;
  const box = bounds(outline);
  let best: Pt | null = null;
  for (let i = 1; i < 20; i++) {
    for (let j = 1; j < 20; j++) {
      const p: Pt = [box.minX + ((box.maxX - box.minX) * i) / 20, box.minY + ((box.maxY - box.minY) * j) / 20];
      if (pointInPolygon(p, outline) && (!best || Math.hypot(p[0] - center[0], p[1] - center[1]) < Math.hypot(best[0] - center[0], best[1] - center[1]))) best = p;
    }
  }
  return best ?? center;
}
