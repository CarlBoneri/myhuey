// Glare from where you sit: which lights bounce off a screen into your eyes, and which sit in
// your line of sight. Everything is computed in the browser from the room, so it follows a
// drag without a request. Plan coordinates: cm, x right, y down, z up; furniture fronts face +y
// at rotation 0 and turn clockwise, as in roles.py.
import type { Furniture, Placement, Room } from '../types';
import { EYE_SEATED, EYE_STANDING } from './photo';
import { heightOf, type Posture } from './rig';
import { arcOf, isCurved } from './screen';
import { add, dot, length, scale, sub, type Vec3 } from './view3d';

export type GlareStatus = 'screen_reflection' | 'direct_fov' | 'peripheral_warn' | 'bias_ok' | 'clear';
/** Worst first. */
export const STATUSES: GlareStatus[] = ['screen_reflection', 'direct_fov', 'peripheral_warn', 'bias_ok', 'clear'];

export const SCREEN_MARGIN_CM = 8;
export const BIAS_BEHIND_CM = 35;
export const BIAS_SIDE_CM = 30;
export const DIRECT_DEG = 30;
export const PERIPHERAL_DEG = 65;
export const REFLECTION_CAP = { brightness: 18, kelvin: 2700 };
export const DIRECT_CAP = 15;
export const PERIPHERAL_CAP = 35;
export const PERIPHERAL_MODES = ['code', 'study'];
export const STRIP_SAMPLES = 5;
export const BOX_SHRINK_CM = 0.5;
export const DEFAULT_MONITOR_TILT = -12;
/** A curved screen is traced as this many flat strips along its arc. */
export const FACETS = 12;
const SEAM_SHRINK_CM = 0.01;
const SEAT_FROM_SCREEN_CM = 60;
const SEAT_FROM_DESK_EDGE_CM = 30;
const DESKS = ['desk', 'desk-l', 'desk-standing'];

/**
 * One flat face of a screen: the whole screen when flat, one strip of the arc when curved. `id` is
 * the screen's furniture id, `facet` the strip's index. `uMin`..`uMax` is how far along `u` a
 * bounce may land and still count; the 8 cm margin is on the screen's outer edges only.
 */
export interface Display {
  id: string; facet: number; curved: boolean;
  center: Vec3; normal: Vec3; u: Vec3; v: Vec3; width: number; height: number; uMin: number; uMax: number;
}
export interface Box { id: string; x: number; y: number; rotation: number; width: number; depth: number; z0: number; z1: number }
export interface GlareScene {
  mode: string;
  eye: Vec3 | null;
  target: Vec3 | null;
  displays: Display[];
  lights: { light_id: string; label: string; points: Vec3[]; pinned_bias: boolean }[];
  boxes: Box[];
}
export interface Hazard { kind: GlareStatus; display: string | null; path: Vec3[] }
export interface GlareCap { brightness: number; kelvin: number | null }
export interface GlareLight { light_id: string; label: string; status: GlareStatus; angle: number | null; cap: GlareCap | null; hazards: Hazard[] }
export interface GlareReport { lights: GlareLight[]; hazards: number }

const rad = (deg: number) => (deg * Math.PI) / 180;
/** One rounding rule (halves go up, never -0), so a Python port can match it digit for digit. */
export const roundTo = (value: number, places: number) => Math.floor(value * 10 ** places + 0.5) / 10 ** places;
const r2 = (p: Vec3): Vec3 => [roundTo(p[0], 2), roundTo(p[1], 2), roundTo(p[2], 2)];
const front = (item: Furniture): [number, number] => [-Math.sin(rad(item.rotation)), Math.cos(rad(item.rotation))];
const isMonitor = (item: Furniture) => item.kind.startsWith('monitor');
export const isDisplay = (item: Furniture) => item.display ?? (isMonitor(item) || item.kind === 'tv');

