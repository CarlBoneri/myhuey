/** Pure helpers for the Suggest panel. */

export interface PaletteCredit {
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
  relax: 'Relax',
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function cardTitle(mode: string, palette: { name: string }): string {
  return `${MODE_LABELS[mode] ?? capitalize(mode)} · ${palette.name}`;
}

export function creditText(palette: { source: string; credit: PaletteCredit }): string {
  const { credit } = palette;
  if (palette.source === 'colourlovers' && credit.author) return `Palette by ${credit.author} on COLOURlovers (CC BY-NC-SA 3.0)`;
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

export function lightFill(result: { on: boolean; color: string | null; brightness: number }): { fill: string; opacity: number } {
  if (!result.on || !result.color) return { fill: '#2a2a2a', opacity: 1 };
  return { fill: result.color, opacity: Math.round((0.2 + (0.8 * result.brightness) / 100) * 100) / 100 };
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
