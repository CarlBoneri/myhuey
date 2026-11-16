import { clamp } from './view3d';

/** The 3D/glare split after dragging the row bar: where it started, plus the distance moved over the column's height. */
export const splitAfterDrag = (startSplit: number, startY: number, y: number, height: number) =>
  clamp(startSplit + (y - startY) / height, [0.2, 0.85]);

/** The inspector's width after dragging its bar: the inspector is on the right, so moving left widens it. */
export const inspectorAfterDrag = (startWidth: number, startX: number, x: number) =>
  clamp(startWidth + (startX - x), [280, 680]);
