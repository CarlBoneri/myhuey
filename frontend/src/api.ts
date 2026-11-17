import type { BridgeInfo } from './lib/setupFlow';
import { MISSING_LAYOUT, layoutHeaders } from './lib/layout';
import type { GlareLimits } from './lib/glareLimits';
import type { Preferences } from './types';
import type { LayoutSummary, LightGroup } from './types';
import type { CatalogItem, HueSceneSet, HomePlan, Placement, Opening, ImageLayer, Mood, PaletteEntry, Setup, PinnableRole, ProfileTable, Room, Scene, SceneResult, SetupStatus, Suggestion, RoomLook, Swatch, BridgeLight, Furniture, PhotoSpot, Pt } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let openLayout: string | null = null;
let layoutGone: (() => void) | null = null;
let goneReported = false;

/** The sandbox the app is working on (null = Active). Sent with every call not marked Active-only. */
export function setOpenLayout(id: string | null) {
  openLayout = id;
  goneReported = false;
}

/** Called once when the open sandbox turns out to be deleted (another tab, the CLI), whichever call finds out. */
export function onLayoutGone(handler: (() => void) | null) {
  layoutGone = handler;
}

/**
 * `layout`, when given, names the layout this one call works in (null = Active) in place of the open
 * one: Undo goes back in the layout its look was captured in, whichever is open now.
 */
async function call<T>(path: string, init: RequestInit & { json?: unknown; activeOnly?: boolean; layout?: string | null } = {}): Promise<T> {
  const { json, activeOnly = false, layout, ...rest } = init;
  const pinned = layout !== undefined;
  const request: RequestInit = { ...rest };
  const headers: Record<string, string> = { ...layoutHeaders(pinned ? layout : openLayout, activeOnly), ...((rest.headers as Record<string, string>) || {}) };
  if (json !== undefined) {
    request.body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  }
  request.headers = headers;
  let response: Response;
  try {
    response = await fetch(path, request);
  } catch {
    throw new ApiError('Cannot reach the MyHuey server. Is `myhuey serve` running?', 0);
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg?: string }) => item.msg).join('; ')
      : detail || `Request failed (${response.status})`;
    if (response.status === 404 && message === MISSING_LAYOUT && openLayout && !activeOnly && !pinned && !goneReported) {
      goneReported = true;
      layoutGone?.();
    }
    throw new ApiError(message, response.status);
  }
  return body as T;
}

/** The document version this page was built for. A server reporting less was started before an update. */
export const API_VERSION = 5;

const room = (name: string) => `/api/rooms/${encodeURIComponent(name)}`;

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return call<T>(path, { method: 'POST', body: form });
}

