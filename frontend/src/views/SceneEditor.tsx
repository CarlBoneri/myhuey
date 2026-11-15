// Paint a scene onto a room: color zones and an optional image. Each light shows the color
// it would take, computed by the server so the UI, the CLI, and the bridge always agree.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Circle, Expand, Hand, ImagePlus, Lasso, Maximize, Play, Radio, RotateCw, Square, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { go } from '../lib/router';
import { bounds, ellipsePoints, fitImage, pathOf, rectPoints, round1, simplify } from '../lib/geometry';
import { effectiveLength, placedProfile } from '../lib/lights';
import type { ImageLayer, LightOverride, Mood, Pt, Room, Scene, SceneResult, Zone } from '../types';
import { PlanCanvas, useDrag, usePlan } from '../components/PlanCanvas';
import { FurnitureShape, LightSilhouette } from '../components/Shapes';
import { ColorPicker } from '../components/ColorPicker';
import { GradientEditor, gradientCss } from '../components/GradientEditor';
import { ThemeExtractor, type ThemeMood } from '../components/ThemeExtractor';
import { Empty, Field, IconButton, Panel, Segmented, Slider, Swatch, TextInput, Toggle } from '../components/ui';

type Tool = 'select' | 'rect' | 'ellipse' | 'lasso';
type Pick = { type: 'zone'; id: string } | { type: 'image' } | { type: 'light'; id: string } | null;

const newId = () => Math.random().toString(16).slice(2, 14);

function DrawLayer({ tool, onDone, color }: { tool: Tool; onDone: (points: Pt[]) => void; color: string }) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const [temp, setTemp] = useState<Pt[] | null>(null);
  return (
    <>
      <rect
        x={-1e5} y={-1e5} width={2e5} height={2e5} fill="transparent" style={{ cursor: 'crosshair' }}
        onPointerDown={(event) => {
          let lasso: Pt[] = [];
          let shape: Pt[] = [];
          drag(event, {
            move: (point, delta) => {
              const start: Pt = [point[0] - delta[0], point[1] - delta[1]];
              if (tool === 'rect') shape = rectPoints(start, point);
              else if (tool === 'ellipse') shape = ellipsePoints((start[0] + point[0]) / 2, (start[1] + point[1]) / 2, Math.abs(delta[0]) / 2, Math.abs(delta[1]) / 2);
              else {
                if (!lasso.length) lasso = [start];
                lasso = [...lasso, point];
                shape = lasso;
              }
              setTemp(shape);
            },
            end: () => {
              setTemp(null);
              const points = tool === 'lasso' ? simplify(shape, 6 * cmPerPx) : shape;
              if (points.length >= 3) onDone(points.map(([x, y]) => [round1(x), round1(y)] as Pt));
            },
          });
        }}
      />
      {temp && <path d={pathOf(temp)} fill={color} fillOpacity={0.4} stroke="#fff" strokeDasharray={`${4 * cmPerPx}`} strokeWidth={cmPerPx} pointerEvents="none" />}
    </>
  );
}

