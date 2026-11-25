import type { Theme, ThemeId } from './lib/theme';
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
  /** The desk set this light belongs to. */
  set?: string | null;
  /** Stuck on this screen's back, facing the wall: its place comes from the screen. */
  mount?: { screen: string } | null;
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
  /** The 3D view treats monitors and TVs as screens; not saved. */
  display?: boolean;
  /** Degrees a screen leans; negative leans back. Unset: monitors lean back 12°. */
  tilt?: number | null;
  /** A screen's curve radius in mm, as printed on the box (1000 = 1000R); unset or null is flat. */
  curve?: number | null;
  /** The desk set this piece belongs to. */
  set?: string | null;
  /** A chair's seat height (cm) when it is where you sit; null otherwise. */
  seat?: number | null;
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
  /** How solid room shapes are drawn over the plan image (0 to 1). */
  room_opacity: number;
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
  /** The Hue room this room follows, once refresh has linked them. */
  hue_room?: string | null;
  /** Desk sets placed here; members carry the id in their `set`. */
  desk_sets?: DeskSet[];
}

/** A desk set placed in a room: its members move as one, around the `base` piece. */
export interface DeskSet { id: string; name: string; base: string }

/** A piece in a desk design or a set opened for editing, in desk-local cm (base desk at 0, 0, front +y). */
export type DeskItem = Omit<Furniture, 'id'> & { key: string; id?: string };
/** A light in a desk design: a catalog light, or (editing a placed set) the room light it is. */
export interface DeskLight {
  key: string; catalog: string | null; label: string; x: number; y: number; rotation: number;
  length: number | null; elevation: number | null; role: string; mount: { screen: string } | null;
  light_id?: string; planned?: boolean;
}
export interface DeskDesign { id: string; name: string; items: DeskItem[]; lights: DeskLight[] }
/** A placed set in desk-local coordinates, as the designer edits it. */
export interface DeskSetLocal { set: string; name: string; items: DeskItem[]; lights: DeskLight[] }

/** `also`: on an arrival, the room it comes from is left alone, so the light stays there too. */
export interface RefreshMove { light_id: string; label: string; other: string | null; also: boolean }
export interface RoomRefresh {
  room: string;
  hue_room: string | null;
  status: 'new' | 'changed' | 'unchanged' | 'left_alone';
  arrive: RefreshMove[];
  leave: RefreshMove[];
  link: boolean;
  /** The Hue room's name; null when the room is left alone. */
  hue_name: string | null;
}
export interface RefreshPlan { rooms: RoomRefresh[]; fingerprint: string }

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
  guide?: SuggestionGuide;
}

export interface SuggestionGuide {
  time: string;
  glare: string[];
  checked: boolean;
  /** How many lights this card holds for glare. */
  held?: number;
}

export interface LookEntry {
  on: boolean;
  bri?: number;
  xy?: [number, number];
  ct?: number;
  gradient?: { colors: string[]; mode: string | null };
  effect?: string | null;
}

export type RoomLook = Record<string, LookEntry>;

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
  theme: Theme;
  theme_dark: ThemeId;
  theme_light: ThemeId;
  reduce_transparency: 'auto' | 'on' | 'off';
  room_sliders: boolean;
  room_sliders_when_on_only: boolean;
  show_light_glow: boolean;
  poll_seconds: 0 | 2 | 5 | 10 | 30;
  command_gap_ms: 100 | 150 | 200 | 300;
  default_units: Units;
  wake_time: string;
  bed_time: string;
  /** Your eyes above the chair seat, cm (46 cm seat + 69 = 115). */
  eye_sitting: number;
  eye_standing: number;
  /** Eyes to screens when no chair is marked as your seat, cm. */
  screen_distance: number;
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

/** A saved light group (app-wide). Its look, when saved, puts each light back as it was. */
export interface LightGroup {
  id: string;
  name: string;
  lights: string[];
  look: Record<string, { on: boolean; bri?: number; xy?: [number, number]; ct?: number; gradient?: { colors: string[]; mode: string | null } }> | null;
}
