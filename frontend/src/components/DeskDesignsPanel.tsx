// Desk designs from the library, to place in this room as a locked desk set.
import { useEffect, useState } from 'react';
import { LampDesk } from 'lucide-react';
import { api } from '../api';
import { attempt } from '../store';
import type { DeskDesign, Room } from '../types';
import { bounds } from '../lib/geometry';
import { Panel } from './ui';

export function DeskDesignsPanel({ room, onPlaced }: { room: Room; onPlaced: (next: Room, set: string) => void }) {
  const [designs, setDesigns] = useState<DeskDesign[] | null>(null);
  useEffect(() => {
    let live = true;
    api.desks().then((list) => live && setDesigns(list)).catch(() => live && setDesigns([]));
    return () => { live = false; };
  }, []);
  const place = async (design: DeskDesign) => {
    const box = bounds(room.outline);
    const out = await attempt(() => api.placeDesk(room.name, {
      design: design.id, x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2), rotation: 0,
    }));
    if (out) onPlaced(out.room, out.set);
  };
  return (
    <Panel title={<><LampDesk size={16} strokeWidth={1.5} /> Desk sets</>}>
      {designs === null ? <p className="hint">Loading desk designs…</p> : designs.length ? (
        <div className="catalog">
          {designs.map((design) => (
            <button key={design.id} type="button" className="catalog-item" aria-label={`Place ${design.name}`} onClick={() => place(design)}>{design.name}</button>
          ))}
        </div>
      ) : <p className="hint">No desk designs yet.</p>}
      <p className="hint"><a href="#/studio/desks">Open the desk designer</a> to make one. A placed set moves as one piece.</p>
    </Panel>
  );
}
