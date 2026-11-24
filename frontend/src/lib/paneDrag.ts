import { clamp } from './view3d';

/** The 3D/glare split after dragging the row bar: where it started, plus the distance moved over the column's height. */
export const splitAfterDrag = (startSplit: number, startY: number, y: number, height: number) =>
  clamp(startSplit + (y - startY) / height, [0.2, 0.85]);

/** The inspector's width after dragging its bar: the inspector is on the right, so moving left widens it. */
export const inspectorAfterDrag = (startWidth: number, startX: number, x: number) =>
  clamp(startWidth + (startX - x), [280, 680]);

/** How wide a side column of panels can be (px). */
export const SIDEBAR_WIDTH = { min: 280, max: 760, initial: 360 };

/** A sidebar's width after dragging its bar: sidebars sit on the right, so moving left widens them. */
export const sidebarAfterDrag = (startWidth: number, startX: number, x: number) =>
  clamp(startWidth + (startX - x), [SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max]);

/** Folding the glare table in a narrow window leaves the 3D view in a long column: bring it to the top. Unfolding, or a wide window, scrolls nothing. */
export const shouldScrollOnFold = (folding: boolean, narrow: boolean) => folding && narrow;

/** The lighting panel lives in the inspector, so opening it unfolds a folded inspector; anything else is left as it is. */
export function unfoldForLighting<T extends { collapsed: { inspector: boolean } }>(sizes: T, lightingOpen: boolean): T {
  if (!lightingOpen || !sizes.collapsed.inspector) return sizes;
  return { ...sizes, collapsed: { ...sizes.collapsed, inspector: false } };
}
