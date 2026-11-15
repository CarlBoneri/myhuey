import { useState } from 'react';
import { useStore, sendLight } from '../store';
import type { BridgeLight } from '../types';
import { LightControls } from '../components/LightControls';
import { Empty, HueIcon, Panel, Toggle } from '../components/ui';
import { formatLength } from '../lib/units';
import { groupLightsByRoom } from '../lib/lights';

export function LightsView() {
  const { lights, rooms, setup, lightsError } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  if (!setup?.configured) return <div className="page"><Empty title="No bridge paired"><a className="button primary" href="#/settings">Pair a bridge</a></Empty></div>;

  // A light can be placed in more than one room; it is listed under each.
  const groups = groupLightsByRoom(Object.keys(lights), rooms).map(
    ([room, ids]) => [room, ids.map((id) => lights[id])] as [string, BridgeLight[]],
  );
  const current = selected ? lights[selected] : undefined;

  return (
    <div className="page lights">
      <header className="page-head">
        <div><p className="eyebrow">Lights</p><h1>Every light</h1></div>
        {lightsError && <span className="pill static warn">{lightsError}</span>}
      </header>
      <div className="split">
        <div className="light-groups">
          {groups.map(([room, list]) => (
            <section key={room}>
              <h2 className="group-title">{room}</h2>
              <div className="light-grid">
                {list.map((light) => (
                  <article
                    key={light.id}
                    className={`light-card${light.on ? ' on' : ''}${selected === light.id ? ' active' : ''}`}
                    style={{ ['--light' as string]: light.on && light.color ? light.color : 'transparent' }}
                    onClick={() => setSelected(light.id)}
                  >
                    <HueIcon name={light.profile.icon} size={30} className="light-card-icon" />
                    <div>
                      <strong>{light.name}</strong>
                      <small>{light.profile.label} · {formatLength(light.profile.length, 'imperial')}{light.profile.gradient ? ' · gradient' : ''}</small>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle checked={light.on} label={`Turn ${light.name} ${light.on ? 'off' : 'on'}`} onChange={(on) => sendLight(light.id, { on }, { on })} />
                    </span>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="inspector">
          {current ? <Panel title="Light"><LightControls light={current} /></Panel> : <Panel title="Light"><p className="hint">Pick a light to change its brightness and color.</p></Panel>}
        </aside>
      </div>
    </div>
  );
}
