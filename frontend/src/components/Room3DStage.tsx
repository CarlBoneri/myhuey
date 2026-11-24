// The room in 3D, drawn as SVG from the same room the plan shows: walls on its real outline up
// to the ceiling, doors and windows at their heights, furniture as solids, lights at their
// heights and real lengths, and the glare paths from the seat. Orbit it, or sit in the chair.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Compass, Maximize2, Minus, Plus, RotateCw, Square } from 'lucide-react';
import { useStore } from '../store';
import { bounds, round1 } from '../lib/geometry';
import { CM_PER_FOOT, formatLength, snap } from '../lib/units';
import { useDrawnLights } from '../lib/shownLights';
import { effectiveLength, liveColors, placedProfile } from '../lib/lights';
import { displayCorners, isDisplay, statusTone, type GlareReport, type GlareScene } from '../lib/glareMath';
import { covers, heightOf, moveRig, riders, topOf } from '../lib/rig';
import { haloOf, loopOf } from '../lib/halo';
import { setOf } from '../lib/desks';
import {
  PITCH_RANGE, ZOOM_RANGE, centroid, clamp, facesCamera, fitOrbit, floorCircle, floorGrid, lightPool, orbitCamera, prism, project, projectPolygon,
  seatCamera, shade, toView, unprojectToHeight, wallFacing, wallOpacity, walls, zoomAt, type Camera, type Orbit, type Vec3,
} from '../lib/view3d';
import type { Placement, Pt, Room } from '../types';
import { IconButton } from './ui';

export type Selection3D = { type: 'light'; id: string } | { type: 'furniture'; id: string } | { type: 'opening'; id: string } | null;
export type View3D = 'orbit' | 'seat';
type Drag =
  | { kind: 'orbit'; x: number; y: number; yaw: number; pitch: number }
  | { kind: 'look'; x: number; y: number; yaw: number; pitch: number }
  | { kind: 'pan'; x: number; y: number; pan: Pt }
  | { kind: 'light'; id: string; x: number; y: number; z: number; offset: Pt; start: Placement; pxPerCm: number; moved: boolean }
  | { kind: 'furniture'; id: string; x: number; y: number; z: number; grab: Pt; start: Room; moved: boolean };

const PRESETS: { label: string; yaw: number; pitch: number }[] = [
  { label: 'Top-down', yaw: 0, pitch: 90 },
  { label: 'Iso', yaw: -30, pitch: 34 },
  { label: 'Eye level', yaw: 0, pitch: 6 },
  { label: 'Rear', yaw: 180, pitch: 34 },
];
const points = (list: Pt[]) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const snap15 = (deg: number, free: boolean) => (free ? Math.round(deg) : Math.round(deg / 15) * 15);

