import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Lightbulb, Palette as PaletteIcon, Save, Shuffle, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { bounds } from '../lib/geometry';
import { glareLimits, glareModeFor } from '../lib/glareLimits';
import { roomGlare } from '../lib/roomGlare';
import { MODE_LABELS, cardTitle, creditText, latestOnly, lightFill, quarterHours } from '../lib/suggest';
import { clearTry, loadTry, saveTry, type TryRecord } from '../lib/tryLook';
import { Field, IconButton, Panel, Segmented, TextInput } from './ui';
import type { PaletteEntry, Room, Suggestion } from '../types';

const MODES = Object.keys(MODE_LABELS);
const TAGS = ['', 'warm', 'cool', 'muted', 'vivid', 'analogous', 'accent'];

const clock = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Lights a room from where you are: presets that explain themselves, shown before they are tried, tried with Keep and Undo. */
export function RoomLighting({ room, onClose, onShow, shownId }: {
  room: Room;
  /** Left out where the panel always shows (the workbench). */
  onClose?: () => void;
  /** On the photo: show a card's colors there. */
  onShow?: (item: Suggestion) => void; shownId?: string;
}) {
  const { refreshScenes, toast, lights, profiles, layout, layouts } = useStore();
  const posture = useUi((state) => state.posture);
  const showing = useUi((state) => state.showing);
  const setShowing = useUi((state) => state.setShowing);
  const [mode, setMode] = useState('code');
  const [at, setAt] = useState(''); // '' = now
  const [seed, setSeed] = useState(0);
  const [paletteId, setPaletteId] = useState<string | undefined>();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); // the suggestion request
  const [actionError, setActionError] = useState(''); // Try or Undo
  const [notice, setNotice] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [record, setRecord] = useState<TryRecord | null>(() => loadTry(room.name));
  const [trying, setTrying] = useState(false);
  /** True once a try was pressed in this visit; a record found on mount reads as an earlier try. */
  const [live, setLive] = useState(false);

  // What is shown belongs to the room it was shown for: leaving the room or the panel drops it.
  const roomRef = useRef(room.name);
  roomRef.current = room.name;
  const dropShowing = (name: string) => {
    const now = useUi.getState().showing;
    if (now && now.room === name) useUi.getState().setShowing(null);
  };
  useEffect(() => () => dropShowing(roomRef.current), []);
  useEffect(() => { const name = room.name; return () => dropShowing(name); }, [room.name]);
  useEffect(() => { setRecord(loadTry(room.name)); setNotice(''); setActionError(''); setLive(false); }, [room.name]);

  // The glare check for the desk presets, judged from the room as it is now; part of the request key.
  const glare = useMemo(() => {
    const glareMode = glareModeFor(mode);
    if (!glareMode) return undefined;
    const { scene, report } = roomGlare(room, posture, glareMode, lights, profiles);
    return glareLimits(report, !!scene.eye);
  }, [room, posture, mode, lights, profiles]);
  const glareKey = JSON.stringify(glare ?? null);

  const requests = useRef(latestOnly());
  const load = useCallback(async () => {
    const token = requests.current.next();
    setLoading(true);
    setError('');
    try {
      const body = { mode, at: at || undefined, palette_id: paletteId, count: paletteId ? 1 : 4, seed, ...(glare ? { glare } : {}) };
      const found = await api.suggest(room.name, body);
      if (requests.current.isLatest(token)) setItems(found);
    } catch (e) {
      if (requests.current.isLatest(token)) setError((e as Error).message);
    }
    if (requests.current.isLatest(token)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.name, mode, at, paletteId, seed, glareKey]);

  // Layout changes (lights moved, heights set) change the suggestions too.
  const layoutKey = JSON.stringify([room.lights, room.furniture]);
  useEffect(() => { void load(); }, [load, layoutKey]);

  const times = useMemo(quarterHours, []);
  const sandbox = layout ? layouts.find((entry) => entry.id === layout)?.name ?? layout : null;
  const mine = showing && showing.room === room.name ? showing : null;

  async function tryOn(item: Suggestion, title: string) {
    if (trying) return;
    setTrying(true);
    setActionError('');
    setNotice('');
    try {
      let current = record;
      if (!current) {
        // The first try captures how the room was; a second one keeps that look so Undo goes back past both.
        const captured = await api.captureLook(room.name);
        current = { at: Date.now(), look: captured.look, skipped: captured.skipped, title, layout, capturedAt: captured.at };
      } else {
        current = { ...current, title };
      }
      saveTry(room.name, current);
      setRecord(current);
      setLive(true);
      const { results } = await api.applySuggestion(room.name, item.scene);
      const failed = results.filter((r) => r.error);
      if (failed.length) toast(`${failed.length} lights did not change: ${failed[0].error}`, true);
    } catch (e) {
      setActionError((e as Error).message);
    }
    setTrying(false);
  }

  async function undo() {
    if (!record) return;
    try {
      setActionError('');
      const { results, failed } = await api.applyLook(room.name, record.look);
      if (failed > 0) {
        const first = results.find((r) => !r.ok);
        setActionError(`${failed} lights did not go back: ${first?.error ?? 'no answer'}`);
        return;
      }
      clearTry(room.name);
      setNotice(`Put back how ${room.name} was at ${record.capturedAt}.`);
      setRecord(null);
      setLive(false);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  function keep() {
    clearTry(room.name);
    setRecord(null);
    setLive(false);
    setNotice('');
  }

  const firstTime = items[0]?.guide?.time;
  return (
    <Panel className="suggest-panel" title={<><Sparkles size={16} /> Light this room</>}
      actions={onClose && <IconButton label="Close suggestions" onClick={onClose}><X size={16} /></IconButton>}>
      {record && (
        <div className="try-bar" role="status">
          <span>
            {live
              ? `Trying ${record.title} on ${room.name}`
              : `You tried a scene on ${room.name} at ${clock(record.at)}`}
            {record.layout && sandbox && ` (as drawn in sandbox ${sandbox})`}
            {record.skipped.length > 0 && ` · ${record.skipped.length} planned lights skipped`}
          </span>
          <button type="button" className="button small" onClick={keep}>Keep</button>
          <button type="button" className="button small subtle" onClick={() => void undo()}>Undo</button>
        </div>
      )}
      {notice && <p className="hint" role="status">{notice}</p>}
      <Segmented label="Mode" value={mode} onChange={(next) => { setMode(next); setSeed(0); }}
        options={MODES.map((value) => ({ value, label: MODE_LABELS[value] }))} />
      {firstTime && <p className="hint" data-testid="lighting-time">{firstTime}</p>}
      <div className="field-row">
        <Field label="Time">
          <select className="input" value={at} onChange={(e) => setAt(e.target.value)}>
            <option value="">Now</option>
            {times.map((time) => <option key={time} value={time}>{time}</option>)}
          </select>
        </Field>
        <div className="button-row suggest-actions">
          <button type="button" className="button subtle" onClick={() => setSeed(seed + 1)} disabled={loading}><Shuffle size={14} /> Shuffle</button>
          <button type="button" className={`button subtle${browsing ? ' active' : ''}`} onClick={() => setBrowsing(!browsing)}><PaletteIcon size={14} /> Palettes</button>
          {mine && <button type="button" className="button small" onClick={() => { setShowing(null); }}>Show live</button>}
        </div>
      </div>
      {paletteId && (
        <p className="hint">Using one palette. <button type="button" className="link-button" onClick={() => setPaletteId(undefined)}>Let myhuey pick</button></p>
      )}
      {browsing && <PaletteBrowser onPick={(id) => { setPaletteId(id); setBrowsing(false); }} />}
      {error && <p className="error-text" role="alert">{error}</p>}
      {actionError && <p className="error-text" role="alert">{actionError}</p>}
      {!room.lights.length && <p className="hint">Place lights in this room first; suggestions color the lights where they sit.</p>}
      <div className="suggest-cards" aria-busy={loading}>
        {items.map((item) => {
          const title = cardTitle(mode, item.palette);
          const shown = onShow && shownId ? shownId === item.scene.id : mine?.id === item.scene.id;
          return (
            <SuggestionCard key={`${item.palette.id}-${seed}`} room={room} item={item} mode={mode} shown={!!shown} photo={!!onShow}
              onShow={() => {
                setShowing(mine?.id === item.scene.id ? null : { room: room.name, id: item.scene.id, title, results: item.preview });
                onShow?.(item);
              }}
              onSaved={async (name) => {
                try {
                  const saved = await api.createScene({ ...item.scene, name });
                  await refreshScenes();
                  toast(`Saved “${saved.name}”.`, false);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
              onTry={() => void tryOn(item, title)} />
          );
        })}
      </div>
      <p className="hint">Lights by the desk and screen stay near white at the time of day; the palette colors the rest of the room. Your wake time and bedtime are in Settings.</p>
    </Panel>
  );
}

function SuggestionCard({ room, item, mode, onSaved, onTry, onShow, shown, photo }: {
  room: Room; item: Suggestion; mode: string; onSaved: (name: string) => void; onTry: () => void;
  onShow: () => void; shown: boolean; photo: boolean;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(cardTitle(mode, item.palette));
  useEffect(() => setName(cardTitle(mode, item.palette)), [mode, item.palette]);
  const credit = creditText(item.palette);
  return (
    <article className={`suggest-card${shown ? ' shown' : ''}`}>
      <MiniRoom room={room} item={item} />
      <div className="suggest-body">
        <h3>{cardTitle(mode, item.palette)}</h3>
        <div className="palette-strip" aria-label="Palette colors">
          {item.palette.colors.map((color) => <span key={color} style={{ background: color }} title={color} />)}
        </div>
        <p className="hint">{item.kelvin} K white{credit ? ` · ${credit}` : ''}</p>
        {item.guide && (
          <>
            <p className="hint guide-line">{item.guide.time}</p>
            {item.guide.glare.map((line) => <p key={line} className="hint guide-line">{line}</p>)}
          </>
        )}
        {naming ? (
          <form className="button-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSaved(name.trim()); setNaming(false); } }}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Scene name" autoFocus />
            <button type="submit" className="button small primary">Save</button>
            <button type="button" className="button small subtle" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <div className="button-row">
            <button type="button" className={`button small${shown ? ' active' : ''}`} aria-pressed={shown} onClick={onShow}>
              <Eye size={14} /> {photo ? (shown ? 'On the photo' : 'Show on photo') : (shown ? 'Showing' : 'Show')}
            </button>
            <button type="button" className="button small" onClick={onTry}><Lightbulb size={14} /> Try on lights</button>
            <button type="button" className="button small subtle" onClick={() => setNaming(true)}><Save size={14} /> Save as scene</button>
          </div>
        )}
      </div>
    </article>
  );
}

/** The room from above with each light filled in the color the suggestion gives it. */
function MiniRoom({ room, item }: { room: Room; item: Suggestion }) {
  const box = bounds(room.outline);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const pad = span * 0.06;
  const radius = span / 28;
  const byId = Object.fromEntries(item.preview.map((result) => [result.light_id, result]));
  return (
    <svg className="mini-room" viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`} role="img"
      aria-label={`${room.name} with the suggested colors`}>
      <polygon points={room.outline.map((p) => p.join(',')).join(' ')} className="mini-outline" strokeWidth={span / 150} />
      {room.furniture.map((f) => (
        <rect key={f.id} x={f.x - f.width / 2} y={f.y - f.depth / 2} width={f.width} height={f.depth} className="mini-furniture"
          transform={`rotate(${f.rotation} ${f.x} ${f.y})`} />
      ))}
      {room.lights.map((light) => {
        const result = byId[light.light_id];
        if (!result) return null;
        const colors = result.on && result.gradient ? result.gradient : null;
        const { fill, opacity } = lightFill(result);
        return (
          <g key={light.light_id}>
            {colors ? colors.map((color, index) => (
              <circle key={index} cx={light.x + (index - (colors.length - 1) / 2) * radius * 1.1} cy={light.y} r={radius * 0.6} fill={color} opacity={opacity} />
            )) : <circle cx={light.x} cy={light.y} r={radius} fill={fill} opacity={opacity} />}
            <title>{`${result.label} · ${item.roles[light.light_id] ?? ''} · ${result.on ? `${result.color_temp ? `${result.color_temp} K` : result.color} ${Math.round(result.brightness)}%` : 'off'}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function PaletteBrowser({ onPick }: { onPick: (id: string) => void }) {
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [palettes, setPalettes] = useState<PaletteEntry[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      api.palettes({ tag: tag || undefined, q: query || undefined, limit: 40 }).then(setPalettes).catch(() => setPalettes([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [tag, query]);
  return (
    <div className="palette-browser">
      <div className="field-row">
        <Field label="Search"><TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name" /></Field>
        <Field label="Tag">
          <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
            {TAGS.map((value) => <option key={value} value={value}>{value || 'Any'}</option>)}
          </select>
        </Field>
      </div>
      <ul className="palette-list">
        {palettes.map((palette) => (
          <li key={palette.id}>
            <button type="button" className="palette-row" onClick={() => onPick(palette.id)} title={creditText(palette) || palette.name}>
              <span className="palette-strip">{palette.colors.map((color) => <span key={color} style={{ background: color }} />)}</span>
              <span className="palette-name">{palette.name}</span>
            </button>
          </li>
        ))}
        {!palettes.length && <li className="hint">No palettes match.</li>}
      </ul>
    </div>
  );
}