/** Where the eyes are at the desk and the point they look at, or null without a desk or screen. */
export function seatOf(room: Room, posture: Posture = 'seated'): { eye: Vec3; target: Vec3 } | null {
  const desks = room.furniture.filter((item) => DESKS.includes(item.kind));
  const monitors = room.furniture.filter(isMonitor);
  let desk: Furniture | undefined;
  let screens: Furniture[] = [];
  for (const candidate of desks) {
    const reach = Math.max(candidate.width, candidate.depth) / 2 + 30;
    const onDesk = monitors.filter((m) => Math.hypot(m.x - candidate.x, m.y - candidate.y) <= reach);
    if (!desk || onDesk.length > screens.length) [desk, screens] = [candidate, onDesk];
  }
  if (!desk && monitors.length) screens = monitors;
  const eyeZ = posture === 'standing' || desk?.kind === 'desk-standing' ? EYE_STANDING : EYE_SEATED;
  if (screens.length) {
    const cx = screens.reduce((sum, s) => sum + s.x, 0) / screens.length;
    const cy = screens.reduce((sum, s) => sum + s.y, 0) / screens.length;
    const fx = screens.reduce((sum, s) => sum + front(s)[0], 0);
    const fy = screens.reduce((sum, s) => sum + front(s)[1], 0);
    const len = Math.hypot(fx, fy);
    const facing: [number, number] = len ? [fx / len, fy / len] : [0, -1];
    const height = screens.reduce((sum, s) => sum + (s.elevation ?? 0) + (s.height ?? 40) / 2, 0) / screens.length;
    return { eye: [cx + facing[0] * SEAT_FROM_SCREEN_CM, cy + facing[1] * SEAT_FROM_SCREEN_CM, eyeZ], target: [cx, cy, height] };
  }
  if (!desk) return null;
  const f = front(desk);
  const reach = desk.depth / 2 + SEAT_FROM_DESK_EDGE_CM;
  const eye: Vec3 = [desk.x + f[0] * reach, desk.y + f[1] * reach, eyeZ];
  return { eye, target: [eye[0] - f[0] * 100, eye[1] - f[1] * 100, eyeZ] };
}

/** A screen's plane: the middle of its front face, its unit normal (tilted), and its in-plane axes. */
export function displayOf(item: Furniture): Display {
  const f = front(item);
  const r = rad(item.rotation);
  const tau = rad(-(item.tilt ?? (isMonitor(item) ? DEFAULT_MONITOR_TILT : 0)));
  const height = item.height ?? 40;
  return {
    id: item.id,
    center: [item.x + (f[0] * item.depth) / 2, item.y + (f[1] * item.depth) / 2, (item.elevation ?? 0) + height / 2],
    normal: [f[0] * Math.cos(tau), f[1] * Math.cos(tau), Math.sin(tau)],
    u: [Math.cos(r), Math.sin(r), 0],
    v: [-f[0] * Math.sin(tau), -f[1] * Math.sin(tau), Math.cos(tau)],
    width: item.width,
    height,
    facet: 0,
    curved: false,
    uMin: -item.width / 2 - SCREEN_MARGIN_CM,
    uMax: item.width / 2 + SCREEN_MARGIN_CM,
  };
}

/**
 * A screen's faces: the screen itself when flat, FACETS strips along its arc when curved. The arc
 * bends around an axis `radius` in front of the panel's middle, along the panel's own up (`v`),
 * so a tilted screen's arc tilts with it. Strip i spans arc angles [-angle/2 + i*step, ... + step].
 */
export function facetsOf(item: Furniture): Display[] {
  const base = displayOf(item);
  if (!isCurved(item)) return [base];
  const { radius, angle } = arcOf(item);
  const axis = add(base.center, scale(base.normal, radius)); // a point on the axis of curvature
  const step = angle / FACETS;
  const half = step / 2;
  const facets: Display[] = [];
  for (let i = 0; i < FACETS; i++) {
    const phi = -angle / 2 + (i + 0.5) * step; // the strip's middle, 0 at the panel's middle, + toward base.u
    // The strip faces the axis; its middle is the middle of its chord, cos(half) of the radius in,
    // so neighbours meet edge to edge on the arc.
    const normal = add(scale(base.normal, Math.cos(phi)), scale(base.u, -Math.sin(phi)));
    const center = sub(axis, scale(normal, radius * Math.cos(half)));
    const u = add(scale(base.u, Math.cos(phi)), scale(base.normal, Math.sin(phi)));
    const width = 2 * radius * Math.sin(half);
    facets.push({
      id: item.id, facet: i, curved: true, center, normal, u, v: base.v, width, height: base.height,
      uMin: -width / 2 - (i === 0 ? SCREEN_MARGIN_CM : 0),
      uMax: width / 2 + (i === FACETS - 1 ? SCREEN_MARGIN_CM : 0),
    });
  }
  return facets;
}

/** The corners of a screen, for drawing it: bottom-left, bottom-right, top-right, top-left. */
export function displayCorners(display: Display): Vec3[] {
  const [hu, hv] = [scale(display.u, display.width / 2), scale(display.v, display.height / 2)];
  return [sub(sub(display.center, hu), hv), sub(add(display.center, hu), hv), add(add(display.center, hu), hv), add(sub(display.center, hu), hv)];
}

/**
 * Everything the tracer needs, as numbers. `lengthOf` gives a light's physical length when it
 * is a strip, bar, or tube (0 for a bulb); long lights are sampled along their length.
 */
