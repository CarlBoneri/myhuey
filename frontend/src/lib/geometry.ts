import type { Pt } from '../types';

export function bounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function area(points: Pt[]): number {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}

export function pointInPolygon([x, y]: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[j];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

export const pathOf = (points: Pt[]) => (points.length ? `M${points.map((p) => p.join(',')).join('L')}Z` : '');

/** Translate an outline so its bounding box starts at (0, 0). Returns the shift applied. */
export function normalizeOutline(points: Pt[]): { outline: Pt[]; dx: number; dy: number } {
  const { minX, minY } = bounds(points);
  return { outline: points.map(([x, y]) => [x - minX, y - minY] as Pt), dx: -minX, dy: -minY };
}

/** The closest point on segment ab to p, and how far along (0-1) it is. */
export function nearestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; t: number; distance: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq)) : 0;
  const point: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { point, t, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, count = 36): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry] as Pt;
  });
}

export function rectPoints(a: Pt, b: Pt): Pt[] {
  const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

/** Drop points closer than `minGap` to the previous one, for freehand lassos. */
export function simplify(points: Pt[], minGap: number): Pt[] {
  const kept: Pt[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minGap) kept.push(p);
  }
  return kept;
}

export const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Where to put an image turned `rotation` degrees (clockwise, around its center) so it
 * covers a room's bounding box. `stretch` makes the turned image's bounds equal the box
 * exactly; `cover` keeps the image's `aspect` (width / height) and covers the box. Near 45°
 * an exact stretch is impossible, so stretch falls back to cover.
 */
export function fitImage(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  rotation: number,
  aspect: number,
  mode: 'stretch' | 'cover',
): { x: number; y: number; width: number; height: number } {
  const W = box.maxX - box.minX;
  const H = box.maxY - box.minY;
  const r = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  let width = 0;
  let height = 0;
  const det = c * c - s * s;
  if (mode === 'stretch' && Math.abs(det) > 0.2) {
    // Solve w·c + h·s = W and w·s + h·c = H.
    width = (W * c - H * s) / det;
    height = (H * c - W * s) / det;
  }
  if (mode === 'cover' || Math.abs(det) <= 0.2 || !(width > 0 && height > 0)) {
    width = Math.max(W / (c + s / aspect), H / (s + c / aspect));
    height = width / aspect;
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    x: round(box.minX + W / 2 - width / 2),
    y: round(box.minY + H / 2 - height / 2),
    width: round(width),
    height: round(height),
  };
}

function distanceToOutline(p: Pt, polygon: Pt[]): number {
  let best = Infinity;
  polygon.forEach((a, i) => { best = Math.min(best, nearestOnSegment(p, a, polygon[(i + 1) % polygon.length]).distance); });
  return best;
}

/**
 * Where to write a room's name: the point inside the outline farthest from every wall
 * (an approximate pole of inaccessibility). A bounding-box corner can sit outside a
 * slanted or L-shaped room; this never does. Coarse grid, then two finer passes.
 */
export function labelPoint(polygon: Pt[]): Pt {
  const { minX, minY, maxX, maxY } = bounds(polygon);
  let best: Pt = polygon[0];
  let bestDistance = -1;
  let cell = Math.max(maxX - minX, maxY - minY) / 24;
  let [x0, y0, x1, y1] = [minX, minY, maxX, maxY];
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  for (let pass = 0; pass < 3 && cell > 0; pass++) {
    for (let x = x0 + cell / 2; x <= x1; x += cell) {
      for (let y = y0 + cell / 2; y <= y1; y += cell) {
        if (!pointInPolygon([x, y], polygon)) continue;
        // Many points tie in a plain rectangle (its whole midline); prefer the one nearest the middle.
        const d = distanceToOutline([x, y], polygon);
        const tie = Math.abs(d - bestDistance) < 1e-6 * (1 + d);
        if (d > bestDistance && !tie) [best, bestDistance] = [[x, y], d];
        else if (tie && Math.hypot(x - cx, y - cy) < Math.hypot(best[0] - cx, best[1] - cy)) best = [x, y];
      }
    }
    [x0, y0, x1, y1] = [best[0] - cell, best[1] - cell, best[0] + cell, best[1] + cell];
    cell /= 6;
  }
  return best;
}
