/** Pure helpers for the Suggest panel. */
import { hexToRgb, rgbToHex } from './color';
import type { GlareLimits, GlareReason } from './glareLimits';
import type { SuggestionGuide } from '../types';

export interface PaletteCredit {
  set?: string;
  scheme?: string;
  by?: string;
  author?: string;
  title?: string;
  artist?: string;
  url?: string;
  license?: string;
}

export const MODE_LABELS: Record<string, string> = {
  code: 'Code',
  work: 'Work',
  study: 'Study',
  read: 'Read',
  relax: 'Chill',
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A card's key while it is shown: stable across fetches, unlike its scene's id. */
export function showKey(mode: string, paletteId: string, seed: number, at: string): string {
  return `${mode}|${paletteId}|${seed}|${at}`;
}

export function cardTitle(mode: string, palette: { name: string }): string {
  return `${MODE_LABELS[mode] ?? capitalize(mode)} · ${palette.name}`;
}

export function creditText(palette: { source: string; credit: PaletteCredit }): string {
  const { credit } = palette;
  if (palette.source === 'colourlovers' && credit.author) return `Palette by ${credit.author} on COLOURlovers (CC BY-NC-SA 3.0)`;
  if (palette.source === 'hue' && credit.set) {
    return `A Hue app scene from the “${credit.set}” set (values recorded by Hypfer and coderph0x)`;
  }
  if (palette.source === 'd3' && credit.scheme) {
    return `${credit.scheme === 'CubehelixDefault' ? 'Cubehelix' : credit.scheme} scheme by ${credit.by ?? 'd3-scale-chromatic'}${credit.license ? ` (${credit.license})` : ''}`;
  }
  if (palette.source === 'met' && credit.title) {
    return `Colors from “${credit.title}”${credit.artist ? ` by ${credit.artist}` : ''}, The Met (CC0)`;
  }
  return '';
}

const pad = (n: number) => String(n).padStart(2, '0');

export function nowHHMM(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function quarterHours(): string[] {
  const times: string[] = [];
  for (let hour = 0; hour < 24; hour++) for (const minute of [0, 15, 30, 45]) times.push(`${pad(hour)}:${pad(minute)}`);
  return times;
}

const SHORT_DAY_MINUTES = 6 * 60;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function spell(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

/** A warning for a schedule suggestions can't do much with (the same times, or a short day), else ''. */
export function scheduleWarning(wake: string, bed: string): string {
  const day = (((toMinutes(bed) - toMinutes(wake)) % 1440) + 1440) % 1440;
  // The curve reads equal times as a 24-hour day (see curve.py), not as no day at all.
  if (day === 0) return 'Wake time and bedtime are the same, so suggestions treat it as a 24-hour day with no night.';
  if (day < SHORT_DAY_MINUTES) return `Only ${spell(day)} between waking and bedtime; suggestions will be dim most of the day.`;
  return '';
}

/**
 * A light's color at full strength. A Hue light shows a color's hue and saturation and keeps its
 * brightness apart, so a dark palette color is drawn as the light would show it, not as a grey smudge.
 */
export function fullStrength(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const top = Math.max(r, g, b);
  if (top === 0) return '#ffffff';
  return rgbToHex([r, g, b].map((channel) => Math.round((channel * 255) / top)) as [number, number, number]);
}

/** How opaque a light's glow is drawn at a brightness (0-100): fading toward transparent as it dims, never darker. */
export function glowOpacity(brightness: number): number {
  const level = Math.max(0, Math.min(100, brightness)) / 100;
  return Math.round(Math.max(0.06, level) * 100) / 100;
}

export function lightFill(result: { on: boolean; color: string | null; brightness: number }): { fill: string; opacity: number } {
  if (!result.on || !result.color) return { fill: '#2a2a2a', opacity: 1 };
  return { fill: fullStrength(result.color), opacity: glowOpacity(result.brightness) };
}

const REASON_WORDS: Record<GlareReason, string> = { reflection: 'reflect in the screen', direct: 'in view', peripheral: 'at the edge of view' };
const REASON_ORDER: GlareReason[] = ['reflection', 'direct', 'peripheral'];

/**
 * The panel's one glare line, from the limits the request sent: every held light once, grouped by
 * why and by its limit. '' when nothing was checked or nothing is held (the server's line says why).
 */
export function glareHeldLine(limits: GlareLimits, labels: Record<string, string>): string {
  if (!limits.checked) return '';
  const groups = new Map<string, { reason: GlareReason; brightness: number; kelvin: number | null; names: string[] }>();
  for (const [id, cap] of Object.entries(limits.caps)) {
    const key = `${cap.reason}|${cap.brightness}|${cap.kelvin ?? ''}`;
    if (!groups.has(key)) groups.set(key, { reason: cap.reason, brightness: cap.brightness, kelvin: cap.kelvin, names: [] });
    groups.get(key)!.names.push(labels[id] ?? id);
  }
  if (!groups.size) return '';
  const parts = [...groups.values()]
    .sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) || a.brightness - b.brightness)
    .map((group) => `${group.names.join(', ')} (${REASON_WORDS[group.reason]}: ≤${group.brightness}%${group.kelvin ? ', warm white' : ''})`);
  return `Held for glare at the desk: ${parts.join('; ')}.`;
}

/** A card's short glare line: how many of its lights it holds for glare, or '' for none. */
export function heldText(guide: SuggestionGuide | undefined): string {
  const held = guide?.checked ? guide.held ?? 0 : 0;
  if (!held) return '';
  return `${held} light${held === 1 ? '' : 's'} held for glare`;
}

type HeightAndRole = { elevation?: number | null; role?: string };

/** Whether a light's save changed what the server works out (its height or role). Moves don't. */
export function placementNeedsRefresh<T extends HeightAndRole>(previous: T | undefined, next: T): boolean {
  if (!previous) return false;
  return (previous.elevation ?? null) !== (next.elevation ?? null) || (previous.role ?? 'auto') !== (next.role ?? 'auto');
}

/** Tags requests so only the newest answer is used when several are in flight. */
export function latestOnly(): { next: () => number; isLatest: (token: number) => boolean } {
  let latest = 0;
  return { next: () => ++latest, isLatest: (token) => token === latest };
}

/** Focus kinds the server works roles out for, with the name the user knows them by. */
const FOCUS_LABELS: [string, string][] = [['desk', 'desk'], ['read', 'read'], ['sofa', 'relax']];

/** The Auto role option's label: "Auto (task)" when every focus agrees, else the role per focus. */
export function autoRoleLabel(resolved: Record<string, string> | undefined): string {
  const found = FOCUS_LABELS.filter(([kind]) => resolved?.[kind]).map(([kind, label]) => [label, resolved![kind]]);
  if (!found.length) return 'Auto';
  if (new Set(found.map(([, role]) => role)).size === 1) return `Auto (${found[0][1]})`;
  return `Auto (${found.map(([label, role]) => `${label}: ${role}`).join(' · ')})`;
}

/**
 * Runs `run` one call at a time. Calls made while it runs fold into one more run afterwards,
 * so the last state always reaches the server last. `isLast()` tells a run whether another
 * is queued behind it (only the last one should overwrite local state with the answer).
 */
export function oneAtATime(run: (isLast: () => boolean) => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await run(() => !again);
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

const QUICK_MODE_KEY = 'myhuey.quickMode';

/** The mode the quick settings menu last used in this browser; Code when unknown or unreadable. */
export function readQuickMode(): string {
  try {
    const stored = localStorage.getItem(QUICK_MODE_KEY);
    return stored && Object.hasOwn(MODE_LABELS, stored) ? stored : 'code';
  } catch {
    return 'code';
  }
}

export function storeQuickMode(mode: string): void {
  try {
    localStorage.setItem(QUICK_MODE_KEY, mode);
  } catch {
    // storage blocked: the menu just starts on Code next time
  }
}
