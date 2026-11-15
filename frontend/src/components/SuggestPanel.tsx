import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, Palette as PaletteIcon, Save, Shuffle, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { bounds } from '../lib/geometry';
import { MODE_LABELS, cardTitle, creditText, latestOnly, lightFill, quarterHours } from '../lib/suggest';
import { Field, IconButton, Panel, Segmented, TextInput } from './ui';
import type { PaletteEntry, Room, Suggestion } from '../types';

const MODES = Object.keys(MODE_LABELS);
const TAGS = ['', 'warm', 'cool', 'muted', 'vivid', 'analogous', 'accent'];

/** Suggested scenes for a room: pick a mode and a time, preview cards, then save or try one. */
export function SuggestPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { refreshScenes, toast } = useStore();
  const [mode, setMode] = useState('code');
  const [at, setAt] = useState(''); // '' = now
  const [seed, setSeed] = useState(0);
  const [paletteId, setPaletteId] = useState<string | undefined>();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [browsing, setBrowsing] = useState(false);

  const requests = useRef(latestOnly());
  const load = useCallback(async () => {
    const token = requests.current.next();
    setLoading(true);
    setError('');
    try {
      const found = await api.suggest(room.name, { mode, at: at || undefined, palette_id: paletteId, count: paletteId ? 1 : 4, seed });
      if (requests.current.isLatest(token)) setItems(found);
    } catch (e) {
      if (requests.current.isLatest(token)) setError((e as Error).message);
    }
    if (requests.current.isLatest(token)) setLoading(false);
  }, [room.name, mode, at, paletteId, seed]);

  // Layout changes (lights moved, heights set) change the suggestions too.
  const layoutKey = JSON.stringify([room.lights, room.furniture]);
  useEffect(() => { void load(); }, [load, layoutKey]);

  const times = useMemo(quarterHours, []);
  return (
    <Panel className="suggest-panel" title={<><Sparkles size={16} /> Suggested scenes</>}
      actions={<IconButton label="Close suggestions" onClick={onClose}><X size={16} /></IconButton>}>
      <Segmented label="Mode" value={mode} onChange={(next) => { setMode(next); setSeed(0); }}
        options={MODES.map((value) => ({ value, label: MODE_LABELS[value] }))} />
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
        </div>
      </div>
      {paletteId && (
        <p className="hint">Using one palette. <button type="button" className="link-button" onClick={() => setPaletteId(undefined)}>Let myhuey pick</button></p>
      )}
      {browsing && <PaletteBrowser onPick={(id) => { setPaletteId(id); setBrowsing(false); }} />}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!room.lights.length && <p className="hint">Place lights in this room first; suggestions color the lights where they sit.</p>}
      <div className="suggest-cards" aria-busy={loading}>
        {items.map((item) => (
          <SuggestionCard key={`${item.palette.id}-${seed}`} room={room} item={item} mode={mode}
            onSaved={async (name) => {
              try {
                const saved = await api.createScene({ ...item.scene, name });
                await refreshScenes();
                toast(`Saved “${saved.name}”.`, false);
              } catch (e) {
                toast((e as Error).message);
              }
            }}
            onTry={async () => {
              try {
                const { results } = await api.applySuggestion(room.name, item.scene);
                const failed = results.filter((r) => r.error);
                toast(failed.length ? `${failed.length} lights did not change: ${failed[0].error}` : `Showing “${item.scene.name}” on the lights.`, !!failed.length);
              } catch (e) {
                toast((e as Error).message);
              }
            }} />
        ))}
      </div>
      <p className="hint">Lights by the desk and screen stay near white at the time of day; the palette colors the rest of the room. Your wake time and bedtime are in Settings.</p>
    </Panel>
  );
}

function SuggestionCard({ room, item, mode, onSaved, onTry }: {
  room: Room; item: Suggestion; mode: string; onSaved: (name: string) => void; onTry: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(cardTitle(mode, item.palette));
  useEffect(() => setName(cardTitle(mode, item.palette)), [mode, item.palette]);
  const credit = creditText(item.palette);
  return (
    <article className="suggest-card">
      <MiniRoom room={room} item={item} />
      <div className="suggest-body">
        <h3>{cardTitle(mode, item.palette)}</h3>
        <div className="palette-strip" aria-label="Palette colors">
          {item.palette.colors.map((color) => <span key={color} style={{ background: color }} title={color} />)}
        </div>
        <p className="hint">{item.kelvin} K white{credit ? ` · ${credit}` : ''}</p>
        {naming ? (
          <form className="button-row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSaved(name.trim()); setNaming(false); } }}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Scene name" autoFocus />
            <button type="submit" className="button small primary">Save</button>
            <button type="button" className="button small subtle" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <div className="button-row">
            <button type="button" className="button small" onClick={onTry}><Lightbulb size={14} /> Preview on lights</button>
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
