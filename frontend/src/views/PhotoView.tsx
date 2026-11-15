// A photo of the real room with plan items tagged on it: lights, furniture, windows and doors.
// The plan stays the source of truth; the photo is where you tag things and see suggestions.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, MapPin, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import { liveColor, placedProfile } from '../lib/lights';
import { darkness, glowLayout, heightPreset, nudge, parseTag, resolvableTags, tagKey, type HeightPreset, type TagKind } from '../lib/photo';
import { oneAtATime } from '../lib/suggest';
import { formatLength } from '../lib/units';
import type { PhotoSpot, Room, Suggestion } from '../types';
import { LightControls } from '../components/LightControls';
import { SuggestPanel } from '../components/SuggestPanel';
import { Empty, HueIcon, IconButton, Panel, Slider } from '../components/ui';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_MB = 15;
const PRESETS: { value: HeightPreset; label: string }[] = [
  { value: 'floor', label: 'Floor' }, { value: 'desk', label: 'Desk top' }, { value: 'eye', label: 'Eye level' },
  { value: 'ceiling', label: 'Ceiling' }, { value: 'auto', label: 'Auto' },
];

interface Item { key: string; kind: TagKind; label: string; icon?: string }

export function PhotoView({ room }: { room: Room }) {
  const { lights, profiles, replaceRoom, refreshRooms } = useStore();
  const [spots, setSpots] = useState<Record<string, PhotoSpot>>(room.photo?.tags ?? {});
  const spotsRef = useRef(spots);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [shown, setShown] = useState<Suggestion | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSpots(room.photo?.tags ?? {});
    spotsRef.current = room.photo?.tags ?? {};
  }, [room.photo]);

  const update = (next: Record<string, PhotoSpot>) => {
    spotsRef.current = next;
    setSpots(next);
  };
  // Saves go one at a time and changes made meanwhile fold into one follow-up save, so the
  // newest tags always reach the server last. Only tags the server accepts are sent, and a
  // failed save puts the photo back the way the server has it, so one bad tag can't block the rest.
  const roomRef = useRef(room);
  roomRef.current = room;
  const save = useRef(oneAtATime(async (isLast) => {
    const current = roomRef.current;
    const updated = await attempt(() => api.savePhotoTags(current.name, resolvableTags(spotsRef.current, current)));
    if (!isLast()) return;
    if (updated) {
      replaceRoom(current.name, updated);
    } else {
      const saved = useStore.getState().rooms.find((r) => r.name === current.name);
      update(saved?.photo?.tags ?? {});
    }
  })).current;

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

  const place = (key: string, at = { x: 0.5, y: 0.5 }) => {
    const previous: PhotoSpot = spotsRef.current[key] ?? { x: 0.5, y: 0.5, rotation: 0, scale: 1 };
    update({ ...spotsRef.current, [key]: { ...previous, ...at } });
    setSelected(key);
    void save();
  };

  const setHeight = async (lightId: string, preset: HeightPreset) => {
    const placement = room.lights.find((l) => l.light_id === lightId);
    if (!placement) return;
    const value = heightPreset(preset, room, placement);
    if (preset === 'desk' && value === null) return useStore.getState().toast('Add a desk on the plan first.');
    const ok = await attempt(() => api.placeLight(room.name, {
      light_id: placement.light_id, x: placement.x, y: placement.y, elevation: value === null ? 'auto' : value,
    }));
    if (ok) await refreshRooms();
  };

  if (!room.photo) {
    return (
      <div
        className="stage photo-empty"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void uploadFile(e.dataTransfer.files[0]); }}
      >
        <Empty icon={<ImagePlus size={40} strokeWidth={1.2} />} title="Add a photo of this room">
          <p>Take a wide photo of the room, then tag each light, the desk, monitors, and windows where they really are. JPEG, PNG, or WebP up to {MAX_MB} MB. Location data in the photo is removed.</p>
          <button type="button" className="button primary" disabled={uploading} onClick={() => input.current?.click()}>
            <Upload size={16} /> {uploading ? 'Uploading…' : 'Choose a photo'}
          </button>
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
        </Empty>
      </div>
    );
  }

  const items: Record<TagKind, Item[]> = {
    light: room.lights.map((l) => ({ key: tagKey('light', l.light_id), kind: 'light', label: lights[l.light_id]?.name ?? l.label,
      icon: placedProfile(l, lights[l.light_id], profiles).icon })),
    furniture: room.furniture.map((f) => ({ key: tagKey('furniture', f.id), kind: 'furniture', label: f.label })),
    opening: room.openings.map((o, i) => ({ key: tagKey('opening', o.id), kind: 'opening',
      label: `${o.kind === 'window' ? 'Window' : 'Door'} ${i + 1} · ${formatLength(o.width, room.units)}` })),
  };
  const labelFor = (key: string) => Object.values(items).flat().find((item) => item.key === key)?.label ?? key;
  const untagged = (kind: TagKind) => items[kind].filter((item) => !spots[item.key]);
  const selectedSpot = selected ? spots[selected] : undefined;
  const selectedTag = selected ? parseTag(selected) : null;
  const selectedLight = selectedTag?.kind === 'light' ? room.lights.find((l) => l.light_id === selectedTag.id) : undefined;
  const size = { width: room.photo.width, height: room.photo.height };
  const blobs = shown ? glowLayout(shown.preview, spots, size) : [];

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
            const lightId = e.dataTransfer.getData('application/x-myhuey-light');
            const key = e.dataTransfer.getData('application/x-myhuey-tag')
              || (lightId && room.lights.some((l) => l.light_id === lightId) ? tagKey('light', lightId) : '');
            if (key) place(key, position(e.clientX, e.clientY));
            else if (lightId) useStore.getState().toast('Place that light on the plan first, then tag it on the photo.');
          }}
        >
          <img src={api.imageUrl(room.photo.file)} alt={`Photo of ${room.name}`} draggable={false} />
          {shown && (
            // Two layers: a multiply layer darkens the photo to the scene's level, then a screen
            // layer adds light, the way light adds up on a real wall.
            <svg className="photo-glow dim" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
              <rect width={size.width} height={size.height} fill="#000" opacity={darkness(shown.preview)} />
            </svg>
          )}
          {shown && (
            <svg className="photo-glow light" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                {blobs.map((blob) => (
                  <radialGradient key={blob.key} id={`glow-${blob.key}`}>
                    <stop offset="0%" stopColor={blob.color} stopOpacity={blob.opacity} />
                    <stop offset="35%" stopColor={blob.color} stopOpacity={blob.opacity * 0.55} />
                    <stop offset="100%" stopColor={blob.color} stopOpacity={0} />
                  </radialGradient>
                ))}
              </defs>
              {blobs.map((blob) => <circle key={blob.key} cx={blob.cx} cy={blob.cy} r={blob.r * 2.4} fill={`url(#glow-${blob.key})`} />)}
            </svg>
          )}
          {Object.entries(spots).map(([key, spot]) => {
            const tag = parseTag(key);
            if (!tag) return null;
            const label = labelFor(key);
            const drag = (event: React.PointerEvent) => {
              event.preventDefault();
              setSelected(key);
              let moved = false;
              const move = (e: PointerEvent) => {
                moved = true;
                update({ ...spotsRef.current, [key]: { ...spotsRef.current[key], ...position(e.clientX, e.clientY) } });
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (moved) void save();
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            };
            const keys = (event: React.KeyboardEvent) => {
              const moved = nudge(spotsRef.current[key], event.key, event.shiftKey);
              if (!moved) return;
              event.preventDefault();
              update({ ...spotsRef.current, [key]: moved });
              void save();
            };
            const select = () => setSelected(key);
            if (tag.kind !== 'light') {
              return (
                <button key={key} type="button" className={`photo-pin ${tag.kind}${selected === key ? ' active' : ''}`}
                  style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} title={label}
                  aria-label={`${label} on the photo. Drag or use the arrow keys to move.`} aria-pressed={selected === key}
                  onPointerDown={drag} onClick={select} onKeyDown={keys}>
                  <MapPin size={16} /><span className="marker-label">{label}</span>
                </button>
              );
            }
            const placement = room.lights.find((l) => l.light_id === tag.id);
            if (!placement) return null;
            const bridge = lights[tag.id];
            const profile = placedProfile(placement, bridge, profiles);
            const color = liveColor(bridge);
            const role = shown?.roles[tag.id];
            return (
              <button
                key={key}
                type="button"
                className={`photo-marker${selected === key ? ' active' : ''}${color && !shown ? ' lit' : ''}${shown ? ' quiet' : ''}`}
                style={{
                  left: `${spot.x * 100}%`, top: `${spot.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${spot.rotation}deg) scale(${spot.scale})`,
                  color: color ?? '#8d88a8', ['--glow' as string]: color ?? 'transparent',
                }}
                title={label}
                aria-label={`${label} on the photo. Drag or use the arrow keys to move.`}
                aria-pressed={selected === key}
                onPointerDown={drag}
                onClick={select}
                onKeyDown={keys}
              >
                <HueIcon name={profile.icon} size={34} />
                <span className="marker-label">{label}{role && role !== 'ambient' ? <em className={`role-badge ${role}`}>{role}</em> : null}</span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="inspector">
        <div className="button-row">
          <button type="button" className={`button${suggesting ? ' active' : ''}`} aria-pressed={suggesting}
            onClick={() => { setSuggesting(!suggesting); if (suggesting) setShown(null); }}>
            <Sparkles size={15} /> Suggest
          </button>
          {shown && <button type="button" className="button subtle" onClick={() => setShown(null)}>Show live colors</button>}
        </div>
        {suggesting && (
          <SuggestPanel room={room} onClose={() => { setSuggesting(false); setShown(null); }}
            shownId={shown?.scene.id} onShow={(item) => setShown(item && shown?.scene.id === item.scene.id ? null : item)} />
        )}
        {shown && (
          <p className="hint">Showing “{shown.scene.name}” on the photo. Badges mark lights near your eyes and screen: <strong>view</strong> and <strong>behind</strong> are glare and reflection risks, kept dim and near white.</p>
        )}
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
            <p className="hint">{labelFor(selected)}</p>
            {selectedLight && lights[selectedLight.light_id] && <LightControls light={lights[selectedLight.light_id]} />}
            {selectedLight && (
              <div className="height-presets">
                <span className="field-label">Height: {selectedLight.elevation == null ? 'auto, ' : ''}{formatLength(selectedLight.elevation ?? selectedLight.resolved_elevation ?? 0, room.units)}</span>
                <div className="chip-list">
                  {PRESETS.map((preset) => (
                    <button key={preset.value} type="button" className="pill" onClick={() => void setHeight(selectedLight.light_id, preset.value)}>{preset.label}</button>
                  ))}
                </div>
              </div>
            )}
            {selectedTag?.kind === 'light' && (
              <>
                <Slider label="Marker size" value={selectedSpot.scale} min={0.4} max={4} step={0.1} format={(v) => `${v.toFixed(1)}×`}
                  onChange={(scale) => update({ ...spotsRef.current, [selected]: { ...selectedSpot, scale } })} onCommit={() => save()} />
                <Slider label="Rotation" value={selectedSpot.rotation} min={0} max={359} format={(v) => `${Math.round(v)}°`}
                  onChange={(rotation) => update({ ...spotsRef.current, [selected]: { ...selectedSpot, rotation } })} onCommit={() => save()} />
              </>
            )}
          </Panel>
        )}
        <Panel title="On the plan, not on the photo">
          {(['light', 'furniture', 'opening'] as TagKind[]).map((kind) => {
            const left = untagged(kind);
            if (!left.length) return null;
            return (
              <div key={kind} className="tray-group">
                <h3 className="pref-group">{kind === 'light' ? 'Lights' : kind === 'furniture' ? 'Furniture' : 'Windows & doors'}</h3>
                <ul className="tray">
                  {left.map((item) => (
                    <li key={item.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-myhuey-tag', item.key)}>
                      {item.icon ? <HueIcon name={item.icon} size={20} /> : <MapPin size={18} />}
                      <span>{item.label}<small>Drag onto the photo</small></span>
                      <IconButton label="Place in the middle" onClick={() => place(item.key)}><Plus size={16} /></IconButton>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!untagged('light').length && !untagged('furniture').length && !untagged('opening').length && (
            <p className="hint">{room.lights.length || room.furniture.length ? 'Everything on the plan is tagged on the photo.' : 'Add lights and furniture on the plan first.'}</p>
          )}
          <p className="hint">Not on the plan yet? <a href={`#/room/${encodeURIComponent(room.name)}`}>Add it on the plan</a> first, then tag it here.</p>
        </Panel>
        <Panel title="Photo">
          <div className="button-row">
            <button type="button" className="button" onClick={() => input.current?.click()} disabled={uploading}><Upload size={14} /> Replace</button>
            <button type="button" className="button danger subtle" onClick={async () => {
              if (!confirm('Remove this photo? Tags on it are removed too.')) return;
              if (await attempt(() => api.deletePhoto(room.name))) replaceRoom(room.name, { ...room, photo: null });
            }}><Trash2 size={14} /> Remove</button>
          </div>
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
          <p className="hint">{room.photo.width} × {room.photo.height} px. Replacing the photo keeps the tags.</p>
        </Panel>
      </aside>
    </div>
  );
}
