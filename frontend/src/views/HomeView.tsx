// Home: everyday control. Quick on/off and brightness for every room, and a tile per room with its
// live state; the ⋮ on a tile applies an eye-comfort suggestion or a saved scene in one tap.
// Home always works on the Active layout, even while a sandbox is open in the Studio.
import { Map as MapIcon, Power, PowerOff } from 'lucide-react';
import { setRoomPower, useStore } from '../store';
import { go, href } from '../lib/router';
import { roomSummary } from '../lib/roomControls';
import type { Room } from '../types';
import { Empty, Panel } from '../components/ui';
import { RoomDimmer } from '../components/RoomDimmer';
import { QuickSettings } from '../components/QuickSettings';

export function HomeView() {
  const { lights, layout, layouts, openLayout } = useStore();
  const rooms = useStore((state) => (state.layout ? state.activeRooms : state.rooms));
  const sandboxName = layout ? (layouts.find((item) => item.id === layout)?.name ?? 'a sandbox') : null;

  // The workbench works on whatever layout is open, so leave a sandbox before opening it from here.
  const openRoom = async (room: Room) => {
    if (layout) await openLayout(null);
    go({ view: 'room', room: room.name });
  };

  const lightsOn = Object.values(lights).filter((light) => light.on).length;

  return (
    <div className="page home">
      <header className="page-head">
        <div>
          <p className="eyebrow">Home</p>
          <h1>Your rooms</h1>
        </div>
        <div className="stat-pills">
          <span className="pill static">{rooms.length} rooms</span>
          <span className="pill static">{Object.keys(lights).length} lights</span>
          <span className="pill static glow">{lightsOn} on</span>
        </div>
      </header>

      {sandboxName && (
        <p className="sandbox-note">
          You're editing the sandbox {sandboxName} in the Studio. Home always controls your active home.
        </p>
      )}

      {!rooms.length ? (
        <Empty title="No rooms yet">
          <p>Lay out your home in the Studio: add rooms by size, import them from your Hue bridge, or trace a floor plan.</p>
          <a className="button primary" href={href({ view: 'studio' })}><MapIcon size={16} /> Set up your home in the Studio</a>
        </Empty>
      ) : (
        <div className="home-flows">
          <Panel title="Quick settings" className="quick-settings">
            <ul className="room-list">
              {rooms.map((room) => {
                const { known, on } = roomSummary(room, lights);
                return (
                  <li key={room.name} className="room-row">
                    <a href={href({ view: 'room', room: room.name })} onClick={(event) => {
                      if (!layout) return;
                      event.preventDefault();
                      void openRoom(room);
                    }}>
                      <span>{room.name}</span>
                      <small>{known ? `${on} of ${known} on` : room.lights.length ? `${room.lights.length} lights` : 'No lights placed'}</small>
                    </a>
                    {known > 0 && (
                      <div className="room-power-buttons">
                        <button type="button" className={`icon-button${on === known ? ' lit' : ''}`} title="All on" aria-label={`Turn on every light in ${room.name}`} onClick={() => setRoomPower(room, true, true)}>
                          <Power size={16} strokeWidth={1.6} />
                        </button>
                        <button type="button" className={`icon-button${on === 0 ? ' dim' : ''}`} title="All off" aria-label={`Turn off every light in ${room.name}`} onClick={() => setRoomPower(room, false, true)}>
                          <PowerOff size={16} strokeWidth={1.6} />
                        </button>
                      </div>
                    )}
                    <RoomDimmer room={room} compact activeOnly />
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Rooms" className="rooms-panel">
            <div className="room-tiles">
              {rooms.map((room) => <RoomTile key={room.name} room={room} onOpen={() => void openRoom(room)} />)}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function RoomTile({ room, onOpen }: { room: Room; onOpen: () => void }) {
  const lights = useStore((state) => state.lights);
  const { known, on, brightness, chips } = roomSummary(room, lights);
  const lit = on > 0;
  const state = !known ? (room.lights.length ? 'Lights not answering' : 'No lights placed') : lit ? `${on} of ${known} on` : 'Off';
  return (
    <article className={`room-tile${lit ? ' lit' : ''}`} role="link" tabIndex={0} aria-label={`${room.name}: ${state}. Open the workbench.`}
      style={{ ['--tile-glow' as string]: chips[0] ?? 'transparent' }}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }}>
      <div className="room-tile-head">
        <strong>{room.name}</strong>
        <QuickSettings room={room} onOpen={onOpen} />
      </div>
      <div className="room-tile-state">
        <span className={`state-dot${lit ? ' on' : ''}`} aria-hidden="true" />
        <span>{state}</span>
      </div>
      <div className="room-tile-foot">
        <span className="room-tile-level">{brightness !== null ? `${brightness}%` : '—'}</span>
        <span className="chip-row" aria-label="Colors in the room now">
          {chips.map((color) => <span key={color} className="chip-dot" style={{ background: color }} title={color} />)}
        </span>
      </div>
    </article>
  );
}
