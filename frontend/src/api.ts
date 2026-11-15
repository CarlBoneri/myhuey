import type { BridgeInfo } from './lib/setupFlow';
import type { HomePlan, Opening, ImageLayer, Mood, ProfileTable, Room, Scene, SceneResult, SetupStatus, Swatch, BridgeLight, Furniture, PhotoSpot, Pt } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const request: RequestInit = { ...rest };
  if (json !== undefined) {
    request.body = JSON.stringify(json);
    request.headers = { 'Content-Type': 'application/json', ...(rest.headers || {}) };
  }
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
    throw new ApiError(message, response.status);
  }
  return body as T;
}

/** The document version this page was built for. A server reporting less was started before an update. */
export const API_VERSION = 3;

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
  createRoom: (name: string, width: number, height: number, extra: { outline?: Pt[]; x?: number; y?: number } = {}) =>
    call<Room>('/api/rooms', { method: 'POST', json: { name, width, height, ...extra } }),
  importRooms: () => call<{ added: string[] }>('/api/rooms/import', { method: 'POST' }),
  updateRoom: (
    name: string,
    changes: Partial<{ x: number; y: number; width: number; height: number; outline: Pt[]; units: string; furniture: Furniture[]; name: string; openings: Opening[]; ceiling: number }>,
  ) => call<Room>(room(name), { method: 'PATCH', json: changes }),
  deleteRoom: (name: string) => call(room(name), { method: 'DELETE' }),
  roomPower: (name: string, on: boolean) =>
    call<{ results: { light_id: string; label: string; ok: boolean; error?: string }[]; failed: number }>(`${room(name)}/power`, { method: 'POST', json: { on } }),
  placeLight: (name: string, body: { light_id: string; x: number; y: number; rotation?: number; length?: number | null; label?: string }) =>
    call(`${room(name)}/lights`, { method: 'POST', json: body }),
  removeLight: (name: string, id: string) => call(`${room(name)}/lights/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  plan: () => call<HomePlan | null>('/api/plan'),
  uploadPlan: (file: File) => upload<HomePlan>('/api/plan/image', file),
  updatePlan: (changes: Partial<Pick<HomePlan, 'cm_per_px' | 'offset' | 'rotation' | 'opacity'>>) =>
    call<HomePlan>('/api/plan', { method: 'PATCH', json: changes }),
  deletePlan: () => call('/api/plan', { method: 'DELETE' }),

  uploadPhoto: (name: string, file: File) => upload<Room>(`${room(name)}/photo`, file),
  deletePhoto: (name: string) => call(`${room(name)}/photo`, { method: 'DELETE' }),
  savePhotoPlacements: (name: string, placements: Record<string, PhotoSpot>) =>
    call<Room>(`${room(name)}/photo/placements`, { method: 'PUT', json: { placements } }),

  uploadImage: (file: File, mood: Mood, count = 5) =>
    upload<{ file: string; width: number; height: number; mood: Mood; theme: Swatch[] }>(`/api/images?mood=${mood}&count=${count}`, file),
  theme: (file: string, mood: Mood, count = 5) =>
    call<{ mood: Mood; theme: Swatch[] }>(`/api/images/${file}/theme?mood=${mood}&count=${count}`),
  imageUrl: (file: string) => `/api/images/${file}`,

  scenes: () => call<Scene[]>('/api/scenes'),
  createScene: (scene: Partial<Scene>) => call<Scene>('/api/scenes', { method: 'POST', json: scene }),
  saveScene: (scene: Scene) => call<Scene>(`/api/scenes/${scene.id}`, { method: 'PUT', json: scene }),
  deleteScene: (id: string) => call(`/api/scenes/${id}`, { method: 'DELETE' }),
  preview: (scene: Partial<Scene> & { image: ImageLayer | null }) =>
    call<SceneResult[]>('/api/scenes/preview', { method: 'POST', json: scene }),
  applyScene: (id: string) => call<{ results: SceneResult[]; failed: number }>(`/api/scenes/${id}/apply`, { method: 'POST' }),
};
