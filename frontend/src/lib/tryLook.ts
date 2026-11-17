// The look a room had before "Try on lights", kept per room so Undo survives a reload.
import type { RoomLook } from '../types';

export interface TryRecord {
  /** Epoch ms of the first try. */
  at: number;
  look: RoomLook;
  skipped: string[];
  title: string;
  layout: string | null;
  /** The server's "HH:MM" for when the look was captured. */
  capturedAt: string;
  /** The time of day the latest try was suggested for ("HH:MM"); left out when it was for now. */
  time?: string;
}

export const TRY_LIFETIME_MS = 12 * 3600_000;
const key = (room: string) => `myhuey.try.${room}`;

export function saveTry(room: string, record: TryRecord): void {
  try { localStorage.setItem(key(room), JSON.stringify(record)); } catch { /* storage unavailable */ }
}

export function loadTry(room: string, now: number = Date.now()): TryRecord | null {
  try {
    const raw = localStorage.getItem(key(room));
    if (!raw) return null;
    const record = JSON.parse(raw) as TryRecord;
    if (!record || typeof record.at !== 'number' || !record.look || now - record.at > TRY_LIFETIME_MS) return null;
    return { ...record, layout: record.layout ?? null, skipped: record.skipped ?? [] };
  } catch {
    return null;
  }
}

export function clearTry(room: string): void {
  try { localStorage.removeItem(key(room)); } catch { /* storage unavailable */ }
}

/** A later try's capture folded into the first: first-captured values win, lights new since then get today's state. */
export function mergeTry(record: TryRecord, captured: { look: RoomLook; skipped: string[] }, title: string): TryRecord {
  const look = { ...captured.look, ...record.look };
  const skipped = [...new Set([...record.skipped, ...captured.skipped])].filter((id) => !(id in look));
  return { ...record, title, look, skipped };
}