export function glareScene(room: Room, posture: Posture, mode: string, lengthOf: (light: Placement) => number): GlareScene {
  const seat = seatOf(room, posture);
  return {
    mode,
    eye: seat?.eye ?? null,
    target: seat?.target ?? null,
    displays: room.furniture.filter(isDisplay).flatMap(facetsOf),
    lights: room.lights.map((light) => {
      const z = heightOf(light);
      const span = lengthOf(light);
      const points: Vec3[] = [];
      if (span > 30) {
        const [ux, uy] = [Math.cos(rad(light.rotation)), Math.sin(rad(light.rotation))];
        for (let i = 0; i < STRIP_SAMPLES; i++) {
          const along = -span / 2 + (span * i) / (STRIP_SAMPLES - 1);
          points.push([light.x + ux * along, light.y + uy * along, z]);
        }
      } else {
        points.push([light.x, light.y, z]);
      }
      return { light_id: light.light_id, label: light.label, points, pinned_bias: light.role === 'bias' };
    }),
    // A curved screen blocks light with its facets (see crossesFacet), not with a box that would
    // fill the hollow in front of it.
    boxes: room.furniture.filter((item) => item.kind !== 'rug' && !(isDisplay(item) && isCurved(item))).map((item) => ({
      id: item.id, x: item.x, y: item.y, rotation: item.rotation, width: item.width, depth: item.depth,
      z0: item.elevation ?? 0, z1: (item.elevation ?? 0) + (item.height ?? 75),
    })),
  };
}