export function Room3DStage({ room, posed, view, selection, onSelect, onLight, onLightCommit, onRoom, onRigCommit, scene, report, preview = false }: {
  /** The desk designer's bench: lights that are not on the bridge show as lit warm white, so their halos can be seen. */
  preview?: boolean;
  /** The room as saved, and as it stands in the chosen posture (what is drawn). */
  room: Room; posed: Room;
  /** From outside the room, orbiting; or from the desk seat, looking at the screen. */
  view: View3D;
  selection: Selection3D; onSelect: (selection: Selection3D) => void;
  onLight: (placement: Placement) => void; onLightCommit: (placement: Placement) => void;
  onRoom: (room: Room) => void; onRigCommit: (lightIds: string[], setId?: string) => void;
  scene: GlareScene; report: GlareReport;
}) {
  const { profiles } = useStore();
  const { lights: bridge, showing } = useDrawnLights(room.name);
  const frame = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 520 });
  const fitted = useMemo(() => fitOrbit(room, viewport), [room.outline, room.ceiling, viewport]); // eslint-disable-line react-hooks/exhaustive-deps
  const [orbit, setOrbit] = useState<Pick<Orbit, 'yaw' | 'pitch'>>({ yaw: -30, pitch: 34 });
  const [look, setLook] = useState({ yaw: 0, pitch: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>([0, 0]);
  const [showGlare, setShowGlare] = useState(true);
  const [showPools, setShowPools] = useState(true);
  const [hover, setHover] = useState('');
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const latest = useRef({ room, zoom, pan, viewport });
  latest.current = { room, zoom, pan, viewport };

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setViewport({ width: Math.max(320, element.clientWidth), height: Math.max(240, element.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const seated = view === 'seat' && scene.eye && scene.target;
  const camera: Camera = useMemo(
    () => (seated
      ? seatCamera(scene.eye!, scene.target!, look, zoom, viewport)
      : orbitCamera({ ...fitted.orbit, ...orbit, zoom }, fitted.base)),
    [seated, scene.eye, scene.target, look, zoom, viewport, fitted, orbit],
  );
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const reset = useCallback(() => { setZoom(1); setPan([0, 0]); setLook({ yaw: 0, pitch: 0 }); }, []);
  useEffect(reset, [view, reset]);
  const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
  /** Zoom in on where the eyes look, keeping the current angle. */
  const deskCloseUp = () => {
    if (!scene.target) return;
    const closer = orbitCamera({ ...fitted.orbit, ...orbit, zoom: 1.85 }, fitted.base);
    const at = project(scene.target, closer, viewport);
    setZoom(1.85);
    setPan([viewport.width / 2 - at.x, viewport.height / 2 - at.y]);
  };

  // Wheel and pinch zoom toward the cursor. React's wheel listener is passive, so this one is added by hand.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const now = latest.current;
      const next = zoomAt(now.zoom, now.pan, Math.exp(-event.deltaY * 0.0018), [event.clientX - rect.left, event.clientY - rect.top], now.viewport);
      setZoom(next.zoom);
      setPan(next.pan);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // = and - zoom, 0 fits, Space pans while dragging; with nothing selected the arrows orbit.
  useEffect(() => {
    const typing = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const down = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      if (event.code === 'Space') { space.current = true; event.preventDefault(); return; }
      if (event.key === '=' || event.key === '+') setZoom((z) => clamp(z * 1.2, ZOOM_RANGE));
      else if (event.key === '-') setZoom((z) => clamp(z / 1.2, ZOOM_RANGE));
      else if (event.key === '0') reset();
      else if (!selection && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const turn = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[event.key] ?? [0, 0];
        setOrbit((o) => ({ yaw: o.yaw + turn[0], pitch: clamp(o.pitch + turn[1], PITCH_RANGE) }));
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [selection, reset]);

  const at = (event: { clientX: number; clientY: number }): Pt => {
    const rect = frame.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const capture = (event: ReactPointerEvent) => {
    try { frame.current?.setPointerCapture(event.pointerId); } catch { /* a pointer that is already gone: the drag just ends at the edge */ }
  };

  const startBackground = (event: ReactPointerEvent) => {
    const [x, y] = at(event);
    capture(event);
    if (event.button !== 0 || event.shiftKey || space.current) drag.current = { kind: 'pan', x, y, pan };
    else if (seated) drag.current = { kind: 'look', x, y, ...look };
    else drag.current = { kind: 'orbit', x, y, ...orbit };
    onSelect(null);
  };

  const startLight = (event: ReactPointerEvent, id: string) => {
    event.stopPropagation();
    const start = room.lights.find((l) => l.light_id === id)!;
    const set = setOf(room, id);
    if (set) {
      // A light in a desk set moves the whole set: drag its base.
      startFurniture(event, set.base);
      onSelect({ type: 'light', id });
      return;
    }
    capture(event);
    onSelect({ type: 'light', id });
    if (start.mount) return; // it sits on its screen's back
    const z = heightOf(posed.lights.find((l) => l.light_id === id)!);
    const [x, y] = at(event);
    const under = unprojectToHeight([x, y], z, camera, viewport, pan) ?? [start.x, start.y];
    drag.current = {
      kind: 'light', id, x, y, z, start, offset: [start.x - under[0], start.y - under[1]],
      pxPerCm: project([start.x, start.y, z], camera, viewport, pan).scale, moved: false,
    };
  };

  const startFurniture = (event: ReactPointerEvent, id: string) => {
    event.stopPropagation();
    capture(event);
    onSelect({ type: 'furniture', id });
    const z = topOf(posed.furniture.find((f) => f.id === id)!);
    const [x, y] = at(event);
    const grab = unprojectToHeight([x, y], z, camera, viewport, pan);
    if (grab) drag.current = { kind: 'furniture', id, x, y, z, grab, start: room, moved: false };
  };

  const onMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const [x, y] = at(event);
    const [dx, dy] = [x - state.x, y - state.y];
    if (state.kind === 'pan') setPan([state.pan[0] + dx, state.pan[1] + dy]);
    else if (state.kind === 'orbit') setOrbit({ yaw: state.yaw + dx * 0.4, pitch: clamp(state.pitch + dy * 0.3, PITCH_RANGE) });
    else if (state.kind === 'look') setLook({ yaw: clamp(state.yaw - dx * 0.15, [-55, 55]), pitch: clamp(state.pitch + dy * 0.15, [-30, 30]) });
    else if (state.kind === 'light') {
      if (Math.hypot(dx, dy) < 3 && !state.moved) return;
      state.moved = true;
      const current = latest.current.room.lights.find((l) => l.light_id === state.id) ?? state.start;
      if (event.altKey) {
        // Alt-drag raises and lowers. The change is applied to the saved height, so it is right in either posture.
        const height = clamp(Math.round(snap(heightOf(state.start) - dy / state.pxPerCm, room.units)), [0, room.ceiling]);
        onLight({ ...current, elevation: height, resolved_elevation: height });
      } else {
        const under = unprojectToHeight([x, y], state.z, cameraRef.current, viewport, pan);
        if (!under) return;
        const box = bounds(room.outline);
        onLight({
          ...current,
          x: round1(snap(clamp(under[0] + state.offset[0], [box.minX, box.maxX]), room.units)),
          y: round1(snap(clamp(under[1] + state.offset[1], [box.minY, box.maxY]), room.units)),
        });
      }
    } else {
      if (Math.hypot(dx, dy) < 3 && !state.moved) return;
      state.moved = true;
      if (event.shiftKey) {
        onRoom(moveRig(state.start, state.id, 0, 0, snap15(dx * 0.5, event.altKey)));
        return;
      }
      const under = unprojectToHeight([x, y], state.z, cameraRef.current, viewport, pan);
      if (under) onRoom(moveRig(state.start, state.id, snap(under[0] - state.grab[0], room.units), snap(under[1] - state.grab[1], room.units)));
    }
  };

  const onUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (state.kind === 'light' && state.moved) {
      const placed = latest.current.room.lights.find((l) => l.light_id === state.id);
      if (placed) onLightCommit(placed);
    } else if (state.kind === 'furniture' && state.moved) {
      const base = state.start.furniture.find((f) => f.id === state.id);
      const set = base && setOf(state.start, base.id);
      if (set) onRigCommit([], set.id); // the server moves the whole set in one call
      else onRigCommit(base ? riders(state.start, base).lights : []);
    }
  };

  // Everything below turns the posed room into screen shapes for this camera.
  const poly = (list: Vec3[]) => projectPolygon(list, camera, viewport, pan);
  const depthOf = (point: Vec3) => toView(point, camera)[2];
  const statusOf = useMemo(() => new Map(report.lights.map((l) => [l.light_id, l])), [report]);

  const floor = poly(posed.outline.map(([x, y]) => [x, y, 0] as Vec3));
  const grid = floorGrid(posed.outline, posed.units === 'imperial' ? CM_PER_FOOT * 2 : 50);
  const allWalls = walls(posed).map((wall) => ({ wall, facing: wallFacing(wall, camera.eye), depth: depthOf(centroid(wall.quad)) }));
  const backWalls = allWalls.filter((w) => w.facing > 0).sort((a, b) => b.depth - a.depth);
  const frontWalls = allWalls.filter((w) => w.facing <= 0);

  // From the seat, the chair you are sitting in is not drawn: it would fill the view.
  const solids = posed.furniture.filter((item) => !(seated && covers(item, scene.eye![0], scene.eye![1]))).map((item) => {
    const center: Vec3 = [item.x, item.y, (item.elevation ?? 0) + (item.height ?? 75) / 2];
    return { type: 'furniture' as const, id: item.id, item, depth: depthOf(center) };
  });
  const fixtures = posed.lights.map((placement) => {
    const live = bridge[placement.light_id];
    const shownPlanned = !!placement.planned && !!showing?.results.some((r) => r.light_id === placement.light_id);
    const profile = placedProfile(placement, shownPlanned ? undefined : live, profiles);
    const z = heightOf(placement);
    return {
      type: 'light' as const, id: placement.light_id, placement, profile, z, live,
      span: profile.linear ? effectiveLength(placement, profile) : 0,
      colors: preview && !live ? ['#ffe7c4'] : placement.planned && !shownPlanned ? null : liveColors(live),
      level: live?.brightness != null ? Math.round((live.brightness / 254) * 100) : 50,
      depth: depthOf([placement.x, placement.y, z]),
    };
  });
  const drawn = [...solids, ...fixtures].sort((a, b) => b.depth - a.depth);
  // A lit light on a screen's back lights the wall behind that screen.
  const screenOf = (placement: Placement) => (placement.mount ? posed.furniture.find((item) => item.id === placement.mount!.screen) : undefined);
  const halos = fixtures.flatMap((f) => {
    const screen = screenOf(f.placement);
    const halo = f.colors && screen ? haloOf(posed, screen) : null;
    return halo ? [{ id: f.id, halo, color: f.colors![0], level: f.level }] : [];
  });
  const eye = scene.eye && !seated ? project(scene.eye, camera, viewport, pan) : null;

  return (
    <div className="view3d" ref={frame} onPointerDown={startBackground} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(event) => event.preventDefault()}>
      <svg width={viewport.width} height={viewport.height} role="img" aria-label={`${room.name} in 3D`}>
        <defs>
          <clipPath id="view3d-floor"><polygon points={points(floor)} /></clipPath>
          <filter id="view3d-halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14" /></filter>
        </defs>
        <polygon className="v3-floor" points={points(floor)} />
        <g clipPath="url(#view3d-floor)" className="v3-grid" aria-hidden="true">
          {grid.map((line, i) => {
            const [a, b] = poly(line);
            return a && b ? <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /> : null;
          })}
        </g>

        {backWalls.map(({ wall, facing }) => (
          <g key={wall.edge} className="v3-wall" aria-hidden="true">
            <polygon points={points(poly(wall.quad))} style={{ fillOpacity: wallOpacity(facing) }} />
            {wall.openings.map(({ opening, quad }) => <polygon key={opening.id} className={`v3-opening ${opening.kind}`} points={points(poly(quad))} />)}
          </g>
        ))}

        {halos.map(({ id, halo, color, level }) => (
          <polygon key={id} data-halo={id} className="v3-halo" points={points(poly(halo.corners))} filter="url(#view3d-halo)"
            style={{ fill: color, fillOpacity: halo.opacity * (0.4 + level / 160) }} aria-hidden="true" />
        ))}

        {showPools && fixtures.filter((f) => f.colors).map((f) => {
          const pool = lightPool(f.z, f.level);
          return <polygon key={f.id} className="v3-pool" points={points(poly(floorCircle(f.placement.x, f.placement.y, pool.radius)))}
            style={{ fill: f.colors![0], fillOpacity: pool.opacity }} aria-hidden="true" />;
        })}

        {drawn.map((entry) => {
          if (entry.type === 'furniture') {
            const { item } = entry;
            const selected = selection?.type === 'furniture' && selection.id === item.id;
            const handlers = {
              onPointerDown: (event: ReactPointerEvent) => startFurniture(event, item.id),
              onPointerEnter: () => setHover(`${item.label} · drag to move, Shift-drag to turn`),
              onPointerLeave: () => setHover(''),
            };
            if (isDisplay(item)) {
              // A curved screen is its strips; each one shows its face or its back on its own.
              const faces = scene.displays.filter((d) => d.id === item.id);
              if (!faces.length) return null;
              const facing = (d: (typeof faces)[number]) =>
                d.normal[0] * (camera.eye[0] - d.center[0]) + d.normal[1] * (camera.eye[1] - d.center[1]) + d.normal[2] * (camera.eye[2] - d.center[2]) > 0;
              return (
                <g key={item.id} data-screen={item.id} className={`v3-solid v3-screen${selected ? ' selected' : ''}`} {...handlers}>
                  {faces.map((d) => <polygon key={d.facet} className={facing(d) ? 'front' : undefined} points={points(poly(displayCorners(d)))} />)}
                </g>
              );
            }
            return (
              <g key={item.id} data-furniture={item.id} className={`v3-solid${selected ? ' selected' : ''}${item.kind === 'rug' ? ' flat' : ''}`} {...handlers}>
                {prism(item).filter((face) => facesCamera(face, camera.eye)).map((face, i) => (
                  <polygon key={i} points={points(poly(face.points))}
                    style={{ fill: `color-mix(in srgb, var(--text-2) ${Math.round(shade(face.normal) * 30)}%, var(--stage))` }} />
                ))}
              </g>
            );
          }
          const { placement, profile, z, colors, span } = entry;
          const status = statusOf.get(entry.id)?.status ?? 'clear';
          const tone = statusTone(status);
          const selected = selection?.type === 'light' && selection.id === entry.id;
          const head = project([placement.x, placement.y, z], camera, viewport, pan);
          if (head.depth < 1) return null; // behind the seat camera
          const foot = project([placement.x, placement.y, 0], camera, viewport, pan);
          const r = (placement.rotation * Math.PI) / 180;
          const ends: Vec3[] = [
            [placement.x - (Math.cos(r) * span) / 2, placement.y - (Math.sin(r) * span) / 2, z],
            [placement.x + (Math.cos(r) * span) / 2, placement.y + (Math.sin(r) * span) / 2, z],
          ];
          const stops = colors ?? ['var(--text-3)'];
          const name = entry.live?.name ?? placement.label;
          return (
            <g key={entry.id} data-light={entry.id} className={`v3-light${selected ? ' selected' : ''}${placement.planned ? ' planned' : ''}${colors ? ' lit' : ''} tone-${tone}`}
              onPointerDown={(event) => startLight(event, entry.id)}
              onPointerEnter={() => setHover(`${name} · ${formatLength(z, room.units)} high · drag to move, Alt-drag to raise or lower`)}
              onPointerLeave={() => setHover('')}>
              <line className="v3-drop" x1={head.x} y1={head.y} x2={foot.x} y2={foot.y} />
              <circle className="v3-foot" cx={foot.x} cy={foot.y} r={2} />
              {colors && <circle className="v3-glow" cx={head.x} cy={head.y} r={clamp(26 * head.scale, [10, 60])} style={{ fill: colors[0], fillOpacity: 0.1 + entry.level / 500 }} />}
              {screenOf(placement) ? (() => {
                // On a screen's back: the strip's run around the back of the screen.
                const run = loopOf(screenOf(placement)!, placement.length).map((p) => project(p, camera, viewport, pan));
                return <polyline className="v3-loop" points={points(run.map((p) => [p.x, p.y] as Pt))}
                  style={{ stroke: stops[0], strokeWidth: clamp(profile.width * head.scale, [3, 10]) }} />;
              })() : span > 0 ? stops.map((color, i) => {
                const a = project(lerp(ends[0], ends[1], i / stops.length), camera, viewport, pan);
                const b = project(lerp(ends[0], ends[1], (i + 1) / stops.length), camera, viewport, pan);
                return <line key={i} className="v3-bar" x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: color, strokeWidth: clamp(profile.width * head.scale, [4, 14]) }} />;
              }) : <circle className="v3-bulb" cx={head.x} cy={head.y} r={clamp((profile.length / 2) * head.scale, [5, 16])} style={{ fill: stops[0] }} />}
              {(tone === 'danger' || tone === 'warn' || selected) && <circle className="v3-ring" cx={head.x} cy={head.y} r={clamp(18 * head.scale, [11, 30])} />}
              {/* A generous invisible target, the same size on screen at any zoom. */}
              <circle cx={head.x} cy={head.y} r={14} fill="transparent" />
              {selected && (
                <text className="v3-label" x={head.x} y={head.y - clamp(18 * head.scale, [11, 30]) - 5} textAnchor="middle">{name} · {formatLength(z, room.units)}</text>
              )}
            </g>
          );
        })}

        {frontWalls.map(({ wall, facing }) => (
          <g key={wall.edge} className="v3-wall cut" aria-hidden="true">
            <polygon points={points(poly(wall.quad))} style={{ fillOpacity: wallOpacity(facing) }} />
            {wall.openings.map(({ opening, quad }) => <polygon key={opening.id} className={`v3-opening ${opening.kind}`} points={points(poly(quad))} style={{ opacity: 0.35 }} />)}
          </g>
        ))}

        {showGlare && report.lights.flatMap((light) => light.hazards.map((hazard, i) => {
          const path = hazard.path.map((p) => project(p, camera, viewport, pan));
          if (path.some((p) => p.depth < 1)) return null;
          const hit = hazard.kind === 'screen_reflection' ? path[1] : null;
          return (
            <g key={`${light.light_id}-${i}`} className={`v3-ray tone-${statusTone(hazard.kind)}`} aria-hidden="true">
              <polyline points={points(path.map((p) => [p.x, p.y] as Pt))} />
              {hit && <circle cx={hit.x} cy={hit.y} r={4} />}
            </g>
          );
        }))}
        {eye && (
          <g className="v3-eye" aria-hidden="true">
            <circle cx={eye.x} cy={eye.y} r={5} />
            <text className="v3-label" x={eye.x} y={eye.y + 17} textAnchor="middle">Eyes · {formatLength(scene.eye![2], room.units)}</text>
          </g>
        )}
      </svg>

      <p className="stage-hint left">{hover || (seated
        ? 'Drag to look around · wheel zooms'
        : 'Drag to orbit · Shift-drag or Space-drag pans · wheel zooms')}</p>

      <div className="view3d-hud" onPointerDown={(event) => event.stopPropagation()}>
        <IconButton label="Zoom out (-)" onClick={() => setZoom((z) => clamp(z / 1.2, ZOOM_RANGE))}><Minus size={15} /></IconButton>
        <button type="button" className="view3d-zoom" onClick={reset} title="Reset zoom and pan (0)">{Math.round(zoom * 100)}%</button>
        <IconButton label="Zoom in (=)" onClick={() => setZoom((z) => clamp(z * 1.2, ZOOM_RANGE))}><Plus size={15} /></IconButton>
        <IconButton label="Fit the room" onClick={reset}><Maximize2 size={15} /></IconButton>
        {!seated && (
          <>
            {scene.target && <button type="button" className="pill" onClick={deskCloseUp} title="Zoom in on the desk">Desk close-up</button>}
            <span className="toolbar-sep" />
            <label className="view3d-dial" title="Turn the room">
              <RotateCw size={13} aria-hidden="true" /><span>Yaw</span>
              <input type="range" min={-180} max={180} value={Math.round(wrap(orbit.yaw))} onChange={(event) => setOrbit((o) => ({ ...o, yaw: Number(event.target.value) }))} />
              <output>{Math.round(wrap(orbit.yaw))}°</output>
            </label>
            <label className="view3d-dial" title="Tilt from eye level to straight down">
              <Compass size={13} aria-hidden="true" /><span>Pitch</span>
              <input type="range" min={PITCH_RANGE[0]} max={PITCH_RANGE[1]} value={Math.round(orbit.pitch)} onChange={(event) => setOrbit((o) => ({ ...o, pitch: Number(event.target.value) }))} />
              <output>{Math.round(orbit.pitch)}°</output>
            </label>
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" className={`pill${Math.abs(wrap(orbit.yaw) - wrap(preset.yaw)) < 1 && Math.abs(orbit.pitch - preset.pitch) < 1 ? ' active' : ''}`}
                onClick={() => { setOrbit({ yaw: preset.yaw, pitch: preset.pitch }); setPan([0, 0]); }}>{preset.label}</button>
            ))}
          </>
        )}
        <span className="toolbar-sep" />
        <button type="button" className={`pill${showGlare ? ' active' : ''}`} aria-pressed={showGlare} onClick={() => setShowGlare((v) => !v)}>Glare paths</button>
        <button type="button" className={`pill${showPools ? ' active' : ''}`} aria-pressed={showPools} onClick={() => setShowPools((v) => !v)}><Square size={12} /> Light pools</button>
      </div>
    </div>
  );
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
