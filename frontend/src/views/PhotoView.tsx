// A photo of the real room with its lights placed on it: a second view beside the plan.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { liveColor, placedProfile } from '../lib/lights';
import type { PhotoSpot, Room } from '../types';
import { LightControls } from '../components/LightControls';
import { Empty, HueIcon, IconButton, Panel, Slider } from '../components/ui';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_MB = 15;

export function PhotoView({ room }: { room: Room }) {
  const { lights, profiles, replaceRoom } = useStore();
  const [spots, setSpots] = useState<Record<string, PhotoSpot>>(room.photo?.placements ?? {});
  const spotsRef = useRef(spots);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSpots(room.photo?.placements ?? {});
    spotsRef.current = room.photo?.placements ?? {};
  }, [room.photo]);

  const update = (next: Record<string, PhotoSpot>) => {
    spotsRef.current = next;
    setSpots(next);
  };
  const save = async () => {
    const updated = await attempt(() => api.savePhotoPlacements(room.name, spotsRef.current));
    if (updated) replaceRoom(room.name, updated);
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) return useStore.getState().toast('Choose a JPEG, PNG, or WebP photo.');
    if (file.size > MAX_MB * 1024 * 1024) return useStore.getState().toast(`Photos can be at most ${MAX_MB} MB.`);
    setUploading(true);
    const updated = await attempt(() => api.uploadPhoto(room.name, file), 'Photo saved.');
    setUploading(false);
    if (updated) replaceRoom(room.name, updated);
  };

  const position = (clientX: number, clientY: number) => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const place = (id: string, at = { x: 0.5, y: 0.5 }) => {
    const previous: PhotoSpot = spotsRef.current[id] ?? { x: 0.5, y: 0.5, rotation: 0, scale: 1 };
    update({ ...spotsRef.current, [id]: { ...previous, ...at } });
    setSelected(id);
    void save();
  };

  if (!room.photo) {
    return (
      <div
        className="stage photo-empty"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void uploadFile(e.dataTransfer.files[0]); }}
      >
        <Empty icon={<ImagePlus size={40} strokeWidth={1.2} />} title="Add a photo of this room">
          <p>Take a wide photo of the room, then place each light where it really is. JPEG, PNG, or WebP up to {MAX_MB} MB. Location data in the photo is removed.</p>
          <button type="button" className="button primary" disabled={uploading} onClick={() => input.current?.click()}>
            <Upload size={16} /> {uploading ? 'Uploading…' : 'Choose a photo'}
          </button>
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
        </Empty>
      </div>
    );
  }

  const unplaced = room.lights.filter((l) => !spots[l.light_id]);
  const selectedSpot = selected ? spots[selected] : undefined;

  return (
    <div className="split">
      <div className="stage photo-stage" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div
          className="photo-frame"
          ref={frame}
          style={{ aspectRatio: `${room.photo.width} / ${room.photo.height}` }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('application/x-myhuey-light');
            if (id) place(id, position(e.clientX, e.clientY));
          }}
        >
          <img src={api.imageUrl(room.photo.file)} alt={`Photo of ${room.name}`} draggable={false} />
          {Object.entries(spots).map(([id, spot]) => {
            const placement = room.lights.find((l) => l.light_id === id);
            if (!placement) return null;
            const bridge = lights[id];
            const profile = placedProfile(placement, bridge, profiles);
            const color = liveColor(bridge);
            return (
              <button
                key={id}
                type="button"
                className={`photo-marker${selected === id ? ' active' : ''}${color ? ' lit' : ''}`}
                style={{
                  left: `${spot.x * 100}%`, top: `${spot.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${spot.rotation}deg) scale(${spot.scale})`,
                  color: color ?? '#8d88a8', ['--glow' as string]: color ?? 'transparent',
                }}
                title={bridge?.name ?? placement.label}
                aria-label={`${bridge?.name ?? placement.label} on the photo. Drag to move.`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setSelected(id);
                  let moved = false;
                  const move = (e: PointerEvent) => {
                    moved = true;
                    update({ ...spotsRef.current, [id]: { ...spotsRef.current[id], ...position(e.clientX, e.clientY) } });
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                    if (moved) void save();
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                <HueIcon name={profile.icon} size={34} />
                <span className="marker-label">{bridge?.name ?? placement.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="inspector">
        {selected && selectedSpot && (
          <Panel title="On the photo" actions={
            <IconButton label="Remove from photo" danger onClick={() => {
              const next = { ...spotsRef.current };
              delete next[selected];
              update(next);
              setSelected(null);
              void save();
            }}><Trash2 size={16} /></IconButton>
          }>
            {lights[selected] && <LightControls light={lights[selected]} />}
            <Slider label="Marker size" value={selectedSpot.scale} min={0.4} max={4} step={0.1} format={(v) => `${v.toFixed(1)}×`}
              onChange={(scale) => update({ ...spotsRef.current, [selected]: { ...selectedSpot, scale } })} onCommit={() => save()} />
            <Slider label="Rotation" value={selectedSpot.rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
              onChange={(rotation) => update({ ...spotsRef.current, [selected]: { ...selectedSpot, rotation } })} onCommit={() => save()} />
          </Panel>
        )}
        <Panel title="Lights in this room">
          {unplaced.length ? (
            <ul className="tray">
              {unplaced.map((placement) => {
                const profile = placedProfile(placement, lights[placement.light_id], profiles);
                return (
                  <li key={placement.light_id} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-myhuey-light', placement.light_id)}>
                    <HueIcon name={profile.icon} size={20} />
                    <span>{lights[placement.light_id]?.name ?? placement.label}<small>Drag onto the photo</small></span>
                    <IconButton label="Place in the middle" onClick={() => place(placement.light_id)}><Plus size={16} /></IconButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint">{room.lights.length ? 'Every light in this room is on the photo.' : 'Place lights on the plan first.'}</p>
          )}
        </Panel>
        <Panel title="Photo">
          <div className="button-row">
            <button type="button" className="button" onClick={() => input.current?.click()} disabled={uploading}><Upload size={14} /> Replace</button>
            <button type="button" className="button danger subtle" onClick={async () => {
              if (!confirm('Remove this photo? Light positions on it are removed too.')) return;
              if (await attempt(() => api.deletePhoto(room.name))) replaceRoom(room.name, { ...room, photo: null });
            }}><Trash2 size={14} /> Remove</button>
          </div>
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
          <p className="hint">{room.photo.width} × {room.photo.height} px. Replacing the photo keeps light positions.</p>
        </Panel>
      </aside>
    </div>
  );
}
