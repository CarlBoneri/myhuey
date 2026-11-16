// The 3D room view's math: one look-at camera (used both for the orbiting cutaway and for the
// view from the seat), projection to the screen and back, and the room turned into faces.
// Plan coordinates as everywhere else: cm, x right, y down; z is height off the floor.
import type { Furniture, Opening, Pt, Room } from '../types';
import { bounds } from './geometry';

export type Vec3 = [number, number, number];
export interface Viewport { width: number; height: number }
/** `heading` is the plan direction the camera looks along (0 = +x, 90 = +y); `pitch` tilts it up. */
export interface Camera { eye: Vec3; heading: number; pitch: number; focal: number }
export interface Orbit { target: Vec3; yaw: number; pitch: number; distance: number; zoom: number }
export interface Projected { x: number; y: number; depth: number; scale: number }

export const NEAR_CM = 8;
export const ZOOM_RANGE: [number, number] = [0.45, 3.5];
export const PITCH_RANGE: [number, number] = [4, 90];

const rad = (deg: number) => (deg * Math.PI) / 180;
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const clamp = (value: number, [low, high]: [number, number]) => Math.min(high, Math.max(low, value));

/** The camera's right, up, and forward unit vectors in room coordinates. */
export function axes(camera: Camera): { right: Vec3; up: Vec3; forward: Vec3 } {
  const h = rad(camera.heading);
  const p = rad(camera.pitch);
  return {
    right: [-Math.sin(h), Math.cos(h), 0],
    up: [-Math.cos(h) * Math.sin(p), -Math.sin(h) * Math.sin(p), Math.cos(p)],
    forward: [Math.cos(h) * Math.cos(p), Math.sin(h) * Math.cos(p), Math.sin(p)],
  };
}

/** A room point as [right, up, depth] from the camera. */
export function toView(point: Vec3, camera: Camera): Vec3 {
  const { right, up, forward } = axes(camera);
  const v = sub(point, camera.eye);
  return [dot(v, right), dot(v, up), dot(v, forward)];
}

export function projectView(view: Vec3, camera: Camera, viewport: Viewport, pan: Pt = [0, 0]): Projected {
  const depth = Math.max(view[2], NEAR_CM);
  const k = camera.focal / depth;
  return { x: viewport.width / 2 + view[0] * k + pan[0], y: viewport.height / 2 - view[1] * k + pan[1], depth: view[2], scale: k };
}

export const project = (point: Vec3, camera: Camera, viewport: Viewport, pan: Pt = [0, 0]): Projected =>
  projectView(toView(point, camera), camera, viewport, pan);

/**
 * The orbiting camera: it circles `target` at `distance`, `pitch` degrees above the floor
 * (90 = straight down, drawn like the plan), turned `yaw` degrees. `base` is pixels per cm at
 * the target when zoom is 1, so zooming never changes the perspective, only the size.
 */
export function orbitCamera(orbit: Orbit, base: number): Camera {
  const camera: Camera = { eye: [0, 0, 0], heading: orbit.yaw - 90, pitch: -orbit.pitch, focal: base * orbit.zoom * orbit.distance };
  camera.eye = sub(orbit.target, scale(axes(camera).forward, orbit.distance));
  return camera;
}

/** The camera at the eye, looking at `target`, turned by a head-look offset. */
export function seatCamera(eye: Vec3, target: Vec3, look: { yaw: number; pitch: number }, zoom: number, viewport: Viewport): Camera {
  const v = sub(target, eye);
  const flat = Math.hypot(v[0], v[1]);
  const heading = (Math.atan2(v[1], v[0]) * 180) / Math.PI + look.yaw;
  const pitch = (Math.atan2(v[2], flat || 1) * 180) / Math.PI + look.pitch;
  // A 110 degree field of view across the viewport's diagonal at zoom 1: wide enough to take in
  // a desk's worth of screens from 60 cm, in a wide window or a tall one.
  return { eye, heading, pitch, focal: (Math.hypot(viewport.width, viewport.height) / 2 / Math.tan(rad(55))) * zoom };
}

/** Where the ray through a screen point meets the horizontal plane at height `z`, or null. */
export function unprojectToHeight(screen: Pt, z: number, camera: Camera, viewport: Viewport, pan: Pt = [0, 0]): Pt | null {
  const { right, up, forward } = axes(camera);
  const a = (screen[0] - viewport.width / 2 - pan[0]) / camera.focal;
  const b = -(screen[1] - viewport.height / 2 - pan[1]) / camera.focal;
  const direction = add(add(scale(right, a), scale(up, b)), forward);
  if (Math.abs(direction[2]) < 1e-6) return null;
  const t = (z - camera.eye[2]) / direction[2];
  if (t <= 0) return null; // the plane is behind the camera along this ray
  return [camera.eye[0] + direction[0] * t, camera.eye[1] + direction[1] * t];
}