function ZoneShape({ zone, selected, interactive, onSelect, onChange, onCommit }: {
  zone: Zone; selected: boolean; interactive: boolean; onSelect: () => void; onChange: (z: Zone) => void; onCommit: () => void;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const latest = useRef(zone);
  latest.current = zone;
  return (
    <g pointerEvents={interactive ? 'auto' : 'none'}>
      <path
        d={pathOf(zone.points)}
        className={`zone${selected ? ' selected' : ''}`}
        fill={zone.color}
        fillOpacity={0.3 + (zone.brightness / 100) * 0.45}
        stroke={selected ? '#fff' : zone.color}
        strokeWidth={(selected ? 2 : 1) * cmPerPx}
        onPointerDown={(event) => {
          onSelect();
          const start = latest.current.points;
          drag(event, {
            move: (_p, d) => onChange({ ...latest.current, points: start.map(([x, y]) => [round1(x + d[0]), round1(y + d[1])] as Pt) }),
            end: (moved) => moved && onCommit(),
          });
        }}
      />
      {selected && interactive && zone.points.length <= 16 && zone.points.map((p, i) => (
        <circle key={i} className="vertex-handle" cx={p[0]} cy={p[1]} r={5 * cmPerPx} strokeWidth={1.5 * cmPerPx}
          onPointerDown={(event) => drag(event, {
            move: (point) => onChange({ ...latest.current, points: latest.current.points.map((q, j) => (j === i ? [round1(point[0]), round1(point[1])] as Pt : q)) }),
            end: (moved) => moved && onCommit(),
          })} />
      ))}
    </g>
  );
}

function ImageOnPlan({ layer, selected, interactive, onSelect, onChange, onCommit }: {
  layer: ImageLayer; selected: boolean; interactive: boolean; onSelect: () => void; onChange: (l: ImageLayer) => void; onCommit: () => void;
}) {
  const drag = useDrag();
  const { cmPerPx } = usePlan();
  const latest = useRef(layer);
  latest.current = layer;
  const rotation = layer.rotation ?? 0;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  return (
    <g pointerEvents={interactive ? 'auto' : 'none'} transform={`rotate(${rotation} ${cx} ${cy})`}>
      <image
        href={api.imageUrl(layer.file)} x={layer.x} y={layer.y} width={layer.width} height={layer.height} preserveAspectRatio="none" opacity={layer.opacity}
        onPointerDown={(event) => {
          onSelect();
          const start = latest.current;
          drag(event, {
            move: (_p, d) => onChange({ ...latest.current, x: round1(start.x + d[0]), y: round1(start.y + d[1]) }),
            end: (moved) => moved && onCommit(),
          });
        }}
      />
      {selected && (
        <>
          <rect x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill="none" stroke="var(--accent)" strokeWidth={1.5 * cmPerPx} strokeDasharray={`${6 * cmPerPx}`} pointerEvents="none" />
          <line x1={cx} y1={layer.y} x2={cx} y2={layer.y - 24 * cmPerPx} stroke="var(--accent)" strokeWidth={1.5 * cmPerPx} pointerEvents="none" />
          <g className="end-handle" transform={`translate(${cx},${layer.y - 24 * cmPerPx})`}
            onPointerDown={(event) => drag(event, {
              move: (point, _d, e) => {
                const angle = (Math.atan2(point[1] - cy, point[0] - cx) * 180) / Math.PI + 90;
                const snapped = e.altKey ? angle : Math.round(angle / 15) * 15;
                onChange({ ...latest.current, rotation: round1(((snapped % 360) + 360) % 360) });
              },
              end: (moved) => moved && onCommit(),
            })}>
            <circle r={7 * cmPerPx} strokeWidth={1.5 * cmPerPx} />
            <title>Drag to rotate the image (hold Alt for free rotation)</title>
          </g>
          <rect className="resize-handle" x={layer.x + layer.width - 6 * cmPerPx} y={layer.y + layer.height - 6 * cmPerPx} width={12 * cmPerPx} height={12 * cmPerPx}
            onPointerDown={(event) => {
              const start = latest.current;
              const aspect = start.width / start.height;
              const r = (-(start.rotation ?? 0) * Math.PI) / 180;
              const centerX = start.x + start.width / 2;
              const centerY = start.y + start.height / 2;
              drag(event, {
                move: (_p, d, e) => {
                  // Resize around the center, in the image's own (turned) frame.
                  const localX = d[0] * Math.cos(r) - d[1] * Math.sin(r);
                  const localY = d[0] * Math.sin(r) + d[1] * Math.cos(r);
                  const width = Math.max(20, start.width + localX * 2);
                  const height = e.shiftKey ? Math.max(20, start.height + localY * 2) : width / aspect;
                  onChange({ ...latest.current, width: round1(width), height: round1(height), x: round1(centerX - width / 2), y: round1(centerY - height / 2) });
                },
                end: (moved) => moved && onCommit(),
              });
            }}>
            <title>Drag to resize (hold Shift to stretch freely)</title>
          </rect>
        </>
      )}
    </g>
  );
}

function PreviewLights({ room, results, selected, onPick }: {
  room: Room; results: Map<string, SceneResult>; selected?: string; onPick?: (id: string) => void;
}) {
  const { lights, profiles } = useStore();
  const { cmPerPx } = usePlan();
  return (
    <g pointerEvents={onPick ? 'auto' : 'none'}>
      {room.lights.map((placement) => {
        const profile = placedProfile(placement, lights[placement.light_id], profiles);
        const result = results.get(placement.light_id);
        const colors = result?.on ? (result.gradient ?? (result.color ? [result.color] : null)) : null;
        return (
          <g key={placement.light_id} transform={`translate(${placement.x},${placement.y}) rotate(${placement.rotation})`} opacity={result?.keep ? 0.45 : 1}
            style={{ cursor: onPick ? 'pointer' : undefined }}
            onPointerDown={(event) => { if (!onPick) return; event.stopPropagation(); onPick(placement.light_id); }}>
            <LightSilhouette profile={profile} length={effectiveLength(placement, profile)} colors={colors} on={!!colors} cmPerPx={cmPerPx}
              mode={result?.mode} selected={selected === placement.light_id} />
            <rect x={-Math.max(effectiveLength(placement, profile), 20) / 2} y={-12 * cmPerPx} width={Math.max(effectiveLength(placement, profile), 20)} height={24 * cmPerPx} fill="transparent" />
            {result?.override && <circle cx={0} cy={-14 * cmPerPx} r={4 * cmPerPx} fill="var(--accent)" stroke="#fff" strokeWidth={cmPerPx} />}
          </g>
        );
      })}
    </g>
  );
}

/** Split the room into bands, one per palette color, as a starting point. */
function zonesFromPalette(room: Room, colors: string[]): Zone[] {
  const box = bounds(room.outline);
  const step = (box.maxX - box.minX) / colors.length;
  return colors.map((color, i) => ({
    id: newId(), name: `Band ${i + 1}`, color, brightness: 80,
    points: rectPoints([round1(box.minX + step * i), box.minY], [round1(box.minX + step * (i + 1)), box.maxY]),
  }));
}

export function SceneEditor({ id }: { id: string }) {
  const { scenes, rooms, refreshScenes, lights } = useStore();
  const stored = scenes.find((scene) => scene.id === id);
  const room = rooms.find((r) => r.name === stored?.room);
  const [draft, setDraftState] = useState<Scene | undefined>(stored);
  const draftRef = useRef(draft);
  const setDraft = (next: Scene) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [tool, setTool] = useState<Tool>('select');
  const [pick, setPick] = useState<Pick>(null);
  const [results, setResults] = useState<SceneResult[]>([]);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [live, setLive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paintColor, setPaintColor] = useState('#8b5cf6');
  const [activePick, setActivePick] = useState<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stored && stored.id !== draftRef.current?.id) setDraft(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.id]);

  // Preview on every change; autosave shortly after; with Live, also send to the lights.
  const version = useRef(0);
  useEffect(() => {
    if (!draft) return;
    const mine = ++version.current;
    const previewTimer = setTimeout(async () => {
      try {
        const next = await api.preview(draft);
        if (mine === version.current) setResults(next);
      } catch { /* the save below reports problems */ }
    }, 120);
    if (status !== 'dirty') return () => clearTimeout(previewTimer);
    const saveTimer = setTimeout(async () => {
      setStatus('saving');
      const saved = await attempt(() => api.saveScene(draft));
      if (mine !== version.current) return;
      setStatus(saved ? 'saved' : 'dirty');
      if (saved) {
        useStore.setState({ scenes: useStore.getState().scenes.map((s) => (s.id === saved.id ? saved : s)) });
        if (live) void api.applyScene(saved.id).catch((error) => useStore.getState().toast(error.message));
      }
    }, live ? 450 : 700);
    return () => { clearTimeout(previewTimer); clearTimeout(saveTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const resultMap = useMemo(() => new Map(results.map((r) => [r.light_id, r])), [results]);
  const fit = useMemo(() => {
    if (!room) return { x: 0, y: 0, w: 450, h: 300 };
    const box = bounds(room.outline);
    return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
  }, [room]);

  if (!stored || !draft) return <div className="page"><Empty title="Scene not found"><a className="button" href="#/scenes">All scenes</a></Empty></div>;
  if (!room) return <div className="page"><Empty title={`The room ${draft.room} is gone`}><a className="button" href="#/scenes">All scenes</a></Empty></div>;

  const change = (next: Scene) => { setDraft(next); setStatus('dirty'); };
  const commit = () => change({ ...draftRef.current! });
  const zone = pick?.type === 'zone' ? draft.zones.find((z) => z.id === pick.id) : undefined;
  const updateZone = (next: Zone, save = true) => {
    const current = draftRef.current!;
    const scene = { ...current, zones: current.zones.map((z) => (z.id === next.id ? next : z)) };
    if (save) change(scene); else setDraft(scene);
  };
  const palette = draft.image?.picks.map((p) => p.color) ?? draft.palette;

  const importImage = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return useStore.getState().toast('Choose a JPEG, PNG, or WebP image.');
    if (file.size > 15 * 1024 * 1024) return useStore.getState().toast('Images can be at most 15 MB.');
    setUploading(true);
    const uploaded = await attempt(() => api.uploadImage(file, 'colorful'));
    setUploading(false);
    if (!uploaded) return;
    // Cover the room's bounding box, keeping the image's proportions.
    const box = bounds(room.outline);
    const roomW = box.maxX - box.minX;
    const roomH = box.maxY - box.minY;
    const scale = Math.max(roomW / uploaded.width, roomH / uploaded.height);
    const width = round1(uploaded.width * scale);
    const height = round1(uploaded.height * scale);
    change({
      ...draftRef.current!,
      palette: uploaded.theme.map((s) => s.color),
      image: {
        file: uploaded.file, x: round1(box.minX + (roomW - width) / 2), y: round1(box.minY + (roomH - height) / 2), width, height,
        opacity: 0.85, brightness: 100, brightness_from_image: true, mood: uploaded.mood, picks: uploaded.theme, rotation: 0,
      },
    });
    setPick({ type: 'image' });
  };

  const apply = async () => {
    const saved = await attempt(() => api.saveScene(draftRef.current!));
    if (!saved) return;
    setStatus('saved');
    const result = await attempt(() => api.applyScene(saved.id));
    if (result) {
      setResults(result.results);
      const store = useStore.getState();
      if (result.failed) store.toast(`${result.failed} light(s) refused: ${result.results.filter((r) => r.error).map((r) => `${r.label} (${r.error})`).join('; ')}`);
      else store.toast(`Applied ${saved.name} to ${saved.room}.`, false);
      void store.refreshLights();
    }
  };

  return (
    <div className="page scene-editor">
      <header className="page-head">
        <div>
          <p className="eyebrow"><a href="#/scenes">Scenes</a> / {draft.room}</p>
          <input className="title-input" value={draft.name} aria-label="Scene name" onChange={(e) => change({ ...draft, name: e.target.value || draft.name })} />
        </div>
        <div className="head-tools">
          <span className={`save-state ${status}`}>{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Unsaved'}</span>
          <label className="live-toggle" title="Send every change to the lights">
            <Radio size={15} /> Live
            <Toggle checked={live} onChange={setLive} label="Live on the lights" />
          </label>
          <button type="button" className="button primary" onClick={apply}><Play size={16} /> Apply to lights</button>
        </div>
      </header>

      <div className="split">
        <div className="stage">
          <div className="toolbar floating">
            <IconButton label="Select and move" active={tool === 'select'} onClick={() => setTool('select')}><Hand size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Draw a rectangle zone" active={tool === 'rect'} onClick={() => setTool('rect')}><Square size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Draw an ellipse zone" active={tool === 'ellipse'} onClick={() => setTool('ellipse')}><Circle size={18} strokeWidth={1.5} /></IconButton>
            <IconButton label="Draw a freehand zone" active={tool === 'lasso'} onClick={() => setTool('lasso')}><Lasso size={18} strokeWidth={1.5} /></IconButton>
            <span className="toolbar-sep" />
            <button type="button" className="paint-chip" style={{ background: paintColor }} title="Color for new zones" onClick={() => setPick(null)} aria-label="Color for new zones" />
          </div>
          <PlanCanvas fit={fit} units={room.units} onBackgroundPointerDown={() => { setPick(null); return false; }}>
            <defs><clipPath id="room-clip"><path d={pathOf(room.outline)} /></clipPath></defs>
            <path d={pathOf(room.outline)} className="room-floor big" fill={draft.base_mode === 'color' ? draft.base_color : undefined} fillOpacity={draft.base_mode === 'color' ? 0.25 : undefined} />
            <g className="dimmed" pointerEvents="none">
              {room.furniture.map((item) => (
                <g key={item.id} transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`}><FurnitureShape item={item} cmPerPx={1} /></g>
              ))}
            </g>
            <g clipPath="url(#room-clip)">
            {draft.image && (
              <ImageOnPlan layer={draft.image} selected={pick?.type === 'image'} interactive={tool === 'select'}
                onSelect={() => setPick({ type: 'image' })}
                onChange={(image) => setDraft({ ...draftRef.current!, image })} onCommit={commit} />
            )}
            {draft.zones.map((z) => (
              <ZoneShape key={z.id} zone={z} selected={pick?.type === 'zone' && pick.id === z.id} interactive={tool === 'select'}
                onSelect={() => setPick({ type: 'zone', id: z.id })} onChange={(next) => updateZone(next, false)} onCommit={commit} />
            ))}
            </g>
            {zone && <path d={pathOf(zone.points)} fill="none" stroke="#fff" strokeOpacity={0.35} strokeDasharray="6 6" className="zone-ghost" pointerEvents="none" />}
            {draft.image && pick?.type === 'image' && (
              <rect x={draft.image.x} y={draft.image.y} width={draft.image.width} height={draft.image.height} fill="none" stroke="var(--accent)" strokeOpacity={0.5} strokeDasharray="6 6" pointerEvents="none"
                transform={`rotate(${draft.image.rotation ?? 0} ${draft.image.x + draft.image.width / 2} ${draft.image.y + draft.image.height / 2})`} />
            )}
            <path d={pathOf(room.outline)} fill="none" className="room-outline" />
            <PreviewLights room={room} results={resultMap} selected={pick?.type === 'light' ? pick.id : undefined}
              onPick={tool === 'select' ? (id) => setPick({ type: 'light', id }) : undefined} />
            {tool !== 'select' && (
              <DrawLayer tool={tool} color={paintColor} onDone={(points) => {
                const created: Zone = { id: newId(), name: `Zone ${draft.zones.length + 1}`, color: paintColor, brightness: 80, points };
                change({ ...draftRef.current!, zones: [...draftRef.current!.zones, created] });
                setPick({ type: 'zone', id: created.id });
                setTool('select');
              }} />
            )}
          </PlanCanvas>
        </div>

        <aside className="inspector">
          {pick?.type === 'light' ? (
            <OverridePanel
              lightId={pick.id}
              result={resultMap.get(pick.id)}
              override={(draft.overrides ?? {})[pick.id]}
              palette={palette}
              onChange={(next) => {
                const overrides = { ...(draftRef.current!.overrides ?? {}) };
                if (next) overrides[pick.id] = next; else delete overrides[pick.id];
                change({ ...draftRef.current!, overrides });
              }}
            />
          ) : zone ? (
            <Panel title="Zone" actions={<IconButton label="Delete zone" danger onClick={() => { change({ ...draft, zones: draft.zones.filter((z) => z.id !== zone.id) }); setPick(null); }}><Trash2 size={16} /></IconButton>}>
              <Field label="Name"><TextInput value={zone.name} onChange={(e) => updateZone({ ...zone, name: e.target.value })} /></Field>
              <Slider label="Brightness" value={zone.brightness} min={0} max={100} format={(v) => `${Math.round(v)}%`}
                track={`linear-gradient(90deg, #111, ${zone.color})`} onChange={(brightness) => updateZone({ ...zone, brightness })} />
              <ColorPicker value={zone.color} palette={palette} onChange={(color) => { updateZone({ ...zone, color }); setPaintColor(color); }} />
            </Panel>
          ) : pick?.type !== 'image' && (
            <Panel title="Paint color">
              <ColorPicker value={paintColor} palette={palette} onChange={setPaintColor} compact />
              <p className="hint">Pick a drawing tool, then drag on the room. Later zones sit on top.</p>
            </Panel>
          )}

          <Panel title="Image" actions={
            <IconButton label={draft.image ? 'Replace image' : 'Import image'} onClick={() => fileInput.current?.click()} disabled={uploading}><ImagePlus size={16} /></IconButton>
          }>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => importImage(e.target.files?.[0])} />
            {draft.image ? (
              <>
                <ThemeExtractor
                  file={draft.image.file}
                  picks={draft.image.picks}
                  mood={draft.image.mood as ThemeMood}
                  selected={activePick}
                  onSelect={(index, color) => {
                    setActivePick(index);
                    if (zone) updateZone({ ...zone, color });
                    setPaintColor(color);
                  }}
                  onChange={({ picks, mood }) => change({ ...draftRef.current!, palette: picks.map((p) => p.color), image: { ...draftRef.current!.image!, picks, mood: mood as Mood } })}
                />
                <ImagePlacement
                  layer={draft.image}
                  room={room}
                  onChange={(image, save) => (save ? change({ ...draftRef.current!, image }) : setDraft({ ...draftRef.current!, image }))}
                />
                <Slider label="Opacity on the plan" value={draft.image.opacity * 100} min={0} max={100} format={(v) => `${Math.round(v)}%`}
                  onChange={(v) => setDraft({ ...draft, image: { ...draft.image!, opacity: v / 100 } })} onCommit={commit} />
                <Slider label="Brightness" value={draft.image.brightness} min={0} max={100} format={(v) => `${Math.round(v)}%`}
                  onChange={(v) => setDraft({ ...draft, image: { ...draft.image!, brightness: v } })} onCommit={commit} />
                <label className="check-row">
                  <Toggle checked={draft.image.brightness_from_image} label="Darker pixels dim the light" onChange={(v) => change({ ...draft, image: { ...draft.image!, brightness_from_image: v } })} />
                  Darker parts of the image dim the light
                </label>
                <div className="button-row">
                  <button type="button" className="button subtle" onClick={() => change({ ...draft, zones: [...draft.zones, ...zonesFromPalette(room, palette)] })}>
                    <Wand2 size={14} /> Zones from palette
                  </button>
                  <button type="button" className="button danger subtle" onClick={() => { change({ ...draft, image: null }); setPick(null); }}>
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
                <p className="hint">Drag the image on the plan to move it, its corner to resize, and the handle above it to rotate. Lights under it take the color beneath them.</p>
              </>
            ) : (
              <button type="button" className="dropzone" onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void importImage(e.dataTransfer.files[0]); }}>
                <ImagePlus size={28} strokeWidth={1.2} />
                <span>{uploading ? 'Reading colors…' : 'Drop an image or click to import'}</span>
                <small>Its palette appears here, and you can lay it over the room.</small>
              </button>
            )}
          </Panel>

          <Panel title="Layers">
            <ol className="layers">
              {[...draft.zones].reverse().map((z) => {
                const index = draft.zones.indexOf(z);
                const move = (by: number) => {
                  const zones = [...draft.zones];
                  zones.splice(index, 1);
                  zones.splice(Math.max(0, Math.min(zones.length, index + by)), 0, z);
                  change({ ...draft, zones });
                };
                return (
                  <li key={z.id} className={pick?.type === 'zone' && pick.id === z.id ? 'active' : ''} onClick={() => setPick({ type: 'zone', id: z.id })}>
                    <span className="dot" style={{ background: z.color }} />
                    <span>{z.name || 'Zone'}</span>
                    <small>{Math.round(z.brightness)}%</small>
                    <IconButton label="Move up" onClick={() => move(1)}><ArrowUp size={14} /></IconButton>
                    <IconButton label="Move down" onClick={() => move(-1)}><ArrowDown size={14} /></IconButton>
                  </li>
                );
              })}
              {draft.image && <li className={pick?.type === 'image' ? 'active' : ''} onClick={() => setPick({ type: 'image' })}><span className="dot image" /> Image</li>}
            </ol>
            <Field label="Lights outside every zone">
              <Segmented label="Base" value={draft.base_mode} onChange={(base_mode) => change({ ...draft, base_mode })}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'keep', label: 'Keep', title: 'Leave them as they are' },
                  { value: 'color', label: 'Color' },
                  { value: 'nearest', label: 'Nearest', title: 'Take the closest zone' },
                ]} />
            </Field>
            {draft.base_mode === 'color' && (
              <>
                <div className="swatch-row">
                  <Swatch color={draft.base_color} />
                  {palette.map((color, i) => <Swatch key={i} color={color} size={22} onClick={() => change({ ...draft, base_color: color })} />)}
                  <input type="color" className="native-color" value={draft.base_color} onChange={(e) => change({ ...draft, base_color: e.target.value })} aria-label="Base color" />
                </div>
                <Slider label="Base brightness" value={draft.base_brightness} min={0} max={100} format={(v) => `${Math.round(v)}%`}
                  onChange={(base_brightness) => setDraft({ ...draft, base_brightness })} onCommit={commit} />
              </>
            )}
          </Panel>

          <Panel title="What each light gets" actions={<span className="hint">Click a light to override it</span>}>
            <ul className="results">
              {results.map((r) => (
                <li key={r.light_id} className={pick?.type === 'light' && pick.id === r.light_id ? 'active' : ''} onClick={() => setPick({ type: 'light', id: r.light_id })}>
                  <span className="result-color" style={{ background: r.on ? (r.gradient ? gradientCss(r.gradient, r.mode ?? 'interpolated_palette', 24) : r.color ?? '#000') : '#1a1825' }} />
                  <span>{lights[r.light_id]?.name ?? r.label}{r.override && <span className="tag">Override</span>}</span>
                  <small>{r.keep ? 'unchanged' : r.on ? `${Math.round(r.brightness)}%` : 'off'}{r.error ? ` · ${r.error}` : ''}{r.warning ? ` · ${r.warning}` : ''}</small>
                </li>
              ))}
            </ul>
          </Panel>

          <button type="button" className="button danger subtle wide" onClick={async () => {
            if (confirm(`Delete the scene ${draft.name}?`) && (await attempt(() => api.deleteScene(draft.id)))) {
              await refreshScenes();
              go({ view: 'scenes' });
            }
          }}><Trash2 size={14} /> Delete scene</button>
        </aside>
      </div>
    </div>
  );
}


