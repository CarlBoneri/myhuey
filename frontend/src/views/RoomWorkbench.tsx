// A room's workbench: use and tune the room. Power, the room dimmer, each light, the room's
// scenes, and eye-comfort suggestions. Shapes, furniture, and placement live in the Studio.
import { useState } from 'react';
import { Map as MapIcon, Play, Plus, Power, PowerOff } from 'lucide-react';
import { api } from '../api';
import { attempt, sendLight, setRoomPower, useStore } from '../store';
import { href } from '../lib/router';
import { formatLength } from '../lib/units';
import { roomSummary } from '../lib/roomControls';
import { LightControls } from '../components/LightControls';
import { RoomDimmer } from '../components/RoomDimmer';
import { RoomLighting } from '../components/RoomLighting';
import { Empty, HueIcon, Panel, Sidebar, Toggle } from '../components/ui';

export function RoomWorkbench({ name }: { name: string }) {
  const { rooms, lights, scenes, refreshLights } = useStore();
  const room = rooms.find((item) => item.name === name);
  const [selected, setSelected] = useState<string | null>(null);

  if (!room) {
    return <div className="page"><Empty title={`No room named “${name}”`}><a className="button" href="#/">Back home</a></Empty></div>;
  }

  const designer = href({ view: 'design', room: room.name, tab: 'plan' });
  const summary = roomSummary(room, lights);
  const roomLights = room.lights.map((p) => lights[p.light_id]).filter((light) => !!light);
  const missing = room.lights.filter((p) => !lights[p.light_id]);
  const planned = missing.filter((p) => p.planned);
  const silent = missing.filter((p) => !p.planned);
  const current = selected ? lights[selected] : undefined;
  const roomScenes = scenes.filter((scene) => scene.room === room.name);

  return (
    <div className="page workbench">
      <header className="page-head">
        <div>
          <p className="eyebrow"><a href="#/">Home</a> / Room</p>
          <h1 className="as-typed">{room.name}</h1>
        </div>
        <div className="head-tools">
          {summary.known > 0 && (
            <>
              <button type="button" className={`button${summary.on === summary.known ? ' active' : ''}`} onClick={() => setRoomPower(room, true)}><Power size={15} /> All on</button>
              <button type="button" className="button" onClick={() => setRoomPower(room, false)}><PowerOff size={15} /> All off</button>
            </>
          )}
          <a className="button subtle" href={designer}><MapIcon size={15} /> Design in Studio</a>
        </div>
      </header>

      {!room.lights.length ? (
        <Empty title="No lights in this room yet">
          <p>Place lights on the room's plan in the Studio, then come back here to use them.</p>
          <a className="button primary" href={designer}><MapIcon size={16} /> Place lights</a>
        </Empty>
      ) : (
        <div className="split">
          <div className="workbench-main">
            <RoomDimmer room={room} />
            <div className="light-grid">
              {roomLights.map((light) => (
                <article key={light.id} className={`light-card${light.on ? ' on' : ''}${selected === light.id ? ' active' : ''}`}
                  style={{ ['--light' as string]: light.on && light.color ? light.color : 'transparent' }}
                  onClick={() => setSelected(light.id)}>
                  <HueIcon name={light.profile.icon} size={30} className="light-card-icon" />
                  <div>
                    <strong>{light.name}</strong>
                    <small>{light.profile.label} · {formatLength(light.profile.length, room.units)}</small>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={light.on} label={`Turn ${light.name} ${light.on ? 'off' : 'on'}`} onChange={(on) => sendLight(light.id, { on }, { on })} />
                  </span>
                </article>
              ))}
            </div>
            {planned.length > 0 && <p className="hint">Planned, not installed yet: {planned.map((p) => p.label).join(', ')}.</p>}
            {silent.length > 0 && <p className="hint">Not answering on the bridge: {silent.map((p) => p.label).join(', ')}.</p>}
            <RoomLighting room={room} />
          </div>
          <Sidebar name="workbench">
            <Panel title="Light">
              {current ? <LightControls light={current} /> : <p className="hint">Pick a light to change its brightness and color.</p>}
            </Panel>
            <Panel title="Scenes" actions={<a className="button subtle small" href="#/scenes"><Plus size={14} /> New</a>}>
              {roomScenes.length ? (
                <ul className="scene-rows">
                  {roomScenes.map((scene) => (
                    <li key={scene.id}>
                      <a href={href({ view: 'scene', id: scene.id })}>{scene.name}</a>
                      <button type="button" className="button small" onClick={async () => {
                        const result = await attempt(() => api.applyScene(scene.id));
                        if (result) {
                          useStore.getState().toast(result.failed ? `${result.failed} light(s) did not change.` : `“${scene.name}” is on.`, result.failed > 0);
                          await refreshLights();
                        }
                      }}><Play size={14} /> Apply</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="hint">No scenes for this room yet. Save a suggestion, or make one from an image on the Scenes tab.</p>}
            </Panel>
          </Sidebar>
        </div>
      )}
    </div>
  );
}
