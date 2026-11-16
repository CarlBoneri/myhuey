// Every light, grouped by room. Click a light to adjust it; Cmd/Ctrl/Shift-click or tick several
// (or a whole room) to change them together. Save a pick as a named group (stored by myhuey, not on
// the bridge); a group can also keep a look that ▶ puts back in one tap.
import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Play, Plus, Power, PowerOff, Save, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore, sendLight } from '../store';
import type { BridgeLight, LightGroup } from '../types';
import { LightControls } from '../components/LightControls';
import { ColorPicker } from '../components/ColorPicker';
import { Empty, HueIcon, IconButton, Panel, Slider, TextInput, Toggle } from '../components/ui';
import { formatLength } from '../lib/units';
import { groupLightsByRoom } from '../lib/lights';
import { kelvinToHex } from '../lib/color';
import { groupState, pick, pickAll, sameLights } from '../lib/selection';
import { throttleLatest } from '../lib/throttle';

export function LightsView() {
  const { lights, rooms, setup, lightsError } = useStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<LightGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => { void attempt(() => api.groups()).then((list) => list && setSaved(list)); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) { setSelected([]); setGroupId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!setup?.configured) return <div className="page"><Empty title="No bridge paired"><a className="button primary" href="#/settings">Pair a bridge</a></Empty></div>;

  // A light can be placed in more than one room; it is listed under each.
  const groups = groupLightsByRoom(Object.keys(lights), rooms).map(
    ([room, ids]) => [room, ids.map((id) => lights[id])] as [string, BridgeLight[]],
  );
  const picked = selected.map((id) => lights[id]).filter((light): light is BridgeLight => !!light);
  const group = saved.find((item) => item.id === groupId) ?? null;
  const replace = (next: LightGroup) => setSaved(saved.map((item) => (item.id === next.id ? next : item)));
  const openGroup = (item: LightGroup) => { setGroupId(item.id); setSelected(item.lights.filter((id) => lights[id])); };
  const applyLook = async (item: LightGroup) => {
    const result = await attempt(() => api.applyGroup(item.id));
    if (!result) return;
    const failed = result.results.filter((r) => !r.ok);
    useStore.getState().toast(failed.length
      ? `${failed.length} light(s) in ${item.name} did not change: ${failed.map((r) => r.label).join(', ')}`
      : `${item.name} is back the way you saved it.`, failed.length > 0);
    await useStore.getState().refreshLights();
  };
  const saveSelection = async () => {
    const name = (naming ?? '').trim();
    if (!name) return;
    const made = await attempt(() => api.createGroup(name, selected), `Saved the group ${name}.`);
    if (made) { setSaved([...saved, made]); setGroupId(made.id); setNaming(null); }
  };

  return (
    <div className="page lights">
      <header className="page-head">
        <div><p className="eyebrow">Lights</p><h1>Every light</h1></div>
        <div className="head-tools">
          {lightsError && <span className="pill static warn">{lightsError}</span>}
          {picked.length > 1 && (
            <button type="button" className="button subtle" onClick={() => setSelected([])}><X size={14} /> {picked.length} selected</button>
          )}
        </div>
      </header>
      <div className="split">
        <div className="light-groups">
          <div className="group-bar" role="group" aria-label="Saved groups">
            {saved.map((item) => (
              <span key={item.id} className={`group-chip${item.id === groupId ? ' active' : ''}`}>
                <button type="button" onClick={() => openGroup(item)} title={`Select the ${item.lights.length} lights in ${item.name}`}>{item.name}</button>
                {item.look && (
                  <button type="button" className="group-play" aria-label={`Apply the look saved for ${item.name}`} title="Put these lights back the way they were saved"
                    onClick={() => void applyLook(item)}><Play size={13} /></button>
                )}
              </span>
            ))}
            {naming === null ? (
              <button type="button" className="button subtle small" disabled={!picked.length} onClick={() => setNaming('')}
                title={picked.length ? 'Save the picked lights as a group' : 'Pick some lights first'}><Plus size={14} /> Save selection</button>
            ) : (
              <form className="group-name-form" onSubmit={(event) => { event.preventDefault(); void saveSelection(); }}>
                <TextInput autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Group name" aria-label="Group name" maxLength={60} />
                <button type="submit" className="button small primary" disabled={!naming.trim()}>Save</button>
                <button type="button" className="button small subtle" onClick={() => setNaming(null)}>Cancel</button>
              </form>
            )}
          </div>
          <p className="hint">Click a light to adjust it. Tick several, or Cmd/Ctrl-click them, to change them together.</p>
          {groups.map(([room, list]) => {
            const ids = list.map((light) => light.id);
            const all = ids.every((id) => selected.includes(id));
            return (
              <section key={room}>
                <div className="group-head">
                  <h2 className="group-title">{room}</h2>
                  <button type="button" className="button subtle small" onClick={() => setSelected(pickAll(selected, ids))}>
                    {all ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="light-grid">
                  {list.map((light) => {
                    const isPicked = selected.includes(light.id);
                    return (
                      <article
                        key={light.id}
                        className={`light-card${light.on ? ' on' : ''}${isPicked ? ' active' : ''}`}
                        style={{ ['--light' as string]: light.on && light.color ? light.color : 'transparent' }}
                        onClick={(event) => setSelected(pick(selected, light.id, event.metaKey || event.ctrlKey || event.shiftKey))}
                      >
                        <input type="checkbox" className="light-pick" checked={isPicked} aria-label={`Select ${light.name}`}
                          onClick={(event) => event.stopPropagation()} onChange={() => setSelected(pick(selected, light.id, true))} />
                        <HueIcon name={light.profile.icon} size={30} className="light-card-icon" />
                        <div>
                          <strong>{light.name}</strong>
                          <small>{light.profile.label} · {formatLength(light.profile.length, 'imperial')}{light.profile.gradient ? ' · gradient' : ''}</small>
                        </div>
                        <span onClick={(e) => e.stopPropagation()}>
                          <Toggle checked={light.on} label={`Turn ${light.name} ${light.on ? 'off' : 'on'}`} onChange={(on) => sendLight(light.id, { on }, { on })} />
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <aside className="inspector">
          {group && (
            <GroupPanel key={group.id} group={group} selected={selected} onApply={() => void applyLook(group)} onChange={replace}
              onDeleted={() => { setSaved(saved.filter((item) => item.id !== group.id)); setGroupId(null); }} />
          )}
          {picked.length > 1 ? <GroupControls lights={picked} />
            : picked.length === 1 ? <Panel title="Light"><LightControls light={picked[0]} /></Panel>
              : <Panel title="Light"><p className="hint">Pick a light to change its brightness and color.</p></Panel>}
        </aside>
      </div>
    </div>
  );
}

/** One set of controls for several lights: each change goes to every light that can take it. */
function GroupControls({ lights }: { lights: BridgeLight[] }) {
  const state = groupState(lights);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [kelvin, setKelvin] = useState<number | null>(null);
  const each = (filter: (light: BridgeLight) => boolean, changes: Record<string, unknown>, optimistic: Partial<BridgeLight>) =>
    lights.filter(filter).forEach((light) => sendLight(light.id, changes, optimistic));
  // A drag fans out to every picked light, so it is paced to about ten bridge commands a second.
  const key = lights.map((light) => light.id).join(',');
  const pace = Math.max(150, lights.length * 100);
  const dim = useMemo(() => throttleLatest((v: number) => each((light) => light.brightness !== null, { brightness: v, on: true }, { brightness: v, on: true }), pace), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const warmth = useMemo(() => throttleLatest((v: number) => each((light) => light.supports_color_temp, { color_temp: v, on: true }, { color_temp: v, color: kelvinToHex(v), on: true }), pace), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const paint = useMemo(() => throttleLatest((hex: string) => each((light) => light.supports_color, { color: hex, on: true }, { color: hex, on: true }), pace), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title={`${state.count} lights`}>
      <p className="hint">{state.on} of {state.count} on · {lights.map((light) => light.name).join(', ')}</p>
      <div className="button-row">
        <button type="button" className={`button${state.on === state.count ? ' active' : ''}`} onClick={() => each(() => true, { on: true }, { on: true })}><Power size={15} /> All on</button>
        <button type="button" className="button" onClick={() => each(() => true, { on: false }, { on: false })}><PowerOff size={15} /> All off</button>
      </div>
      {state.dimmable && (
        <Slider label="Brightness" value={brightness ?? state.brightness ?? 127} min={1} max={254}
          format={(v) => `${Math.round((v / 254) * 100)}%`} track="linear-gradient(90deg, #1b1a24, #fff4dc)"
          onChange={(v) => { setBrightness(v); dim(v); }}
          onCommit={(v) => { dim(v); dim.flush(); setBrightness(null); }} />
      )}
      {state.colorTemp && (
        <Slider label="White temperature" value={kelvin ?? 2700} min={2000} max={6500} step={100} format={(v) => `${v} K`}
          track={`linear-gradient(90deg, ${kelvinToHex(2000)}, ${kelvinToHex(4000)}, ${kelvinToHex(6500)})`}
          onChange={(v) => { setKelvin(v); warmth(v); }}
          onCommit={(v) => { warmth(v); warmth.flush(); setKelvin(null); }} />
      )}
      {state.color && (
        <ColorPicker compact value={lights.find((light) => light.supports_color)?.color ?? '#ffffff'}
          onChange={paint} />
      )}
    </Panel>
  );
}

/** The current saved group: its look, its lights, its name. */
function GroupPanel({ group, selected, onApply, onChange, onDeleted }: {
  group: LightGroup; selected: string[]; onApply: () => void; onChange: (group: LightGroup) => void; onDeleted: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const differs = selected.length > 0 && !sameLights(selected, group.lights);
  const update = async (work: () => Promise<LightGroup>, message?: string) => {
    const next = await attempt(work, message);
    if (next) onChange(next);
    return next;
  };
  return (
    <Panel title={name === null ? group.name : 'Rename group'} actions={name === null && !confirming && (
      <>
        <IconButton label={`Rename ${group.name}`} onClick={() => setName(group.name)}><Pencil size={15} /></IconButton>
        <IconButton label={`Delete ${group.name}`} danger onClick={() => setConfirming(true)}><Trash2 size={15} /></IconButton>
      </>
    )}>
      {name !== null && (
        <form className="group-name-form" onSubmit={async (event) => {
          event.preventDefault();
          if (name.trim() && (await update(() => api.updateGroup(group.id, { name: name.trim() })))) setName(null);
        }}>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" maxLength={60} />
          <IconButton label="Save the name" onClick={async () => { if (name.trim() && (await update(() => api.updateGroup(group.id, { name: name.trim() })))) setName(null); }}><Check size={15} /></IconButton>
          <IconButton label="Cancel renaming" onClick={() => setName(null)}><X size={15} /></IconButton>
        </form>
      )}
      {confirming && (
        <div className="inline-confirm">
          <span>Delete {group.name}? Your lights are not changed.</span>
          <button type="button" className="button small danger" onClick={async () => {
            if (await attempt(() => api.deleteGroup(group.id), `Deleted ${group.name}.`)) onDeleted();
          }}>Yes</button>
          <button type="button" className="button small subtle" onClick={() => setConfirming(false)}>No</button>
        </div>
      )}
      <p className="hint">{group.lights.length} lights · {group.look ? 'a look is saved' : 'no look saved yet'}</p>
      <div className="button-row">
        {group.look && <button type="button" className="button primary" onClick={onApply}><Play size={15} /> Apply look</button>}
        <button type="button" className="button" onClick={() => void update(() => api.saveGroupLook(group.id), `Saved how ${group.name} looks now.`)}>
          <Save size={15} /> {group.look ? 'Save current look again' : 'Save current look'}
        </button>
        {group.look && <button type="button" className="button subtle" onClick={() => void update(() => api.clearGroupLook(group.id))}>Clear look</button>}
      </div>
      {differs && (
        <button type="button" className="button subtle" onClick={() => void update(() => api.updateGroup(group.id, { lights: selected }), `${group.name} now has ${selected.length} lights.`)}>
          Update lights to this selection ({selected.length})
        </button>
      )}
      <p className="hint">A look keeps each light's on/off, brightness, and color, so ▶ puts them all back in one tap.</p>
    </Panel>
  );
}
