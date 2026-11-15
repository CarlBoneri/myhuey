import { create } from 'zustand';
import { API_VERSION, api } from './api';
import type { Preferences } from './types';
import type { BridgeLight, HomePlan, ProfileTable, Room, Scene, SetupStatus } from './types';

export interface Toast { id: number; message: string; error: boolean }

interface State {
  ready: boolean;
  setup: SetupStatus | null;
  lights: Record<string, BridgeLight>;
  lightsError: string;
  /** The running server is older than this page (it was started before an update). */
  serverStale: boolean;
  rooms: Room[];
  scenes: Scene[];
  plan: HomePlan | null;
  preferences: Preferences;
  profiles: ProfileTable | null;
  toasts: Toast[];
  load: () => Promise<void>;
  refreshLights: () => Promise<void>;
  refreshRooms: () => Promise<void>;
  refreshScenes: () => Promise<void>;
  setPlan: (plan: HomePlan | null) => void;
  setPreferences: (changes: Partial<Preferences>) => Promise<void>;
  replaceRoom: (previousName: string, room: Room) => void;
  patchLight: (id: string, changes: Partial<BridgeLight>) => void;
  toast: (message: string, error?: boolean) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

/** Mirrors the defaults in myhuey/preferences.py, used until the server answers. */
export const DEFAULT_PREFERENCES: Preferences = {
  room_sliders: true, room_sliders_when_on_only: true, show_light_glow: true, poll_seconds: 5, command_gap_ms: 100, default_units: 'imperial',
  wake_time: '07:00', bed_time: '23:00',
};

export const useStore = create<State>((set, get) => ({
  ready: false,
  setup: null,
  lights: {},
  lightsError: '',
  serverStale: false,
  rooms: [],
  scenes: [],
  plan: null,
  preferences: DEFAULT_PREFERENCES,
  profiles: null,
  toasts: [],

  async load() {
    try {
      const health = await api.health();
      set({ serverStale: (health.api ?? 0) < API_VERSION });
    } catch {
      // reported by the calls below
    }
    try {
      const [setup, rooms, scenes, profiles, plan, preferences] = await Promise.all([
        api.setup(), api.rooms(), api.scenes(), api.profiles(), api.plan(), api.preferences().catch(() => DEFAULT_PREFERENCES),
      ]);
      set({ setup, rooms, scenes, profiles, plan, preferences });
      if (setup.configured) await get().refreshLights();
    } catch (error) {
      get().toast((error as Error).message);
    }
    set({ ready: true });
  },

  async refreshLights() {
    if (!get().setup?.configured) return;
    try {
      const list = await api.lights();
      set({ lights: Object.fromEntries(list.map((light) => [light.id, light])), lightsError: '' });
    } catch (error) {
      set({ lightsError: (error as Error).message });
    }
  },

  async refreshRooms() {
    set({ rooms: await api.rooms() });
  },

  async refreshScenes() {
    set({ scenes: await api.scenes() });
  },

  setPlan(plan) {
    set({ plan });
  },

  async setPreferences(changes) {
    const previous = get().preferences;
    set({ preferences: { ...previous, ...changes } });
    try {
      set({ preferences: await api.updatePreferences(changes) });
    } catch (error) {
      set({ preferences: previous });
      get().toast((error as Error).message);
    }
  },

  replaceRoom(previousName, room) {
    set({ rooms: get().rooms.map((item) => (item.name === previousName ? room : item)) });
  },

  patchLight(id, changes) {
    const light = get().lights[id];
    if (light) set({ lights: { ...get().lights, [id]: { ...light, ...changes } } });
  },

  toast(message, error = true) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, error }] });
    setTimeout(() => get().dismiss(id), error ? 7000 : 3500);
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
}));

// Light changes: one request per light at a time; changes made meanwhile merge into the next one.
const pending = new Map<string, Record<string, unknown>>();

export function sendLight(id: string, changes: Record<string, unknown>, optimistic: Partial<BridgeLight> = {}) {
  const store = useStore.getState();
  store.patchLight(id, optimistic);
  const waiting = pending.get(id);
  if (waiting) {
    Object.assign(waiting, changes);
    return;
  }
  pending.set(id, { ...changes });
  void (async () => {
    try {
      while (Object.keys(pending.get(id) || {}).length) {
        const next = pending.get(id)!;
        pending.set(id, {});
        await api.setLight(id, next);
      }
    } catch (error) {
      useStore.getState().toast((error as Error).message);
    } finally {
      pending.delete(id);
    }
  })();
}

/** Turn every light in a room on or off; the plan updates at once, then reads back the bridge. */
export async function setRoomPower(room: Room, on: boolean) {
  const store = useStore.getState();
  const ids = room.lights.map((l) => l.light_id).filter((id) => store.lights[id]);
  ids.forEach((id) => store.patchLight(id, { on }));
  try {
    const result = await api.roomPower(room.name, on);
    if (result.failed) {
      const names = result.results.filter((r) => !r.ok).map((r) => r.label).join(', ');
      store.toast(`${result.failed} light(s) in ${room.name} did not turn ${on ? 'on' : 'off'}: ${names}`);
    }
  } catch (error) {
    store.toast((error as Error).message);
  }
  await useStore.getState().refreshLights();
}

/** Dim or brighten every light that is on in a room. The plan updates at once, then reads back the bridge. */
export async function setRoomBrightness(room: Room, percent: number) {
  const store = useStore.getState();
  const bri = Math.max(1, Math.round(percent * 2.54));
  room.lights.forEach((p) => store.lights[p.light_id]?.on && store.patchLight(p.light_id, { brightness: bri }));
  try {
    const result = await api.roomBrightness(room.name, Math.round(percent));
    if (result.failed) {
      store.toast(`${result.failed} light(s) in ${room.name} did not change: ${result.results.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
    }
  } catch (error) {
    store.toast((error as Error).message);
  }
  await useStore.getState().refreshLights();
}

/** Run an action and report failures as a toast. Returns undefined on failure. */
export async function attempt<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await work();
    if (success) useStore.getState().toast(success, false);
    return result;
  } catch (error) {
    useStore.getState().toast((error as Error).message);
    return undefined;
  }
}
