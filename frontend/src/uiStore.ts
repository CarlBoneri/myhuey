// What the shell remembers that is not the home's data: the room you were last in, the 3D view's
// posture and glare mode, the prompt's history, and which overlays are open.
import { create } from 'zustand';
import type { Posture } from './lib/rig';
import { normalizePlacement, normalizeTabs, type TabPlacement, type TabState } from './lib/tabs';

export interface Entry { id: number; command: string; output: string; ok: boolean; ms: number; at: number }

interface UiState {
  currentRoom: string | null;
  posture: Posture;
  glareMode: string;
  history: Entry[];
  busy: boolean;
  paletteOpen: boolean;
  workflowsOpen: boolean;
  /** The prompt's text, so help pages and other screens can put a command in it. */
  draft: string;
  tabs: TabState;
  tabPlacement: TabPlacement;
  /** Sidebar panels that are folded, by panel key. */
  folded: Record<string, true>;
  setDraft: (draft: string) => void;
  setTabs: (tabs: TabState) => void;
  setTabPlacement: (placement: TabPlacement) => void;
  setFolded: (keys: string[], folded: boolean) => void;
  setCurrentRoom: (room: string | null) => void;
  setPosture: (posture: Posture) => void;
  setGlareMode: (mode: string) => void;
  log: (entry: Omit<Entry, 'id' | 'at'>) => Entry;
  clearHistory: () => void;
  setBusy: (busy: boolean) => void;
  setPalette: (open: boolean) => void;
  setWorkflows: (open: boolean) => void;
}

export const HISTORY_LIMIT = 100;
const ROOM_KEY = 'myhuey.room';
const TABS_KEY = 'myhuey.tabs';
const PLACEMENT_KEY = 'myhuey.tabPlacement';
const PANELS_KEY = 'myhuey.panels';

function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: it resets next time */ }
}
let entryId = 0;

function storedRoom(): string | null {
  try { return localStorage.getItem(ROOM_KEY); } catch { return null; }
}

export const useUi = create<UiState>((set, get) => ({
  currentRoom: storedRoom(),
  posture: 'seated',
  glareMode: 'code',
  history: [],
  busy: false,
  paletteOpen: false,
  workflowsOpen: false,
  draft: '',
  tabs: normalizeTabs(stored(TABS_KEY, null)),
  tabPlacement: normalizePlacement(stored(PLACEMENT_KEY, null)),
  folded: Object.fromEntries((stored<unknown[]>(PANELS_KEY, []) as unknown[]).filter((key): key is string => typeof key === 'string').map((key) => [key, true as const])),
  setDraft: (draft) => set({ draft }),
  setTabs(tabs) {
    store(TABS_KEY, tabs);
    set({ tabs });
  },
  setTabPlacement(placement) {
    const next = normalizePlacement(placement);
    store(PLACEMENT_KEY, next);
    set({ tabPlacement: next });
  },
  setFolded(keys, folded) {
    const next = { ...get().folded };
    for (const key of keys) { if (folded) next[key] = true; else delete next[key]; }
    store(PANELS_KEY, Object.keys(next).slice(-200));
    set({ folded: next });
  },
  setCurrentRoom(room) {
    if (room === get().currentRoom) return;
    try { if (room) localStorage.setItem(ROOM_KEY, room); } catch { /* storage blocked: it is only a convenience */ }
    set({ currentRoom: room });
  },
  setPosture: (posture) => set({ posture }),
  setGlareMode: (glareMode) => set({ glareMode }),
  log(entry) {
    const full: Entry = { ...entry, id: ++entryId, at: Date.now() };
    set({ history: [...get().history, full].slice(-HISTORY_LIMIT) });
    return full;
  },
  clearHistory: () => set({ history: [] }),
  setBusy: (busy) => set({ busy }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setWorkflows: (workflowsOpen) => set({ workflowsOpen }),
}));
