// The 3D screen's layout: the room view above the glare table, the inspector beside them. Each
// pane has a command-line title, folds away, and resizes by dragging the bar between panes.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowUpDown, Box, Maximize2, Minus, Monitor, PanelRightClose, PanelRightOpen, Plus, ScanEye, ShieldCheck, Square } from 'lucide-react';
import { sendLight, useStore } from '../store';
import { useUi } from '../uiStore';
import { quote } from '../lib/commands';
import { STATUS_LABELS, capText, isDisplay, statusTone } from '../lib/glareMath';
import { round1 } from '../lib/geometry';
import { placedProfile } from '../lib/lights';
import { EYE_SEATED, EYE_STANDING, heightPreset, type HeightPreset } from '../lib/photo';
import { STANDING_DESK_CM, heightOf, type Posture } from '../lib/rig';
import { fixGlareState, useDrawnLights, shownLevels, glareBadge } from '../lib/shownLights';
import { overLimit } from '../lib/glareLimits';
import { ShowingLabel } from './ShowingLabel';
import { lightsToDim, type RoomGlare } from '../lib/roomGlare';
import { MODE_LABELS, autoRoleLabel } from '../lib/suggest';
import { CM_PER_INCH, formatLength } from '../lib/units';
import { clamp } from '../lib/view3d';
import { screenSummary } from '../lib/screen';
import type { Placement, Room } from '../types';
import { Room3DStage, type Selection3D, type View3D } from './Room3DStage';
import { isMac, isResizePress } from '../lib/pointer';
import { inspectorAfterDrag, shouldScrollOnFold, splitAfterDrag, unfoldForLighting } from '../lib/paneDrag';
import { Panel, Segmented, Sidebar, Slider } from './ui';

const SIZES_KEY = 'myhuey.studio3d';
const DEFAULT_SIZES = { split: 0.62, inspector: 380, collapsed: { view: false, audit: false, inspector: false } };
type Sizes = typeof DEFAULT_SIZES;
const DESK_MODES = ['code', 'work', 'study'];
const PRESETS: { id: HeightPreset; label: string }[] = [
  { id: 'floor', label: 'Floor' }, { id: 'desk', label: 'Desk top' }, { id: 'eye', label: 'Eye level' }, { id: 'ceiling', label: 'Ceiling' }, { id: 'auto', label: 'Auto' },
];

function loadSizes(): Sizes {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) || '{}');
    return {
      split: clamp(Number(saved.split) || DEFAULT_SIZES.split, [0.2, 0.85]),
      inspector: clamp(Number(saved.inspector) || DEFAULT_SIZES.inspector, [280, 680]),
      collapsed: { ...DEFAULT_SIZES.collapsed, ...(saved.collapsed || {}) },
    };
  } catch {
    return DEFAULT_SIZES;
  }
}