/** Settings for one light that replace what the zones and image give it. */
function OverridePanel({ lightId, result, override, palette, onChange }: {
  lightId: string;
  result: SceneResult | undefined;
  override: LightOverride | undefined;
  palette: string[];
  onChange: (next: LightOverride | null) => void;
}) {
  const light = useStore((state) => state.lights[lightId]);
  const name = light?.name ?? result?.label ?? `Light ${lightId}`;
  const gradient = light?.gradient;
  const fromScene = (): LightOverride => ({
    colors: result?.gradient ?? [result?.color ?? '#ffb36b', ...(gradient ? [result?.color ?? '#ffb36b'] : [])],
    mode: gradient ? (result?.mode ?? gradient.mode) : undefined,
    brightness: result?.brightness || 80,
    on: true,
  });

  if (!override) {
    return (
      <Panel title={name}>
        <p className="hint">This light takes its color from the {result?.keep ? 'base (left unchanged)' : 'zones and image under it'}.</p>
        <button type="button" className="button primary" onClick={() => onChange(fromScene())}>Override this light</button>
      </Panel>
    );
  }

  const colors = override.colors?.length ? override.colors : fromScene().colors!;
  return (
    <Panel title={name} actions={<button type="button" className="button subtle small" onClick={() => onChange(null)}>Clear override</button>}>
      <label className="check-row">
        <Toggle checked={override.on !== false} label="On in this scene" onChange={(on) => onChange({ ...override, on })} />
        On in this scene
      </label>
      <Slider label="Brightness" value={override.brightness ?? 80} min={1} max={100} format={(v) => `${Math.round(v)}%`}
        onChange={(brightness) => onChange({ ...override, brightness })} />
      {gradient ? (
        <GradientEditor
          value={{ colors: colors.length >= 2 ? colors : [colors[0], colors[0]], mode: override.mode ?? gradient.mode, effect: override.effect ?? 'no_effect' }}
          onChange={(next) => onChange({ ...override, colors: next.colors, mode: next.mode, effect: next.effect ?? undefined })}
          modes={gradient.modes}
          capable={gradient.points_capable}
          effects={light?.effect?.values}
          palette={palette}
        />
      ) : (
        <>
          <ColorPicker compact value={colors[0]} palette={palette} onChange={(hex) => onChange({ ...override, colors: [hex] })} />
          {light?.effect && light.effect.values.length > 1 && (
            <div className="pill-row" role="radiogroup" aria-label="Effect">
              {light.effect.values.map((effect) => (
                <button key={effect} type="button" role="radio" aria-checked={(override.effect ?? 'no_effect') === effect}
                  className={`pill${(override.effect ?? 'no_effect') === effect ? ' active' : ''}`}
                  onClick={() => onChange({ ...override, effect })}>
                  {effect === 'no_effect' ? 'None' : effect}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}


/** Rotate the scene image and fit it to the room's outline. */
function ImagePlacement({ layer, room, onChange }: {
  layer: ImageLayer; room: Room; onChange: (image: ImageLayer, save: boolean) => void;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => setAspect(image.naturalWidth / image.naturalHeight);
    image.src = api.imageUrl(layer.file);
  }, [layer.file]);
  const box = bounds(room.outline);
  const rotation = layer.rotation ?? 0;
  const fit = (mode: 'stretch' | 'cover', angle = rotation) =>
    onChange({ ...layer, rotation: angle, ...fitImage(box, angle, aspect ?? layer.width / layer.height, mode) }, true);
  return (
    <div className="image-placement">
      <Slider label="Rotation" value={rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
        onChange={(v) => onChange({ ...layer, rotation: v }, false)} onCommit={(v) => onChange({ ...layer, rotation: v }, true)} />
      <div className="button-row">
        <button type="button" className="button subtle small" onClick={() => onChange({ ...layer, rotation: (Math.round(rotation / 90) * 90 + 90) % 360 }, true)}>
          <RotateCw size={14} /> Rotate 90°
        </button>
        <button type="button" className="button subtle small" title="Stretch the image so it covers the room outline exactly" onClick={() => fit('stretch')}>
          <Maximize size={14} /> Fit to room
        </button>
        <button type="button" className="button subtle small" title="Cover the room, keeping the image's proportions" onClick={() => fit('cover')}>
          <Expand size={14} /> Fill room
        </button>
      </div>
    </div>
  );
}
