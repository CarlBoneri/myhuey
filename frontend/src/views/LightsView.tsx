// Every light, grouped by room. Click a light to adjust it; Cmd/Ctrl/Shift-click or tick several
// (or a whole room) to change them together.
import { useEffect, useMemo, useState } from 'react';
import { Power, PowerOff, X } from 'lucide-react';
import { useStore, sendLight } from '../store';
import type { BridgeLight } from '../types';
import { LightControls } from '../components/LightControls';
import { ColorPicker } from '../components/ColorPicker';
import { Empty, HueIcon, Panel, Slider, Toggle } from '../components/ui';
import { formatLength } from '../lib/units';
import { groupLightsByRoom } from '../lib/lights';
import { kelvinToHex } from '../lib/color';
import { groupState, pick, pickAll } from '../lib/selection';
import { throttleLatest } from '../lib/throttle';

export function LightsView() {
  const { lights, rooms, setup, lightsError } = useStore();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) setSelected([]);
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
