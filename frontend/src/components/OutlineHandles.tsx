import { useRef } from 'react';
import { useDrag, usePlan } from './PlanCanvas';
import { snapCorner } from '../lib/plan';
import type { Pt, Units } from '../types';

/** Where a dragged corner lands, given its two neighbors and whether Alt (free) is held. */
export type CornerSnap = (target: Pt, neighbors: [Pt, Pt], free: boolean) => Pt;

/**
 * Corner and edge handles for reshaping an outline: drag a corner, drag an edge's + to add a
 * corner, double-click a corner to remove it. Coordinates are the outline's own (room cm).
 */
export function OutlineHandles({ outline, units, onChange, onCommit, snapTo, origin = [0, 0] }: {
  outline: Pt[]; units: Units; onChange: (o: Pt[]) => void; onCommit: (o: Pt[]) => void;
  /** Where the outline's (0, 0) sits on the canvas, when it's drawn inside a moved group. */
  origin?: Pt;
  /** How a dragged corner snaps. Default: square up against its neighbors, then the grid. */
  snapTo?: CornerSnap;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const r = 6 * cmPerPx;
  const latest = useRef(outline);
  latest.current = outline;
  const snapLocal: CornerSnap = snapTo ?? ((target, neighbors, free) =>
    snapCorner(target, neighbors, { units, radius: 12 * cmPerPx, corners: [], edges: [] }, free));
  // Pointer positions arrive in canvas cm; the outline is in its own coordinates.
  const place: CornerSnap = (point, neighbors, free) => snapLocal([point[0] - origin[0], point[1] - origin[1]], neighbors, free);
  return (
    <g className="outline-handles">
      {outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <g key={`m${i}`} className="mid-handle" transform={`translate(${mid[0]},${mid[1]})`}
            onPointerDown={(event) => {
              event.stopPropagation();
              const inserted = [...outline.slice(0, i + 1), mid, ...outline.slice(i + 1)];
              onChange(inserted);
              drag(event, {
                move: (point, _delta, e) => {
                  const next = [...latest.current];
                  next[i + 1] = place(point, [next[i], next[(i + 2) % next.length]], e.altKey);
                  onChange(next);
                },
                end: () => onCommit(latest.current),
              });
            }}>
            <circle r={r * 0.9} />
            <path d={`M${-r * 0.45},0H${r * 0.45}M0,${-r * 0.45}V${r * 0.45}`} strokeWidth={cmPerPx * 1.3} />
            <title>Drag to add a corner here</title>
          </g>
        );
      })}
      {outline.map((p, i) => (
        <circle
          key={`v${i}`}
          className="vertex-handle"
          cx={p[0]}
          cy={p[1]}
          r={r}
          strokeWidth={1.5 * cmPerPx}
          onDoubleClick={(event) => { event.stopPropagation(); if (outline.length > 3) onCommit(outline.filter((_, j) => j !== i)); }}
          onPointerDown={(event) => {
            event.stopPropagation();
            drag(event, {
              move: (point, _delta, e) => {
                const next = [...latest.current];
                next[i] = place(point, [next[(i - 1 + next.length) % next.length], next[(i + 1) % next.length]], e.altKey);
                onChange(next);
              },
              end: (moved) => moved && onCommit(latest.current),
            });
          }}
        >
          <title>Drag to move this corner. Double-click to remove it. Hold Alt to skip squaring and snapping.</title>
        </circle>
      ))}
    </g>
  );
}