/** A pane's title bar: fold button, the command that shows the same thing, and its tools. */
function PaneHead({ label, collapsed, onToggle, command, children }: { label: string; collapsed: boolean; onToggle: () => void; command: string; children?: ReactNode }) {
  return (
    <header className="pane-head">
      <button type="button" className="pane-fold" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`} title={`${collapsed ? 'Show' : 'Hide'} ${label}`}>
        {collapsed ? <Square size={11} /> : <Minus size={12} />}
      </button>
      <span className="pane-command" title="Type this in the prompt below"><span aria-hidden="true">$ </span>{command}</span>
      <div className="pane-tools">{children}</div>
    </header>
  );
}

export function Studio3D({ room, glare, selection, onSelect, onLight, onLightCommit, onRoom, onRigCommit, children }: {
  room: Room; glare: RoomGlare;
  selection: Selection3D; onSelect: (selection: Selection3D) => void;
  onLight: (placement: Placement) => void; onLightCommit: (placement: Placement) => void;
  onRoom: (room: Room) => void; onRigCommit: (lightIds: string[]) => void;
  /** The designer's own panels (selected light, furniture, room), shown under the 3D cards. */
  children: ReactNode;
}) {
  const { lights: liveLights, profiles, toast } = useStore();
  const { lights, showing } = useDrawnLights(room.name);
  const { posture, setPosture, glareMode, setGlareMode } = useUi();
  const [sizes, setSizes] = useState(loadSizes);
  const [view, setView] = useState<View3D>('orbit');
  const column = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const { collapsed } = sizes;
  useEffect(() => {
    try { localStorage.setItem(SIZES_KEY, JSON.stringify(sizes)); } catch { /* storage blocked: sizes just reset next time */ }
  }, [sizes]);
  // Opening the lighting panel (the Light button) shows the inspector it lives in.
  const lightingOpen = useUi((state) => state.lightingOpen);
  useEffect(() => { setSizes((s) => unfoldForLighting(s, lightingOpen)); }, [lightingOpen]);
  const viewPane = useRef<HTMLElement>(null);
  const fold = (key: keyof Sizes['collapsed']) => setSizes((s) => ({ ...s, collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } }));

  const dragBar = (event: ReactPointerEvent<HTMLDivElement>, apply: (move: PointerEvent) => void) => {
    if (!isResizePress(event, isMac())) return;
    const bar = event.currentTarget;
    // Claim the press: left alone, the browser starts a text selection and cancels the resize.
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    const stop = () => { bar.removeEventListener('pointermove', apply); bar.removeEventListener('pointerup', stop); bar.removeEventListener('pointercancel', stop); };
    bar.addEventListener('pointermove', apply);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  };
  // Each bar remembers where the press started and how big the pane was, so it follows the pointer by distance moved.
  const resizeRows = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const startSplit = sizes.split;
    const height = column.current!.getBoundingClientRect().height;
    dragBar(event, (move) => setSizes((s) => ({ ...s, split: splitAfterDrag(startSplit, startY, move.clientY, height) })));
  };
  const resizeInspector = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = sizes.inspector;
    dragBar(event, (move) => setSizes((s) => ({ ...s, inspector: inspectorAfterDrag(startWidth, startX, move.clientX) })));
  };

  const { report, scene, posed } = glare;
  const status = new Map(report.lights.map((light) => [light.light_id, light]));
  const toDim = lightsToDim(room, report, liveLights);
  const levels = shownLevels(lights);
  const over = new Set(overLimit(report, levels));
  const fix = fixGlareState(!!showing, toDim.length);
  const watch = Math.max(0, report.hazards - over.size);
  const unit = room.units === 'imperial' ? CM_PER_INCH : 1;
  const unitName = room.units === 'imperial' ? 'in' : 'cm';
  const inUnits = (cm: number) => Math.round(cm / unit);
  const selectedLight = selection?.type === 'light' ? room.lights.find((l) => l.light_id === selection.id) : undefined;
  const selectedPosed = selectedLight && posed.lights.find((l) => l.light_id === selectedLight.light_id);
  const change = (next: Placement) => { onLight(next); onLightCommit(next); };
  const step = room.units === 'imperial' ? CM_PER_INCH * 2 : 5;

  return (
    <div className={`studio3d${collapsed.audit ? ' audit-folded' : ''}`} ref={layout} style={{ gridTemplateColumns: collapsed.inspector ? 'minmax(0, 1fr) 40px' : `minmax(0, 1fr) 10px ${sizes.inspector}px` }}>
      <div className="studio3d-main" ref={column}>
        <section className="pane" ref={viewPane} style={{ flex: collapsed.view ? '0 0 auto' : collapsed.audit ? '1 1 0' : `0 0 calc(${sizes.split * 100}% - 5px)` }}>
          <PaneHead label="the 3D view" collapsed={collapsed.view} onToggle={() => fold('view')} command={`room posture ${quote(room.name)} ${posture}`}>
            <span className={`pane-badge${over.size > 0 ? ' flagged' : ''}`}>{scene.eye ? glareBadge(over.size, watch) : 'No desk to check from'}</span>
            <Segmented label="Camera" value={view} onChange={setView} options={[
              { value: 'orbit', label: <><Box size={13} /> Isometric cutaway</>, title: 'Look at the room from outside' },
              { value: 'seat', label: <><ScanEye size={13} /> Desk eye-level</>, title: scene.eye ? 'Sit at the desk and look at the screen' : 'Add a desk or a screen to sit here' },
            ]} />
            <button type="button" className="pane-fold" onClick={() => {
              const folding = !collapsed.audit;
              setSizes((s) => ({ ...s, collapsed: { ...s.collapsed, view: false, audit: !s.collapsed.audit } }));
              // In a narrow window the folded view is a tall column: bring its top into view once it has been redrawn.
              if (shouldScrollOnFold(folding, window.matchMedia('(max-width: 980px)').matches)) requestAnimationFrame(() => viewPane.current?.scrollIntoView({ block: 'start' }));
            }}
              aria-label="Give the 3D view the whole column" title="Give the 3D view the whole column"><Maximize2 size={12} /></button>
          </PaneHead>
          {!collapsed.view && (
            <div className="pane-body stage">
              {showing && <ShowingLabel title={showing.title} />}
              <Room3DStage room={room} posed={posed} view={scene.eye ? view : 'orbit'} selection={selection} onSelect={onSelect}
                onLight={onLight} onLightCommit={onLightCommit} onRoom={onRoom} onRigCommit={onRigCommit} scene={scene} report={report} />
            </div>
          )}
        </section>

        {!collapsed.view && !collapsed.audit && (
          <div className="splitter row" role="separator" aria-orientation="horizontal" aria-label="Resize the 3D view and the glare table"
            title="Drag to resize · double-click to reset" onPointerDown={resizeRows} onDoubleClick={() => setSizes((s) => ({ ...s, split: DEFAULT_SIZES.split }))}><span /></div>
        )}

        <section className="pane" style={{ flex: collapsed.audit ? '0 0 auto' : '1 1 0' }}>
          <PaneHead label="the glare table" collapsed={collapsed.audit} onToggle={() => fold('audit')} command={`room glare ${quote(room.name)} --mode ${glareMode}`}>
            <Segmented label="Mode" value={glareMode} onChange={setGlareMode} options={DESK_MODES.map((value) => ({ value, label: MODE_LABELS[value] ?? value }))} />
            <button type="button" className="button small primary" disabled={fix.disabled} title={fix.title}
              onClick={() => {
                for (const item of toDim) sendLight(item.id, { brightness: item.level }, { brightness: item.level });
                toast(`Dimmed ${toDim.length} light${toDim.length === 1 ? '' : 's'}.`, false);
              }}>
              <ShieldCheck size={13} /> Fix glare{toDim.length ? ` (${toDim.length})` : ''}
            </button>
          </PaneHead>
          {!collapsed.audit && (
            <div className="pane-body audit">
              {showing && <p className="hint audit-note">Showing {showing.title}: this table describes that scene, not your lights.</p>}
              <table>
                <thead>
                  <tr><th>Light</th><th>Role</th><th>Position (x, y, height · {unitName})</th><th>Off your gaze</th><th>Level</th><th>Glare</th></tr>
                </thead>
                <tbody>
                  {posed.lights.map((placement) => {
                    const live = lights[placement.light_id];
                    const entry = status.get(placement.light_id);
                    const role = placement.role && placement.role !== 'auto' ? placement.role : placement.resolved_roles?.desk ?? 'auto';
                    const selected = selection?.type === 'light' && selection.id === placement.light_id;
                    return (
                      <tr key={placement.light_id} className={selected ? 'selected' : ''} aria-selected={selected}
                        onClick={() => onSelect({ type: 'light', id: placement.light_id })}>
                        <td>
                          <span className="audit-dot" style={{ background: live?.on && live.reachable ? live.color ?? '#fff4dc' : undefined }} aria-hidden="true" />
                          {live?.name ?? placement.label}
                        </td>
                        <td className="audit-role">{role}</td>
                        <td className="mono">{inUnits(placement.x)}, {inUnits(placement.y)}, <strong>{inUnits(heightOf(placement))}</strong></td>
                        <td className="mono">{entry?.angle != null ? `${Math.round(entry.angle)}°` : '—'}</td>
                        <td className="mono">
                          {placement.planned && !live ? 'Planned' : !live ? '—' : live.on ? `${levels[placement.light_id].brightness}%` : 'Off'}
                          {live && entry?.cap && <span className={over.has(placement.light_id) ? 'level-over' : 'level-limit'}> · limit {entry.cap.brightness}%{over.has(placement.light_id) ? ' · over' : ''}</span>}
                        </td>
                        <td>{entry && <span className={`glare-badge tone-${statusTone(entry.status)}`} title={capText(entry.cap) || undefined}>{STATUS_LABELS[entry.status]}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!posed.lights.length && <p className="hint">No lights placed in this room yet. Place them on the Plan tab.</p>}
            </div>
          )}
        </section>
      </div>

      {collapsed.inspector ? (
        <div className="inspector-rail">
          <button type="button" className="pane-fold" onClick={() => fold('inspector')} aria-label="Show the inspector" title="Show the inspector"><PanelRightOpen size={14} /></button>
          <span aria-hidden="true">Inspector</span>
        </div>
      ) : (
        <>
          <div className="splitter col" role="separator" aria-orientation="vertical" aria-label="Resize the inspector"
            title="Drag to resize · double-click to reset" onPointerDown={resizeInspector} onDoubleClick={() => setSizes((s) => ({ ...s, inspector: DEFAULT_SIZES.inspector }))}><span /></div>
          <Sidebar name="designer" resizable={false}>
            <header className="inspector-head">
              <span>Spatial inspector</span>
              <button type="button" className="pane-fold" onClick={() => fold('inspector')} aria-label="Hide the inspector" title="Hide the inspector"><PanelRightClose size={14} /></button>
            </header>

            {selectedLight && selectedPosed && (() => {
              const live = lights[selectedLight.light_id];
              const profile = placedProfile(selectedLight, liveLights[selectedLight.light_id], profiles);
              const entry = status.get(selectedLight.light_id);
              const height = heightOf(selectedLight);
              const axes: { label: string; value: string; nudge: (delta: number) => Placement }[] = [
                { label: `X (${unitName})`, value: String(inUnits(selectedLight.x)), nudge: (delta) => ({ ...selectedLight, x: round1(selectedLight.x + delta) }) },
                { label: `Y (${unitName})`, value: String(inUnits(selectedLight.y)), nudge: (delta) => ({ ...selectedLight, y: round1(selectedLight.y + delta) }) },
                { label: 'Height', value: formatLength(heightOf(selectedPosed), room.units), nudge: (delta) => {
                  const next = clamp(Math.round(height + delta), [0, room.ceiling]);
                  return { ...selectedLight, elevation: next, resolved_elevation: next };
                } },
              ];
              return (
                <Panel title="Selected light" className="light3d">
                  <div>
                    <strong>{live?.name ?? selectedLight.label}</strong>
                    <p className="hint">{profile.label} · {selectedLight.role && selectedLight.role !== 'auto' ? `pinned as ${selectedLight.role}` : autoRoleLabel(selectedLight.resolved_roles)}</p>
                  </div>
                  <div className="nudgers">
                    {axes.map((axis) => (
                      <div key={axis.label} className="nudger">
                        <span>{axis.label}</span>
                        <strong className="mono">{axis.value}</strong>
                        <div>
                          <button type="button" onClick={() => change(axis.nudge(-step))} aria-label={`${axis.label} down`}><Minus size={12} /></button>
                          <button type="button" onClick={() => change(axis.nudge(step))} aria-label={`${axis.label} up`}><Plus size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="height-block">
                    <Slider label="Height off the floor" value={height} min={0} max={room.ceiling} format={(value) => formatLength(value, room.units)}
                      onChange={(value) => onLight({ ...selectedLight, elevation: Math.round(value), resolved_elevation: Math.round(value) })}
                      onCommit={(value) => onLightCommit({ ...selectedLight, elevation: Math.round(value), resolved_elevation: Math.round(value) })} />
                    <div className="button-row">
                      {PRESETS.map((preset) => {
                        const value = heightPreset(preset.id, room, selectedLight);
                        if (preset.id !== 'auto' && value === null) return null;
                        const active = preset.id === 'auto' ? selectedLight.elevation == null : selectedLight.elevation != null && Math.abs(height - (value ?? 0)) < 1;
                        return (
                          <button key={preset.id} type="button" className={`pill${active ? ' active' : ''}`} aria-pressed={active}
                            title={preset.id === 'auto' ? 'Work the height out from the product and what it sits on' : formatLength(value ?? 0, room.units)}
                            onClick={() => change({ ...selectedLight, elevation: value, resolved_elevation: value ?? selectedLight.resolved_elevation })}>
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="hint"><ArrowUpDown size={12} aria-hidden="true" /> Hold Alt (Option) and drag a light in the 3D view to raise or lower it.</p>
                  </div>
                  {entry && entry.status !== 'clear' && (
                    <p className="glare-line"><span className={`glare-badge tone-${statusTone(entry.status)}`}>{STATUS_LABELS[entry.status]}</span> {capText(entry.cap)}</p>
                  )}
                </Panel>
              );
            })()}

            <Panel title="Posture">
              <Segmented<Posture> label="Posture" value={posture} onChange={setPosture} options={[
                { value: 'seated', label: `Seated · eyes ${formatLength(EYE_SEATED, room.units)}` },
                { value: 'standing', label: `Standing · eyes ${formatLength(EYE_STANDING, room.units)}` },
              ]} />
              <p className="hint">Standing is a preview: it raises your eyes and lifts sit-stand desks to {formatLength(STANDING_DESK_CM, room.units)}, with the screens and lights on them. Nothing is saved.</p>
            </Panel>

            <Panel title={<><Monitor size={15} strokeWidth={1.5} /> Room items</>}>
              {room.furniture.length ? (
                <ul className="item-list">
                  {room.furniture.map((item) => {
                    const active = selection?.type === 'furniture' && selection.id === item.id;
                    return (
                      <li key={item.id}>
                        <button type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={() => onSelect({ type: 'furniture', id: item.id })}>
                          <span>{item.label}</span>
                          <small>{isDisplay(item)
                            ? `screen · ${screenSummary(item)}`
                            : `${formatLength(item.width, room.units)} × ${formatLength(item.depth, room.units)}`}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="hint">No furniture yet. Add a desk and a monitor below to get a glare check.</p>}
            </Panel>

            {children}
          </Sidebar>
        </>
      )}
    </div>
  );
}
