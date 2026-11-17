// What the shell remembers that is not the home's data: the room you were last in, the 3D view's
// posture and glare mode, the prompt's history, and which overlays are open.
import { create } from 'zustand';
import type { Posture } from './lib/rig';
import type { SceneResult } from './types';
import { normalizePlacement, normalizeRail, normalizeTabs, type TabPlacement, type TabRail, type TabState } from './lib/tabs';

/**
 * The card being shown. `id` is the card's stable key (mode, palette, shuffle and time), since a
 * scene's id changes on every fetch; `roles` are the light roles the photo badges.
 */
export interface Showing { room: string; id: string; title: string; results: SceneResult[]; roles?: Record<string, string> }

export interface Entry { id: number; command: string; output: string; ok: boolean; ms: number; at: number }

interface UiState {
  currentRoom: string | null;
  posture: Posture;
  glareMode: string;
  history: Entry[];
  busy: boolean;
  paletteOpen: boolean;
  workflowsOpen: boolean;
  /** The Studio's lighting panel (the Light button), kept across room views and reloads. */
  lightingOpen: boolean;
  /** The prompt's text, so help pages and other screens can put a command in it. */
  draft: string;
  tabs: TabState;
  tabPlacement: TabPlacement;
  /** How wide the tab rail is, and whether it is folded to icons. */
  tabRail: TabRail;
  /** Sidebar panels that are folded, by panel key. */
  folded: Record<string, true>;
  /** A suggestion drawn on the plan, 3D view and photo without touching the lights; not persisted. */
  showing: Showing | null;
  setShowing: (next: Showing | null) => void;
  setDraft: (draft: string) => void;
  setTabs: (tabs: TabState) => void;
  setTabPlacement: (placement: TabPlacement) => void;
  setTabRail: (rail: TabRail) => void;
  setFolded: (keys: string[], folded: boolean) => void;
  setCurrentRoom: (room: string | null) => void;
  setPosture: (posture: Posture) => void;
  setGlareMode: (mode: string) => void;
  log: (entry: Omit<Entry, 'id' | 'at'>) => Entry;
  clearHistory: () => void;
  setBusy: (busy: boolean) => void;
  setPalette: (open: boolean) => void;
  setWorkflows: (open: boolean) => void;
  setLightingOpen: (open: boolean) => void;
}

export const HISTORY_LIMIT = 100;
const ROOM_KEY = 'myhuey.room';
const TABS_KEY = 'myhuey.tabs';
const PLACEMENT_KEY = 'myhuey.tabPlacement';
const RAIL_KEY = 'myhuey.tabRail';
const PANELS_KEY = 'myhuey.panels';
const LIGHTING_KEY = 'myhuey.lightingOpen';

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
  lightingOpen: stored<unknown>(LIGHTING_KEY, false) === true,
  draft: '',
  tabs: normalizeTabs(stored(TABS_KEY, null)),
  tabPlacement: normalizePlacement(stored(PLACEMENT_KEY, null)),
  tabRail: normalizeRail(stored(RAIL_KEY, null)),
  folded: Object.fromEntries((stored<unknown[]>(PANELS_KEY, []) as unknown[]).filter((key): key is string => typeof key === 'string').map((key) => [key, true as const])),
  showing: null,
  setShowing: (showing) => set({ showing }),
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
  setTabRail(rail) {
    const next = normalizeRail(rail);
    store(RAIL_KEY, next);
    set({ tabRail: next });
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
  setLightingOpen(lightingOpen) {
    store(LIGHTING_KEY, lightingOpen);
    set({ lightingOpen });
  },
}));
