import { useState } from 'react';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { go } from '../lib/router';
import { bounds, pathOf } from '../lib/geometry';
import type { Room, Scene } from '../types';
import { Empty, Field, Panel, TextInput } from '../components/ui';

export function ScenePreview({ scene, room }: { scene: Scene; room: Room | undefined }) {
  if (!room) return <div className="scene-thumb missing" />;
  const box = bounds(room.outline);
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.05;
  const clip = `clip-${scene.id}`;
  return (
    <svg className="scene-thumb" viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`} aria-hidden="true">
      <defs><clipPath id={clip}><path d={pathOf(room.outline)} /></clipPath></defs>
      <path d={pathOf(room.outline)} fill={scene.base_mode === 'color' ? scene.base_color : '#15131f'} fillOpacity={scene.base_mode === 'color' ? 0.5 : 1} />
      <g clipPath={`url(#${clip})`}>
        {scene.image && (
          <image href={api.imageUrl(scene.image.file)} x={scene.image.x} y={scene.image.y} width={scene.image.width} height={scene.image.height}
            preserveAspectRatio="none" opacity={scene.image.opacity} />
        )}
        {scene.zones.map((zone) => <path key={zone.id} d={pathOf(zone.points)} fill={zone.color} fillOpacity={0.35 + (zone.brightness / 100) * 0.5} />)}
      </g>
      <path d={pathOf(room.outline)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={pad * 0.15} />
      {room.lights.map((light) => <circle key={light.light_id} cx={light.x} cy={light.y} r={pad * 0.35} fill="#fff" fillOpacity={0.85} />)}
    </svg>
  );
}

export function ScenesView() {
  const { scenes, rooms, refreshScenes } = useStore();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(rooms[0]?.name ?? '');
  const [applying, setApplying] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim() || !room) return useStore.getState().toast('Name the scene and pick its room.');
    const scene = await attempt(() => api.createScene({ name: name.trim(), room, zones: [], base_mode: 'off' }));
    if (scene) {
      await refreshScenes();
      go({ view: 'scene', id: scene.id });
    }
  };

  const apply = async (scene: Scene) => {
    setApplying(scene.id);
    const result = await attempt(() => api.applyScene(scene.id));
    setApplying(null);
    if (result) {
      const store = useStore.getState();
      if (result.failed) store.toast(`${result.failed} light(s) did not take the scene: ${result.results.filter((r) => r.error).map((r) => r.label).join(', ')}`);
      else store.toast(`Applied ${scene.name}.`, false);
      void store.refreshLights();
    }
  };

  const byRoom = rooms.map((r) => ({ room: r, scenes: scenes.filter((s) => s.room === r.name) })).filter((group) => group.scenes.length);

  return (
    <div className="page scenes">
      <header className="page-head">
        <div>
          <p className="eyebrow">Scenes</p>
          <h1>Paint light onto rooms</h1>
        </div>
      </header>
      <div className="split">
        <div className="scene-groups">
          {byRoom.length ? byRoom.map(({ room: r, scenes: list }) => (
            <section key={r.name}>
              <h2 className="group-title">{r.name}</h2>
              <div className="scene-grid">
                {list.map((scene) => (
                  <article key={scene.id} className="scene-card">
                    <a href={`#/scenes/${scene.id}`} className="scene-card-preview" aria-label={`Edit ${scene.name}`}>
                      <ScenePreview scene={scene} room={r} />
                    </a>
                    <div className="scene-card-body">
                      <strong>{scene.name}</strong>
                      <div className="swatch-row tiny">
                        {(scene.palette.length ? scene.palette : scene.zones.map((z) => z.color)).slice(0, 8).map((color, i) => (
                          <span key={i} className="dot" style={{ background: color }} />
                        ))}
                      </div>
                    </div>
                    <div className="scene-card-actions">
                      <button type="button" className="button primary small" onClick={() => apply(scene)} disabled={applying === scene.id}>
                        <Play size={14} /> {applying === scene.id ? 'Applying…' : 'Apply'}
                      </button>
                      <a className="icon-button" href={`#/scenes/${scene.id}`} aria-label="Edit"><Pencil size={15} /></a>
                      <button type="button" className="icon-button danger" aria-label="Delete" onClick={async () => {
                        if (confirm(`Delete the scene ${scene.name}?`) && (await attempt(() => api.deleteScene(scene.id)))) await refreshScenes();
                      }}><Trash2 size={15} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )) : (
            <Empty title="No scenes yet"><p>Create a scene, then paint color zones or lay an image over the room. Each light takes the color under it.</p></Empty>
          )}
        </div>
        <aside className="inspector">
          <Panel title="New scene">
            <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset" /></Field>
            <Field label="Room">
              <select className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
                {rooms.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
            </Field>
            <button type="button" className="button primary" onClick={create}><Plus size={16} /> Create scene</button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