/** Whether the segment from a to b passes through the box (shrunk a little, so a strip lying on a desk is not hidden by it). */
export function blocked(a: Vec3, b: Vec3, box: Box): boolean {
  const angle = rad(-box.rotation);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const local = (p: Vec3): Vec3 => {
    const [dx, dy] = [p[0] - box.x, p[1] - box.y];
    return [dx * cos - dy * sin, dx * sin + dy * cos, p[2]];
  };
  const [p, q] = [local(a), local(b)];
  const low: Vec3 = [-box.width / 2 + BOX_SHRINK_CM, -box.depth / 2 + BOX_SHRINK_CM, box.z0 + BOX_SHRINK_CM];
  const high: Vec3 = [box.width / 2 - BOX_SHRINK_CM, box.depth / 2 - BOX_SHRINK_CM, box.z1 - BOX_SHRINK_CM];
  let [t0, t1] = [0, 1];
  for (let axis = 0; axis < 3; axis++) {
    if (low[axis] >= high[axis]) return false; // thinner than the shrink: nothing to hit
    const d = q[axis] - p[axis];
    if (Math.abs(d) < 1e-9) {
      if (p[axis] < low[axis] || p[axis] > high[axis]) return false;
      continue;
    }
    const [near, far] = [(low[axis] - p[axis]) / d, (high[axis] - p[axis]) / d];
    t0 = Math.max(t0, Math.min(near, far));
    t1 = Math.min(t1, Math.max(near, far));
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Whether the segment from a to b passes through a facet. `shrink` trims the facet's edges: positive
 * for a screen shading itself (a bounce off one strip is not blocked by its neighbour at the shared
 * seam), negative for blocking other light (so a ray through a seam cannot slip between two strips).
 */
export function crossesFacet(a: Vec3, b: Vec3, facet: Display, shrink = SEAM_SHRINK_CM): boolean {
  const da = dot(sub(a, facet.center), facet.normal);
  const db = dot(sub(b, facet.center), facet.normal);
  if (da * db >= 0) return false;
  const t = da / (da - db);
  if (t < 1e-6 || t > 1 - 1e-6) return false;
  const offset = sub(add(a, scale(sub(b, a), t)), facet.center);
  return Math.abs(dot(offset, facet.u)) < facet.width / 2 - shrink && Math.abs(dot(offset, facet.v)) < facet.height / 2 - shrink;
}

/** Whether something solid lies between a and b: a box, or a curved screen's facet. `except` skips one screen. */
const hidden = (a: Vec3, b: Vec3, scene: Pick<GlareScene, 'boxes' | 'displays'>, except?: string) =>
  scene.boxes.some((box) => box.id !== except && blocked(a, b, box)) ||
  scene.displays.some((d) => d.curved && d.id !== except && crossesFacet(a, b, d, -SEAM_SHRINK_CM));

function reflection(point: Vec3, eye: Vec3, display: Display, scene: GlareScene): Vec3 | null {
  const side = dot(sub(point, display.center), display.normal);
  if (side <= 0 || dot(sub(eye, display.center), display.normal) <= 0) return null;
  const mirrored = sub(point, scale(display.normal, 2 * side));
  const ray = sub(mirrored, eye);
  const den = dot(ray, display.normal);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(display.center, eye), display.normal) / den;
  if (!(t > 0 && t < 1)) return null;
  const hit = add(eye, scale(ray, t));
  const offset = sub(hit, display.center);
  const along = dot(offset, display.u);
  if (along < display.uMin || along > display.uMax) return null;
  if (Math.abs(dot(offset, display.v)) > display.height / 2 + SCREEN_MARGIN_CM) return null;
  if (hidden(point, hit, scene, display.id) || hidden(hit, eye, scene, display.id)) return null;
  // A curved screen can shade itself: the way in or out may pass behind its other strips.
  const shaded = (d: Display) => d.id === display.id && d.facet !== display.facet && (crossesFacet(point, hit, d) || crossesFacet(hit, eye, d));
  if (display.curved && scene.displays.some(shaded)) return null;
  return hit;
}

const behindScreen = (point: Vec3, display: Display) => {
  const side = dot(sub(point, display.center), display.normal);
  return side < 0 && side >= -BIAS_BEHIND_CM && Math.abs(dot(sub(point, display.center), display.u)) <= display.width / 2 + BIAS_SIDE_CM;
};

/** Each light's glare status from the eye, with the bounce paths to draw and the level to keep it under. */
export function traceGlare(scene: GlareScene): GlareReport {
  const { eye, target } = scene;
  const lights = scene.lights.map((light): GlareLight => {
    if (!eye || !target) return { light_id: light.light_id, label: light.label, status: 'clear', angle: null, cap: null, hazards: [] };
    const gaze = sub(target, eye);
    let worst = STATUSES.length - 1;
    let smallest: number | null = null;
    const hazards: Hazard[] = [];
    const note = (hazard: Hazard) => {
      if (!hazards.some((h) => h.kind === hazard.kind && h.display === hazard.display)) hazards.push(hazard);
    };
    for (const point of light.points) {
      const toLight = sub(point, eye);
      const distance = length(toLight);
      const angle = distance && length(gaze)
        ? (Math.acos(Math.min(1, Math.max(-1, dot(gaze, toLight) / (length(gaze) * distance)))) * 180) / Math.PI
        : null;
      if (angle !== null && (smallest === null || angle < smallest)) smallest = angle;
      let status: GlareStatus = 'clear';
      for (const display of scene.displays) {
        const hit = reflection(point, eye, display, scene);
        if (hit) {
          status = 'screen_reflection';
          note({ kind: status, display: display.id, path: [r2(point), r2(hit), r2(eye)] });
        }
      }
      if (status === 'clear') {
        if (light.pinned_bias || scene.displays.some((display) => behindScreen(point, display))) status = 'bias_ok';
        else if (angle !== null && angle <= PERIPHERAL_DEG && !hidden(eye, point, scene)) {
          status = angle < DIRECT_DEG ? 'direct_fov' : 'peripheral_warn';
          note({ kind: status, display: null, path: [r2(point), r2(eye)] });
        }
      }
      worst = Math.min(worst, STATUSES.indexOf(status));
    }
    const status = STATUSES[worst];
    let cap: GlareCap | null = null;
    if (status === 'screen_reflection') cap = { ...REFLECTION_CAP };
    else if (status === 'direct_fov') cap = { brightness: DIRECT_CAP, kelvin: null };
    else if (status === 'peripheral_warn' && PERIPHERAL_MODES.includes(scene.mode)) cap = { brightness: PERIPHERAL_CAP, kelvin: null };
    return {
      light_id: light.light_id, label: light.label, status,
      angle: smallest === null ? null : roundTo(smallest, 1), cap,
      hazards: hazards.filter((h) => h.kind === status),
    };
  });
  return { lights, hazards: lights.filter((light) => light.cap).length };
}

export const STATUS_LABELS: Record<GlareStatus, string> = {
  screen_reflection: 'Reflects in the screen',
  direct_fov: 'In your line of sight',
  peripheral_warn: 'At the edge of your view',
  bias_ok: 'Bias light',
  clear: 'Clear',
};

export const statusTone = (status: GlareStatus): 'danger' | 'warn' | 'ok' | 'muted' =>
  status === 'screen_reflection' || status === 'direct_fov' ? 'danger' : status === 'peripheral_warn' ? 'warn' : status === 'bias_ok' ? 'ok' : 'muted';

export function capText(cap: GlareCap | null): string {
  if (!cap) return '';
  return `Keep at ${cap.brightness}% or less${cap.kelvin ? `, ${cap.kelvin} K or warmer` : ''}`;
}

export function summary(report: GlareReport): string {
  if (!report.hazards) return 'No glare found';
  return report.hazards === 1 ? '1 light needs attention' : `${report.hazards} lights need attention`;
}

/** The bridge brightness (1-254) to send to bring a lit light under its cap, or null to leave it alone. */
export function dimTo(cap: GlareCap | null, live: { on: boolean; brightness: number | null } | undefined): number | null {
  if (!cap || !live?.on || live.brightness === null) return null;
  const limit = Math.max(1, Math.round(cap.brightness * 2.54));
  return live.brightness > limit ? limit : null;
}
