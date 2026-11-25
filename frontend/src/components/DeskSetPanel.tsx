// The panel a desk set's member shows instead of its size and place: the set is edited as one,
// in the desk designer, and moves as one on the plan and in 3D.
import { api } from '../api';
import { attempt, useStore } from '../store';
import type { DeskSet, Room } from '../types';

export function DeskSetPanel({ room, set, onRoom }: { room: string; set: DeskSet; onRoom: (next: Room) => void }) {
  const toast = useStore((state) => state.toast);
  const saveAsDesign = async () => {
    const name = prompt('Name the new desk design', `${set.name} copy`)?.trim();
    if (!name) return;
    const out = await attempt(() => api.deskFromSet(room, set.id, name));
    if (out) toast(out.skipped.length ? `Saved "${out.design.name}". Left out (no catalog match): ${out.skipped.join(', ')}.` : `Saved "${out.design.name}".`);
  };
  const release = async () => {
    const next = await attempt(() => api.releaseDeskSet(room, set.id));
    if (next) onRoom(next);
  };
  return (
    <div className="desk-set-panel">
      <p className="hint">Part of {set.name}: it moves with the set. Change its pieces in the desk designer.</p>
      <div className="button-row">
        <a className="button" href={`#/studio/room/${encodeURIComponent(room)}/set/${encodeURIComponent(set.id)}`}>Edit in desk designer</a>
        <button type="button" className="button" onClick={saveAsDesign}>Save as design</button>
        <button type="button" className="button" onClick={release} title="Unlock the set: its pieces stay where they are">Release</button>
      </div>
    </div>
  );
}