/** A polygon in view space cut at the near plane, so nothing behind the camera is drawn. */
export function clipNear(points: Vec3[], near = NEAR_CM): Vec3[] {
  const out: Vec3[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const [ain, bin] = [a[2] >= near, b[2] >= near];
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (near - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
    }
  });
  return out.length >= 3 || points.length < 3 ? out : [];
}

/** A polygon's screen points, clipped at the near plane. Empty when it is all behind the camera. */
export function projectPolygon(points: Vec3[], camera: Camera, viewport: Viewport, pan: Pt = [0, 0]): Pt[] {
  return clipNear(points.map((p) => toView(p, camera))).map((v) => {
    const p = projectView(v, camera, viewport, pan);
    return [p.x, p.y] as Pt;
  });
}

/** Zoom by `factor` keeping the screen point under the cursor where it is. */
export function zoomAt(zoom: number, pan: Pt, factor: number, cursor: Pt, viewport: Viewport): { zoom: number; pan: Pt } {
  const next = clamp(zoom * factor, ZOOM_RANGE);
  const ratio = next / zoom;
  const cx = cursor[0] - viewport.width / 2;
  const cy = cursor[1] - viewport.height / 2;
  return { zoom: next, pan: [cx - (cx - pan[0]) * ratio, cy - (cy - pan[1]) * ratio] };
}

/** An orbit that shows the whole room: centered on it, far enough back to fit the viewport. */
export function fitOrbit(room: Pick<Room, 'outline' | 'ceiling'>, viewport: Viewport, yaw = -30, pitch = 34): { orbit: Orbit; base: number } {
  const box = bounds(room.outline);
  const [w, d] = [box.maxX - box.minX, box.maxY - box.minY];
  const radius = Math.hypot(w, d, room.ceiling) / 2;
  const target: Vec3 = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, room.ceiling * 0.4];
  const base = (Math.min(viewport.width, viewport.height) * 0.46) / radius;
  return { orbit: { target, yaw, pitch, distance: radius * 3.2, zoom: 1 }, base };
}

// Faces

export interface Wall {
  edge: number;
  a: Pt;
  b: Pt;
  /** Unit normal pointing into the room. */
  inward: Pt;
  quad: Vec3[];
  openings: { opening: Opening; quad: Vec3[] }[];
}

/** Positive when the outline runs clockwise on screen (y down). */
export function winding(outline: Pt[]): number {
  let sum = 0;
  outline.forEach(([x1, y1], i) => {
    const [x2, y2] = outline[(i + 1) % outline.length];
    sum += x1 * y2 - x2 * y1;
  });
  return Math.sign(sum) || 1;
}

/** One wall per outline edge, floor to ceiling, with its doors and windows at their real heights. */
export function walls(room: Pick<Room, 'outline' | 'ceiling' | 'openings'>): Wall[] {
  const turn = winding(room.outline);
  return room.outline.map((a, edge) => {
    const b = room.outline[(edge + 1) % room.outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const along: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const inward: Pt = [-along[1] * turn, along[0] * turn];
    const at = (offset: number, z: number): Vec3 => [a[0] + along[0] * offset, a[1] + along[1] * offset, z];
    const openings = room.openings.filter((o) => o.edge === edge).map((opening) => {
      const low = opening.kind === 'window' ? opening.sill ?? 90 : 0;
      const high = Math.min(room.ceiling, opening.top ?? (opening.kind === 'window' ? 210 : 203));
      const [start, end] = [opening.offset, Math.min(len, opening.offset + opening.width)];
      return { opening, quad: [at(start, low), at(end, low), at(end, high), at(start, high)] };
    });
    return { edge, a, b, inward, quad: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], room.ceiling], [a[0], a[1], room.ceiling]], openings };
  });
}

/**
 * How much a wall faces the camera, from -1 to 1: positive when the camera is on the room side
 * of the wall (a back wall, seen from inside), negative when the wall stands between the camera
 * and the room and has to be cut away to see in.
 */
