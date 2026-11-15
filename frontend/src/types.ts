// Shapes of what the MyHuey API returns. Every length is in centimeters.

export type Pt = [number, number];
export type Units = 'imperial' | 'metric';

export interface Profile {
  kind: 'round' | 'strip' | 'bar' | 'tube' | 'column' | 'string';
  length: number;
  width: number;
  icon: string;
  gradient: boolean;
  adjustable: boolean;
  linear: boolean;
  label: string;
}

export interface BridgeLight {
  id: string;
  name: string;
  type: string;
  on: boolean;
  reachable: boolean;
  brightness: number | null;
  color: string | null;
  color_temp: number | null;
  supports_color: boolean;
  supports_color_temp: boolean;
  archetype: string;
  productname: string;
  modelid: string;
  gradient_points: number;
  profile: Profile;
  gradient: LightGradient | null;
  effect: { current: string; values: string[] } | null;
}

export interface LightGradient {
  points: string[];
  mode: string;
  modes: string[];
  points_capable: number;
  pixel_count: number;
}

export interface LightOverride {
  colors?: string[];
  mode?: string;
  effect?: string;
  brightness?: number;
  on?: boolean;
}

export interface Placement {
  light_id: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  length: number | null;
  product: { archetype?: string; productname?: string; modelid?: string };
  metadata: Record<string, unknown>;
}

export interface Furniture {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  shape: 'rect' | 'ellipse';
}

export interface PhotoSpot {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface RoomPhoto {
  file: string;
  width: number;
  height: number;
  placements: Record<string, PhotoSpot>;
}

export interface Room {
  name: string;
  x: number;
  y: number;
  units: Units;
  outline: Pt[];
  width: number;
  height: number;
  lights: Placement[];
  furniture: Furniture[];
  photo: RoomPhoto | null;
}

export interface Swatch {
  color: string;
  x: number;
  y: number;
}

export type Mood = 'colorful' | 'bright' | 'muted' | 'deep' | 'dark';

export interface Zone {
  id: string;
  points: Pt[];
  color: string;
  brightness: number;
  name: string;
}

export interface ImageLayer {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  brightness: number;
  brightness_from_image: boolean;
  mood: Mood;
  picks: Swatch[];
}

export type BaseMode = 'off' | 'keep' | 'color' | 'nearest';

export interface Scene {
  id: string;
  name: string;
  room: string;
  zones: Zone[];
  image: ImageLayer | null;
  base_mode: BaseMode;
  base_color: string;
  base_brightness: number;
  palette: string[];
  updated_at: string;
  overrides: Record<string, LightOverride>;
}

export interface SceneResult {
  light_id: string;
  label: string;
  on: boolean;
  keep: boolean;
  color: string | null;
  xy: [number, number] | null;
  brightness: number;
  gradient: string[] | null;
  mode: string | null;
  effect: string | null;
  override: boolean;
  applied?: boolean;
  error?: string;
  warning?: string;
}

export interface SetupStatus {
  configured: boolean;
  bridge: { ip?: string };
  pairing_window: number;
}

export interface ProfileTable {
  default: Profile;
  archetype: Record<string, Profile>;
  product: Record<string, Profile>;
  model: Record<string, Profile>;
}
