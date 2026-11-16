// Saved layouts on the floor plan screen: open, duplicate, rename, delete, or start fresh.
import { useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';
import type { LayoutSummary } from '../types';
import { IconButton, Panel, TextInput } from './ui';

export function LayoutsPanel() {
  const { layout, layouts, openLayout, refreshLayouts } = useStore();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const isOpen = (item: LayoutSummary) => (item.active ? layout === null : layout === item.id);

  const startFresh = async () => {
    const created = await attempt(() => api.createLayout(), 'Started a fresh sandbox. Your active layout is untouched.');
    if (created) await openLayout(created.id);
  };
  const duplicate = async (item: LayoutSummary) => {
    const created = await attempt(() => api.createLayout(`${item.name} copy`.slice(0, 60), item.id).catch(() => api.createLayout(undefined, item.id)),
      `Copied ${item.name} into a sandbox.`);
    if (created) await openLayout(created.id);
  };
  const rename = async () => {
    if (!renaming) return;
    if (await attempt(() => api.renameLayout(renaming.id, renaming.name))) {
      setRenaming(null);
      await refreshLayouts();
    }
  };
  const remove = async (item: LayoutSummary) => {
    setDeleting(null);
    if (!(await attempt(() => api.deleteLayout(item.id), `Deleted ${item.name}.`))) return;
    if (layout === item.id) await openLayout(null);
    else await refreshLayouts();
  };

  return (
    <Panel title="Layouts" actions={<IconButton label="Start fresh" onClick={startFresh}><Plus size={16} /></IconButton>}>
      <ul className="layout-list">
        {layouts.map((item) => (
          <li key={item.id} className={`layout-row${isOpen(item) ? ' open' : ''}`}>
            {renaming?.id === item.id ? (
              <form className="layout-rename" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
                <TextInput autoFocus value={renaming.name} maxLength={60} aria-label="Layout name"
                  onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                  onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)} />
                <button type="submit" className="button subtle" disabled={!renaming.name.trim()}>Save</button>
              </form>
            ) : (
              <div className="layout-name">
                <span>{item.name}</span>
                {item.active && <span className="badge">Active</span>}
                <small>{item.rooms} rooms · {item.scenes} scenes</small>
              </div>
            )}
            {deleting === item.id ? (
              <div className="button-row">
                <span className="hint">Delete?</span>
                <button type="button" className="button danger subtle" onClick={() => remove(item)}>Yes</button>
                <button type="button" className="button subtle" onClick={() => setDeleting(null)}>No</button>
              </div>
            ) : (
              <div className="button-row">
                {!isOpen(item) && (
                  <button type="button" className="button subtle" onClick={() => openLayout(item.active ? null : item.id)}>Open</button>
                )}
                <IconButton label={`Duplicate ${item.name}`} onClick={() => duplicate(item)}><Copy size={14} /></IconButton>
                <IconButton label={`Rename ${item.name}`} onClick={() => setRenaming({ id: item.id, name: item.name })}><Pencil size={14} /></IconButton>
                {!item.active && (
                  <IconButton label={`Delete ${item.name}`} danger onClick={() => setDeleting(item.id)}><Trash2 size={14} /></IconButton>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="button" onClick={startFresh}><Plus size={14} /> Start fresh</button>
      <p className="hint">Sandboxes can preview on your lights. The home screen always shows the active layout.</p>
    </Panel>
  );
}
