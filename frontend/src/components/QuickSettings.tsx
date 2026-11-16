// The ⋮ menu on a home-screen room tile: eye-comfort suggestions for right now and the room's
// saved scenes, one tap to apply. Everything here acts on the Active layout, never a sandbox.
import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisVertical, Lightbulb, Map as MapIcon } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { href } from '../lib/router';
import { MODE_LABELS, cardTitle, latestOnly, readQuickMode, storeQuickMode } from '../lib/suggest';
import type { Room, Scene, Suggestion } from '../types';

export function QuickSettings({ room }: { room: Room }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(readQuickMode);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const requests = useRef(latestOnly());
  const hasLights = room.lights.length > 0;

  const load = useCallback(async () => {
    const token = requests.current.next();
    setLoading(true);
    setError('');
    try {
      const [found, all] = await Promise.all([
        hasLights ? api.suggest(room.name, { mode, count: 3 }, true) : Promise.resolve([] as Suggestion[]),
        api.scenes(true),
      ]);
      if (!requests.current.isLatest(token)) return;
      setItems(found);
      setScenes(all.filter((scene) => scene.room === room.name));
    } catch (e) {
      if (requests.current.isLatest(token)) setError((e as Error).message);
    }
    if (requests.current.isLatest(token)) setLoading(false);
  }, [room.name, mode, hasLights]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  // Escape or a press outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const done = (label: string, failed: number, firstError?: string) => {
    setOpen(false);
    useStore.getState().toast(failed ? `${failed} light(s) in ${room.name} did not change${firstError ? `: ${firstError}` : ''}` : `${label} is on in ${room.name}.`, failed > 0);
    void useStore.getState().refreshLights();
  };

  const applySuggestion = async (item: Suggestion) => {
    try {
      const { results } = await api.applySuggestion(room.name, item.scene, true);
      const failed = results.filter((r) => r.error);
      done(cardTitle(mode, item.palette), failed.length, failed[0]?.error);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applyScene = async (scene: Scene) => {
    try {
      const { failed } = await api.applyScene(scene.id, true);
      done(`“${scene.name}”`, failed);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="quick" ref={box} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <button type="button" className="quick-trigger" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Quick settings for ${room.name}`} title="Quick settings" onClick={() => setOpen(!open)}>
        <EllipsisVertical size={16} />
      </button>
      {open && (
        <div className="quick-menu" role="menu" aria-label={`Quick settings for ${room.name}`}>
          <p className="quick-heading">Right now</p>
          <div className="quick-modes" role="group" aria-label="What you're doing">
            {Object.entries(MODE_LABELS).map(([value, label]) => (
              <button key={value} type="button" className={`quick-mode${mode === value ? ' active' : ''}`} aria-pressed={mode === value}
                onClick={() => { setMode(value); storeQuickMode(value); }}>{label}</button>
            ))}
          </div>
          {!hasLights && <p className="hint">Place lights in this room in the Studio first.</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          <ul className="quick-list" aria-busy={loading}>
            {items.map((item) => (
              <li key={item.palette.id}>
                <button type="button" role="menuitem" className="quick-item" onClick={() => void applySuggestion(item)}>
                  <span className="chip-row">{item.palette.colors.slice(0, 5).map((color) => <span key={color} className="chip-dot" style={{ background: color }} />)}</span>
                  <span className="quick-label">{item.palette.name}<small>{item.kelvin} K white near the desk</small></span>
                </button>
              </li>
            ))}
            {hasLights && !loading && !items.length && !error && <li className="hint">No suggestions for this room yet.</li>}
          </ul>
          {scenes.length > 0 && (
            <>
              <p className="quick-heading">Your scenes</p>
              <ul className="quick-list">
                {scenes.map((scene) => (
                  <li key={scene.id}>
                    <button type="button" role="menuitem" className="quick-item" onClick={() => void applyScene(scene)}>
                      <span className="quick-label">{scene.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="quick-footer">
            <a href={href({ view: 'room', room: room.name })}><Lightbulb size={14} /> Open workbench</a>
            <a href={href({ view: 'design', room: room.name, tab: 'plan' })}><MapIcon size={14} /> Design in Studio</a>
          </div>
        </div>
      )}
    </div>
  );
}
