// The desk designer: a desk set laid out on its own bench, away from any room, then placed into
// rooms as a locked copy. It also edits a set already placed in a room (Apply puts it back).
// Everything is in desk-local cm: the desk at (0, 0), its front (where you sit) toward +y.
import { useEffect, useMemo, useState } from 'react';
import { Box, LampDesk, Map as MapIcon, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { go } from '../lib/router';
import { bounds, pathOf, round1 } from '../lib/geometry';
import { settle } from '../lib/desks';
import { glareScene, isDisplay, traceGlare } from '../lib/glareMath';
import { DEFAULT_CURVES } from '../lib/screen';
import { FURNITURE_CATALOG } from '../components/Shapes';
import { PlanCanvas } from '../components/PlanCanvas';
import { Room3DStage } from '../components/Room3DStage';
import { ScreenFields } from '../components/ScreenFields';
import { ChairFields, DEFAULT_SEAT_HEIGHT } from '../components/ChairFields';
import { Field, IconButton, LengthInput, Panel, Segmented, Sidebar, Slider, TextInput } from '../components/ui';
import { PlacedFurniture, PlacedLight } from './RoomDesigner';
import type { CatalogItem, DeskDesign, DeskItem, DeskLight, Furniture, Placement, Room } from '../types';

const DESK_KINDS = ['desk', 'desk-l', 'desk-standing'];
/** Elevation and height for pieces that sit on a desk (src/myhuey/models.py FURNITURE_HEIGHTS). */
const ON_DESK: Record<string, [number, number]> = {
  'monitor-24': [75, 36], 'monitor-27': [75, 40], 'monitor-34': [75, 37], 'monitor-49': [75, 33.7],
  laptop: [75, 2], keyboard: [75, 3], speaker: [75, 20], 'desk-standing': [0, 110],
};
const DESK_PIECES = ['desk', 'desk-l', 'desk-standing', 'monitor-24', 'monitor-27', 'monitor-34', 'monitor-49', 'laptop', 'keyboard', 'speaker', 'chair', 'plant'];

interface Draft { id?: string; name: string; items: DeskItem[]; lights: DeskLight[] }

const blank = (): Draft => ({
  name: 'New desk',
  items: [{ key: 'desk', kind: 'desk', label: 'Desk', x: 0, y: 0, width: 140, depth: 70, rotation: 0, shape: 'rect', elevation: 0, height: 75 }],
  lights: [],
});

/** The design laid on a bench with a wall behind the desk, `gap` cm off its back edge, as a room the plan and 3D can draw. */
function benchRoom(draft: Draft, gap: number, catalog: CatalogItem[]): Room {
  const desk = draft.items.find((item) => DESK_KINDS.includes(item.kind)) ?? draft.items[0];
  const back = -((desk?.depth ?? 70) / 2 + gap);
  const product = (id: string | null) => {
    const item = catalog.find((c) => c.id === id);
    return item ? { archetype: item.archetype, productname: item.productname, catalog: item.id } : {};
  };
  return settle({
    name: draft.name, x: 0, y: 0, units: 'metric', outline: [[-170, back], [170, back], [170, back + 260], [-170, back + 260]], width: 340, height: 260,
    ceiling: 250, openings: [], photo: null, desk_sets: [],
    furniture: draft.items.map(({ key, id: _id, ...rest }) => ({ ...rest, id: key, label: rest.label || key }) as Furniture),
    lights: draft.lights.map((light): Placement => ({
      light_id: light.key, label: light.label, x: light.x, y: light.y, rotation: light.rotation, length: light.length,
      elevation: light.elevation, resolved_elevation: light.elevation ?? 100, role: light.role as Placement['role'],
      product: product(light.catalog), metadata: {}, mount: light.mount,
    })),
  });
}

export function DeskDesigner({ design, room, set }: { design?: string; room?: string; set?: string }) {
  const { rooms, replaceRoom, toast } = useStore();
  const [designs, setDesigns] = useState<DeskDesign[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [gap, setGap] = useState(20);
  const [target, setTarget] = useState('');
  const editingSet = !!(room && set);

  useEffect(() => {
    void api.catalog().then(setCatalog).catch(() => setCatalog([]));
    void api.desks().then((list) => {
      setDesigns(list);
      const open = list.find((d) => d.id === design);
      if (open && !editingSet) setDraft({ id: open.id, name: open.name, items: open.items, lights: open.lights });
    }).catch(() => setDesigns([]));
    if (room && set) void api.deskSet(room, set).then((local) => setDraft({ name: local.name, items: local.items, lights: local.lights })).catch(() => {});
  }, [design, room, set, editingSet]);
  useEffect(() => { if (!target && rooms.length) setTarget(rooms[0].name); }, [rooms, target]);

  const bench = useMemo(() => benchRoom(draft, gap, catalog), [draft, gap, catalog]);
  const glare = useMemo(() => {
    const scene = glareScene(bench, 'seated', 'code', () => 0);
    return { scene, report: traceGlare(scene) };
  }, [bench]);
  const fit = useMemo(() => {
    const box = bounds(bench.outline);
    return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
  }, [bench]);

  const keyFor = (kind: string) => {
    let n = 1;
    while ([...draft.items, ...draft.lights].some((thing) => thing.key === `${kind}${n}`)) n += 1;
    return `${kind}${n}`;
  };
  const addPiece = (preset: (typeof FURNITURE_CATALOG)[number]) => {
    const [elevation, height] = ON_DESK[preset.kind] ?? [0, 75];
    const item: DeskItem = {
      key: keyFor(preset.kind), kind: preset.kind, label: preset.label, x: 0, y: preset.kind === 'chair' ? 70 : DESK_KINDS.includes(preset.kind) ? 0 : -15,
      width: preset.width, depth: preset.depth, rotation: preset.kind === 'chair' ? 180 : 0, shape: preset.shape ?? 'rect', elevation, height,
      curve: DEFAULT_CURVES[preset.kind] ?? null, seat: preset.kind === 'chair' ? DEFAULT_SEAT_HEIGHT : null,
    };
    setDraft((d) => ({ ...d, items: [...d.items, item] }));
    setSelected(item.key);
  };
  const addLight = (item: CatalogItem) => {
    const screen = draft.items.find((piece) => isDisplay(piece as Furniture));
    const light: DeskLight = {
      key: keyFor(item.id), catalog: item.id, label: item.label, x: 0, y: -30, rotation: 0, length: null, elevation: null, role: 'auto',
      mount: item.kind === 'bias' && screen ? { screen: screen.key } : null,
    };
    setDraft((d) => ({ ...d, lights: [...d.lights, light] }));
    setSelected(light.key);
  };
  const changePiece = (next: Furniture) =>
    setDraft((d) => ({ ...d, items: d.items.map((item) => (item.key === next.id ? { ...item, ...next, key: item.key, id: item.id } : item)) }));
  const changeLight = (next: Partial<DeskLight> & { key: string }) =>
    setDraft((d) => ({ ...d, lights: d.lights.map((light) => (light.key === next.key ? { ...light, ...next } : light)) }));
  const remove = (key: string) => {
    setDraft((d) => ({
      ...d, items: d.items.filter((item) => item.key !== key),
      lights: d.lights.filter((light) => light.key !== key).map((light) => (light.mount?.screen === key ? { ...light, mount: null } : light)),
    }));
    setSelected(null);
  };

  const body = () => ({ name: draft.name.trim() || 'Desk', items: draft.items, lights: draft.lights });
  const save = async (asNew = false): Promise<string | undefined> => {
    if (asNew || !draft.id) {
      const name = asNew ? prompt('Name the new desk design', `${draft.name} copy`)?.trim() : draft.name.trim();
      if (!name) return undefined;
      const made = await attempt(() => api.createDesk({ ...body(), name }));
      if (!made) return undefined;
      setDraft((d) => ({ ...d, id: made.id, name: made.name }));
      setDesigns((list) => [...list, made]);
      return made.id;
    }
    const updated = await attempt(() => api.updateDesk(draft.id!, body()));
    if (updated) setDesigns((list) => list.map((d) => (d.id === draft.id ? { ...d, ...body() } : d)));
    return draft.id;
  };
  const place = async () => {
    const id = await save();
    const into = rooms.find((r) => r.name === target);
    if (!id || !into) return;
    const box = bounds(into.outline);
    const out = await attempt(() => api.placeDesk(into.name, { design: id, x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2), rotation: 0 }));
    if (out) {
      replaceRoom(into.name, out.room);
      toast(`Placed ${draft.name} in ${into.name}. Drag any piece of it to move the whole set.`);
      go({ view: 'design', room: into.name, tab: 'plan' });
    }
  };
  const apply = async () => {
    const saved = await attempt(() => api.applyDeskSet(room!, set!, { items: draft.items, lights: draft.lights }));
    if (saved) {
      replaceRoom(room!, saved);
      go({ view: 'design', room: room!, tab: 'plan' });
    }
  };
  const removeDesign = async () => {
    if (!draft.id || !confirm(`Delete the desk design "${draft.name}"? Desks already placed from it stay as they are.`)) return;
    if (await attempt(() => api.deleteDesk(draft.id!))) {
      setDesigns((list) => list.filter((d) => d.id !== draft.id));
      setDraft(blank());
      go({ view: 'desks' });
    }
  };

  const piece = bench.furniture.find((item) => item.id === selected);
  const light = draft.lights.find((l) => l.key === selected);
  const screens = draft.items.filter((item) => isDisplay(item as Furniture));

  return (
    <div className="page desk-designer">
      <header className="page-head">
        <h1>~ / studio / desks / <span className="as-typed">{draft.name}</span></h1>
        <Segmented label="View" value={view} onChange={setView}
          options={[{ value: 'plan', label: <><MapIcon size={14} /> Plan</> }, { value: '3d', label: <><Box size={14} /> 3D</> }]} />
      </header>
      <div className="split">
        <div className="stage">
          {view === 'plan' ? (
            <PlanCanvas fit={fit} units="metric" onBackgroundPointerDown={() => { setSelected(null); return false; }}>
              <path d={pathOf(bench.outline)} className="room-floor big" />
              {bench.furniture.map((item) => (
                <PlacedFurniture key={item.id} item={item} units="metric" selected={selected === item.id} onSelect={() => setSelected(item.id)}
                  onChange={changePiece} onCommit={changePiece} />
              ))}
              {bench.lights.map((placement) => (
                <PlacedLight key={placement.light_id} lights={{}} placement={placement} units="metric" selected={selected === placement.light_id}
                  mountedOn={placement.mount ? bench.furniture.find((item) => item.id === placement.mount!.screen) : undefined}
                  onSelect={() => setSelected(placement.light_id)}
                  onChange={(next) => changeLight({ key: next.light_id, x: next.x, y: next.y, rotation: next.rotation, length: next.length })}
                  onCommit={() => {}} />
              ))}
            </PlanCanvas>
          ) : (
            <Room3DStage room={bench} posed={bench} view="orbit" preview selection={selected ? { type: 'furniture', id: selected } : null}
              onSelect={(sel) => setSelected(sel && sel.type !== 'opening' ? sel.id : null)} onLight={(p) => changeLight({ key: p.light_id, x: p.x, y: p.y })}
              onLightCommit={() => {}} onRoom={(next) => next.furniture.forEach(changePiece)} onRigCommit={() => {}}
              scene={glare.scene} report={glare.report} />
          )}
          <p className="stage-hint">The desk faces down the plan: you sit below it. The wall behind is only a preview, for the halo.</p>
        </div>

        <Sidebar name="desks">
          <Panel title={<><LampDesk size={16} strokeWidth={1.5} /> {editingSet ? `Placed in ${room}` : 'Desk designs'}</>} actions={!editingSet && (
            <IconButton label="New design" onClick={() => { setDraft(blank()); setSelected(null); go({ view: 'desks' }); }}><Plus size={16} /></IconButton>
          )}>
            {editingSet ? (
              <>
                <p className="hint">Changes here apply to this one desk set in {room}, where it stands.</p>
                <div className="button-row">
                  <button type="button" className="button primary" onClick={apply}>Apply to {draft.name}</button>
                  <button type="button" className="button" onClick={() => go({ view: 'design', room: room!, tab: 'plan' })}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                {designs.length ? (
                  <div className="catalog">
                    {designs.map((d) => (
                      <button key={d.id} type="button" className={`catalog-item${d.id === draft.id ? ' active' : ''}`} onClick={() => go({ view: 'desks', design: d.id })}>{d.name}</button>
                    ))}
                  </div>
                ) : <p className="hint">No desk designs yet. Lay one out here and save it.</p>}
                <Field label="Design name"><TextInput aria-label="Design name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Field>
                <div className="button-row">
                  <button type="button" className="button primary" onClick={() => void save()}><Save size={14} /> Save</button>
                  <button type="button" className="button" onClick={() => void save(true)}>Save as new</button>
                  {draft.id && <IconButton label="Delete design" danger onClick={removeDesign}><Trash2 size={16} /></IconButton>}
                </div>
                <div className="field-row">
                  <Field label="Room">
                    <select className="input" aria-label="Room" value={target} onChange={(e) => setTarget(e.target.value)}>
                      {rooms.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                    </select>
                  </Field>
                </div>
                <button type="button" className="button" disabled={!target} onClick={() => void place()}>Place in {target || 'a room'}</button>
              </>
            )}
            <Slider label="Wall behind the desk (preview)" value={gap} min={0} max={150} format={(v) => `${Math.round(v)} cm`} onChange={setGap} />
          </Panel>

          {piece && (
            <Panel id="desk-piece" title={piece.label} actions={<IconButton label="Remove from design" danger onClick={() => remove(piece.id)}><Trash2 size={16} /></IconButton>}>
              <div className="field-row">
                <LengthInput label="Across" value={piece.x} units="metric" onCommit={(x) => changePiece({ ...piece, x: round1(x) })} />
                <LengthInput label="Front to back" value={piece.y} units="metric" onCommit={(y) => changePiece({ ...piece, y: round1(y) })} />
              </div>
              <div className="field-row">
                <LengthInput label="Off the floor" value={piece.elevation ?? 0} units="metric" onCommit={(elevation) => changePiece({ ...piece, elevation: round1(elevation) })} />
                <LengthInput label="Height" value={piece.height ?? 75} units="metric" onCommit={(height) => changePiece({ ...piece, height: round1(height) })} />
              </div>
              <div className="field-row">
                <LengthInput label="Width" value={piece.width} units="metric" onCommit={(width) => changePiece({ ...piece, width: round1(width) })} />
                <LengthInput label="Depth" value={piece.depth} units="metric" onCommit={(depth) => changePiece({ ...piece, depth: round1(depth) })} />
              </div>
              <Slider label="Turn" value={piece.rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`} onChange={(rotation) => changePiece({ ...piece, rotation })} />
              {isDisplay(piece) && <ScreenFields item={piece} onChange={changePiece} />}
              {piece.kind === 'chair' && <ChairFields item={piece} units="metric" onChange={changePiece} />}
            </Panel>
          )}
          {light && (
            <Panel id="desk-light" title={light.label} actions={<IconButton label="Remove from design" danger onClick={() => remove(light.key)}><Trash2 size={16} /></IconButton>}>
              <Field label="Mounted on">
                <select className="input" aria-label="Mounted on" value={light.mount?.screen ?? ''}
                  onChange={(e) => changeLight({ key: light.key, mount: e.target.value ? { screen: e.target.value } : null })}>
                  <option value="">Not on a screen</option>
                  {screens.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </Field>
              <LengthInput label="Strip length" value={light.length ?? 200} units="metric" onCommit={(length) => changeLight({ key: light.key, length: round1(length) })} />
              {!light.mount && (
                <LengthInput label="Height" value={light.elevation ?? 100} units="metric" onCommit={(elevation) => changeLight({ key: light.key, elevation: round1(elevation) })} />
              )}
            </Panel>
          )}

          <Panel title="Pieces">
            <div className="catalog">
              {FURNITURE_CATALOG.filter((preset) => DESK_PIECES.includes(preset.kind)).map((preset) => (
                <button key={preset.kind} type="button" className="catalog-item" aria-label={`Add ${preset.label}`} onClick={() => addPiece(preset)}>{preset.label}</button>
              ))}
            </div>
          </Panel>
          <Panel title="Lights">
            <div className="catalog">
              {catalog.map((item) => (
                <button key={item.id} type="button" className="catalog-item" aria-label={`Add ${item.label}`} onClick={() => addLight(item)}>{item.label}</button>
              ))}
            </div>
            <p className="hint">Lights in a design are planned: swap them for your real lights once a set is placed.</p>
          </Panel>
        </Sidebar>
      </div>
    </div>
  );
}