export const api = {
  health: () => call<{ status: string; api?: number }>('/api/health'),
  setup: () => call<SetupStatus>('/api/setup/status'),
  discover: () => call<{ id: string; ip: string }[]>('/api/bridges/discover'),
  checkBridge: (ip: string) => call<BridgeInfo>(`/api/bridges/check?ip=${encodeURIComponent(ip)}`),
  pairAny: (bridge_ips: string[]) =>
    call<{ bridge_ip: string }>('/api/bridge/register-any', { method: 'POST', json: { bridge_ips } }),
  pair: (bridge_ip: string) => call<{ bridge_ip: string }>('/api/bridge/register', { method: 'POST', json: { bridge_ip } }),

  lights: () => call<BridgeLight[]>('/api/lights'),
  profiles: () => call<ProfileTable>('/api/light-profiles'),
  setLight: (id: string, changes: Record<string, unknown>) =>
    call(`/api/lights/${encodeURIComponent(id)}/state`, { method: 'PUT', json: changes }),
  setGradient: (id: string, colors: string[], mode?: string) =>
    call(`/api/lights/${encodeURIComponent(id)}/gradient`, { method: 'PUT', json: { colors, mode } }),
  setEffect: (id: string, effect: string) =>
    call(`/api/lights/${encodeURIComponent(id)}/effect`, { method: 'PUT', json: { effect } }),

  rooms: () => call<Room[]>('/api/rooms'),
  /** The Active layout's rooms, whichever layout is open: what the home screen shows. */
  activeRooms: () => call<Room[]>('/api/rooms', { activeOnly: true }),

  layouts: () => call<LayoutSummary[]>('/api/layouts'),
  createLayout: (name?: string, from?: string) => call<LayoutSummary>('/api/layouts', { method: 'POST', json: { name, from } }),
  renameLayout: (id: string, name: string) => call<LayoutSummary>(`/api/layouts/${encodeURIComponent(id)}`, { method: 'PATCH', json: { name } }),
  activateLayout: (id: string) => call<LayoutSummary>(`/api/layouts/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
  deleteLayout: (id: string) => call(`/api/layouts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createRoom: (name: string, width: number, height: number, extra: { outline?: Pt[]; x?: number; y?: number } = {}) =>
    call<Room>('/api/rooms', { method: 'POST', json: { name, width, height, ...extra } }),
  importRooms: () => call<{ added: string[] }>('/api/rooms/import', { method: 'POST' }),
  updateRoom: (
    name: string,
    changes: Partial<{ x: number; y: number; width: number; height: number; outline: Pt[]; units: string; furniture: Furniture[]; name: string; openings: Opening[]; ceiling: number }>,
  ) => call<Room>(room(name), { method: 'PATCH', json: changes }),
  deleteRoom: (name: string) => call(room(name), { method: 'DELETE' }),
  roomBrightness: (name: string, brightness: number, activeOnly = false) =>
    call<{ results: { light_id: string; label: string; ok: boolean; error?: string }[]; failed: number }>(`${room(name)}/brightness`, { method: 'POST', json: { brightness }, activeOnly }),
  preferences: () => call<Preferences>('/api/preferences'),
  updatePreferences: (changes: Partial<Preferences>) => call<Preferences>('/api/preferences', { method: 'PATCH', json: changes }),
  roomPower: (name: string, on: boolean, activeOnly = false) =>
    call<{ results: { light_id: string; label: string; ok: boolean; error?: string }[]; failed: number }>(`${room(name)}/power`, { method: 'POST', json: { on }, activeOnly }),
  placeLight: (name: string, body: {
    light_id: string; x: number; y: number; rotation?: number; length?: number | null; label?: string;
    elevation?: number | 'auto'; role?: PinnableRole;
  }) =>
    call(`${room(name)}/lights`, { method: 'POST', json: body }),
  removeLight: (name: string, id: string) => call(`${room(name)}/lights/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  plan: () => call<HomePlan | null>('/api/plan'),
  uploadPlan: (file: File) => upload<HomePlan>('/api/plan/image', file),
  updatePlan: (changes: Partial<Pick<HomePlan, 'cm_per_px' | 'offset' | 'rotation' | 'opacity' | 'room_opacity'>>) =>
    call<HomePlan>('/api/plan', { method: 'PATCH', json: changes }),
  deletePlan: () => call('/api/plan', { method: 'DELETE' }),

  uploadPhoto: (name: string, file: File) => upload<Room>(`${room(name)}/photo`, file),
  deletePhoto: (name: string) => call(`${room(name)}/photo`, { method: 'DELETE' }),
  savePhotoTags: (name: string, tags: Record<string, PhotoSpot>) =>
    call<Room>(`${room(name)}/photo/tags`, { method: 'PUT', json: { tags } }),

  uploadImage: (file: File, mood: Mood, count = 5) =>
    upload<{ file: string; width: number; height: number; mood: Mood; theme: Swatch[] }>(`/api/images?mood=${mood}&count=${count}`, file),
  theme: (file: string, mood: Mood, count = 5) =>
    call<{ mood: Mood; theme: Swatch[] }>(`/api/images/${file}/theme?mood=${mood}&count=${count}`),
  imageUrl: (file: string) => `/api/images/${file}`,

  scenes: (activeOnly = false) => call<Scene[]>('/api/scenes', { activeOnly }),
  createScene: (scene: Partial<Scene>) => call<Scene>('/api/scenes', { method: 'POST', json: scene }),
  saveScene: (scene: Scene) => call<Scene>(`/api/scenes/${scene.id}`, { method: 'PUT', json: scene }),
  deleteScene: (id: string) => call(`/api/scenes/${id}`, { method: 'DELETE' }),
  preview: (scene: Partial<Scene> & { image: ImageLayer | null }) =>
    call<SceneResult[]>('/api/scenes/preview', { method: 'POST', json: scene }),
  hueScenes: () => call<HueSceneSet[]>('/api/hue-scenes'),
  hueScene: (name: string, set: string, scene: string) =>
    call<{ scene: Scene; preview: SceneResult[] }>(`${room(name)}/hue-scenes`, { method: 'POST', json: { set, name: scene } }),
  catalog: () => call<CatalogItem[]>('/api/catalog'),
  addPlannedLight: (name: string, body: { catalog: string; x: number; y: number; label?: string; rotation?: number; elevation?: number | 'auto' }) =>
    call<Placement>(`${room(name)}/planned-lights`, { method: 'POST', json: body }),
  swapPlannedLight: (name: string, plannedId: string, lightId: string) =>
    call<Placement>(`${room(name)}/planned-lights/${encodeURIComponent(plannedId)}/swap`, { method: 'POST', json: { light_id: lightId } }),
  setups: (name: string) => call<Setup[]>(`${room(name)}/setups`),
  addSetup: (name: string, index: number) => call<Placement[]>(`${room(name)}/setups/apply`, { method: 'POST', json: { index } }),
  setFloor: (name: string, photo: Pt[], plan: Pt[]) => call<Room>(`${room(name)}/photo/floor`, { method: 'PUT', json: { photo, plan } }),
  clearFloor: (name: string) => call<Room>(`${room(name)}/photo/floor`, { method: 'DELETE' }),
  suggest: (name: string, body: { mode: string; at?: string; palette_id?: string; count?: number; seed?: number; glare?: GlareLimits }, activeOnly = false) =>
    call<Suggestion[]>(`${room(name)}/suggest`, { method: 'POST', json: body, activeOnly }),
  captureLook: (name: string) =>
    call<{ look: RoomLook; skipped: string[]; at: string }>(`${room(name)}/look`, { method: 'POST' }),
  /** `layout` is the one the look was captured in (null = Active); left out, the open one. */
  applyLook: (name: string, look: RoomLook, layout?: string | null) =>
    call<{ results: { light_id: string; label: string; ok: boolean; error?: string }[]; failed: number }>(`${room(name)}/look/apply`, { method: 'POST', json: { look }, layout }),
  applySuggestion: (name: string, scene: Scene, activeOnly = false) =>
    call<{ scene: string; results: SceneResult[] }>(`${room(name)}/suggest/apply`, { method: 'POST', json: scene, activeOnly }),
  palettes: (params: { tag?: string; q?: string; limit?: number } = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return call<PaletteEntry[]>(`/api/palettes?${query}`);
  },
  groups: () => call<LightGroup[]>('/api/groups'),
  createGroup: (name: string, lights: string[]) => call<LightGroup>('/api/groups', { method: 'POST', json: { name, lights } }),
  updateGroup: (id: string, changes: { name?: string; lights?: string[] }) =>
    call<LightGroup>(`/api/groups/${encodeURIComponent(id)}`, { method: 'PATCH', json: changes }),
  deleteGroup: (id: string) => call(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveGroupLook: (id: string) => call<LightGroup>(`/api/groups/${encodeURIComponent(id)}/look`, { method: 'PUT' }),
  clearGroupLook: (id: string) => call<LightGroup>(`/api/groups/${encodeURIComponent(id)}/look`, { method: 'DELETE' }),
  applyGroup: (id: string) =>
    call<{ results: { light_id: string; label: string; ok: boolean; error?: string }[]; failed: number }>(`/api/groups/${encodeURIComponent(id)}/apply`, { method: 'POST' }),
  applyScene: (id: string, activeOnly = false) =>
    call<{ results: SceneResult[]; failed: number }>(`/api/scenes/${id}/apply`, { method: 'POST', activeOnly }),
};
