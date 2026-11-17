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
    return record;
  } catch {
    return null;
  }
}

export function clearTry(room: string): void {
  try { localStorage.removeItem(key(room)); } catch { /* storage unavailable */ }
}
