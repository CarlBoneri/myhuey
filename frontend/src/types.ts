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
  white?: number;
}

export interface Placement {
  light_id: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  length: number | null;
  product: { archetype?: string; productname?: string; modelid?: string; catalog?: string };
  metadata: Record<string, unknown>;
  /** A catalog light that isn't installed yet: in roles and suggestions, never sent to the bridge. */
  planned?: boolean;
  elevation?: number | null; // cm; null = worked out from the product
  role?: PinnableRole;
  resolved_elevation?: number;
  resolved_roles?: Record<string, string>; // the Auto role per focus: desk, read, sofa
}

export type PinnableRole = 'auto' | 'bias' | 'task' | 'view';

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
  /** cm from the floor to the piece's bottom, and its own height. */
  elevation?: number;
  height?: number;
}

export interface Opening {
  id: string;
  kind: 'door' | 'window';
  /** The outline edge from corner `edge` to the next one. */
  edge: number;
  offset: number;
  width: number;
  sill: number | null;
  top: number | null;
}

/** A floor-plan image under the home: image pixel p lands at offset + rotate(rotation)(p * cm_per_px). */
export interface HomePlan {
  file: string;
  cm_per_px: number;
  offset: Pt;
  rotation: number;
  opacity: number;
  width: number;
  height: number;
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
  /** "light:<id>", "furniture:<id>", or "opening:<id>" → where it appears in the photo. */
  tags: Record<string, PhotoSpot>;
  /** Four floor points on the photo (0-1) and the plan points (cm) they are. */
  floor_transform?: { photo: Pt[]; plan: Pt[] } | null;
}

export interface HueSceneSet {
  name: string;
  scenes: { name: string; bri: number; colors: string[] }[];
}

export interface CatalogItem {
  id: string;
  label: string;
  archetype: string;
  productname: string;
  color: 'gradient' | 'color' | 'white';
  kind: 'bias' | 'task' | 'side' | 'ambient';
}

export interface SetupLight {
  catalog: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  elevation: number;
  fixed_elevation: number | null;
  role: string;
  why: string;
}

export interface Setup {
  name: string;
  hint: string;
  lights: SetupLight[];
  modes: Record<string, { palette: string; kelvin: number; summary: string; roles: Record<string, string>; preview: SceneResult[] }>;
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
  ceiling: number;
  openings: Opening[];
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
  rotation: number;
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
  origin?: SceneOrigin | null;
}

export interface SceneOrigin {
  mode?: string;
  palette_id?: string;
  palette_name?: string;
  at?: string;
}

export interface PaletteEntry {
  id: string;
  name: string;
  colors: string[];
  tags: string[];
  source: 'colourlovers' | 'met' | 'generated' | string;
  credit: { author?: string; title?: string; artist?: string; url?: string; license?: string; scheme?: string; by?: string; set?: string };
}

export interface Suggestion {
  scene: Scene;
  palette: PaletteEntry;
  roles: Record<string, string>;
  preview: SceneResult[];
  white: string;
  kelvin: number;
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
  color_temp?: number | null;
  applied?: boolean;
  error?: string;
  warning?: string;
}

export interface Preferences {
  room_sliders: boolean;
  room_sliders_when_on_only: boolean;
  show_light_glow: boolean;
  poll_seconds: 0 | 2 | 5 | 10 | 30;
  command_gap_ms: 100 | 150 | 200 | 300;
  default_units: Units;
  wake_time: string;
  bed_time: string;
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

/** A saved layout. One is Active and runs the app; the others are sandboxes. */
export interface LayoutSummary {
  id: string;
  name: string;
  active: boolean;
  rooms: number;
  scenes: number;
  updated: number | null;
}