export function wallFacing(wall: Wall, eye: Vec3): number {
  const mid: Pt = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
  const to: Pt = [eye[0] - mid[0], eye[1] - mid[1]];
  const distance = Math.hypot(to[0], to[1]) || 1;
  return (to[0] * wall.inward[0] + to[1] * wall.inward[1]) / distance;
}

/**
 * How solid to draw a wall (0 = invisible, 1 = opaque) given how much it faces the camera
 * (see wallFacing). Back walls should read as walls; walls in the way should not hide the room.
 */
export function wallOpacity(facing: number): number {
  // A smooth ramp through edge-on, so a wall fades as it swings past the camera instead of popping:
  // 0.04 in front of the room, 0.3 behind it, blended over the 0.3 either side of edge-on.
  const t = clamp((facing + 0.3) / 0.6, [0, 1]);
  return 0.04 + 0.26 * t * t * (3 - 2 * t);
}

export interface Face { points: Vec3[]; normal: Vec3; top: boolean }

const turned = (item: Pick<Furniture, 'x' | 'y' | 'rotation'>, lx: number, ly: number): Pt => {
  const r = rad(item.rotation);
  return [item.x + lx * Math.cos(r) - ly * Math.sin(r), item.y + lx * Math.sin(r) + ly * Math.cos(r)];
};

/** A furniture piece's footprint corners in the room (ellipses as a 20-sided shape). */
export function footprint(item: Furniture): Pt[] {
  const [hw, hd] = [item.width / 2, item.depth / 2];
  if (item.shape === 'ellipse') {
    return Array.from({ length: 20 }, (_, i) => {
      const angle = (i / 20) * Math.PI * 2;
      return turned(item, Math.cos(angle) * hw, Math.sin(angle) * hd);
    });
  }
  return [turned(item, -hw, -hd), turned(item, hw, -hd), turned(item, hw, hd), turned(item, -hw, hd)];
}

/** The faces of a furniture piece as a prism from its elevation to its top. */
export function prism(item: Furniture): Face[] {
  const base = footprint(item);
  const z0 = item.elevation ?? 0;
  const z1 = z0 + (item.height ?? 75);
  const faces: Face[] = [
    { points: base.map(([x, y]) => [x, y, z1] as Vec3), normal: [0, 0, 1], top: true },
    { points: base.map(([x, y]) => [x, y, z0] as Vec3).reverse(), normal: [0, 0, -1], top: false },
  ];
  const turn = winding(base);
  base.forEach((a, i) => {
    const b = base[(i + 1) % base.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Outward is the opposite of the inward normal used for walls.
    const normal: Vec3 = [((b[1] - a[1]) / len) * turn, (-(b[0] - a[0]) / len) * turn, 0];
    faces.push({ points: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], normal, top: false });
  });
  return faces;
}

/** Whether a face shows its front to the camera. */
export function facesCamera(face: Face, eye: Vec3): boolean {
  return dot(face.normal, sub(eye, face.points[0])) > 0;
}

/** Brightness of a face from 0.55 to 1, lit from above and a little from the front-left. */
export function shade(normal: Vec3): number {
  const light: Vec3 = [-0.35, 0.45, 0.82];
  return 0.55 + 0.45 * Math.max(0, dot(normal, light));
}

export const centroid = (points: Vec3[]): Vec3 => scale(points.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3), 1 / points.length);

/** A circle on the floor as a polygon: the pool of light under a fixture. */
export function floorCircle(x: number, y: number, radius: number, count = 28): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 0.5] as Vec3;
  });
}

/** How wide a light's pool on the floor is, and how strong: wider and fainter the higher it hangs. */
export function lightPool(height: number, brightness: number): { radius: number; opacity: number } {
  const radius = clamp(45 + height * 0.55, [45, 190]);
  const level = clamp(brightness, [0, 100]) / 100;
  return { radius, opacity: Math.round((0.05 + 0.2 * level) * (1 - clamp(height / 600, [0, 0.6])) * 1000) / 1000 };
}

/** Grid lines across the room's bounding box at `step` cm, as floor segments. */
export function floorGrid(outline: Pt[], step: number): [Vec3, Vec3][] {
  const box = bounds(outline);
  const lines: [Vec3, Vec3][] = [];
  for (let x = Math.ceil(box.minX / step) * step; x <= box.maxX; x += step) lines.push([[x, box.minY, 0], [x, box.maxY, 0]]);
  for (let y = Math.ceil(box.minY / step) * step; y <= box.maxY; y += step) lines.push([[box.minX, y, 0], [box.maxX, y, 0]]);
  return lines;
}
