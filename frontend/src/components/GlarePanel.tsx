import { ShieldCheck } from 'lucide-react';
import { sendLight, useStore } from '../store';
import { formatLength } from '../lib/units';
import { STATUS_LABELS, capText, dimTo, statusTone, summary, type GlareReport } from '../lib/glareMath';
import { heightOf } from '../lib/rig';
import { MODE_LABELS } from '../lib/suggest';
import type { Room } from '../types';
import { Panel, Segmented } from './ui';

/** Desk modes only: the check is made from the desk seat. */
export const GLARE_MODES = ['code', 'work', 'study'];

/** The glare check for a room: every light that is not clear, why, and a way to dim the ones over their limit. */
export function GlarePanel({ room, report, hasSeat, mode, onMode, selectedId, onSelect }: {
  room: Room; report: GlareReport; hasSeat: boolean; mode: string; onMode: (mode: string) => void;
  selectedId?: string; onSelect: (lightId: string) => void;
}) {
  const { lights, toast } = useStore();
  const flagged = report.lights.filter((light) => light.status !== 'clear');
  const toDim = report.lights
    .filter((light) => !room.lights.find((placed) => placed.light_id === light.light_id)?.planned)
    .map((light) => ({ id: light.light_id, level: dimTo(light.cap, lights[light.light_id]) }))
    .filter((item): item is { id: string; level: number } => item.level !== null);

  if (!hasSeat) {
    return <Panel title="Glare check"><p className="hint">Add a desk or a screen and MyHuey can check for glare from where you sit.</p></Panel>;
  }
  return (
    <Panel title="Glare check">
      <Segmented label="Mode" value={mode} onChange={onMode} options={GLARE_MODES.map((value) => ({ value, label: MODE_LABELS[value] ?? value }))} />
      <p className={`glare-summary${report.hazards ? ' flagged' : ''}`}>{summary(report)}</p>
      {flagged.length > 0 && (
        <ul className="glare-list">
          {flagged.map((light) => {
            const placed = room.lights.find((item) => item.light_id === light.light_id);
            return (
              <li key={light.light_id}>
                <button type="button" className={light.light_id === selectedId ? 'active' : ''} onClick={() => onSelect(light.light_id)}>
                  <span className="glare-name">
                    {lights[light.light_id]?.name ?? light.label}
                    <small>
                      {placed ? `${formatLength(heightOf(placed), room.units)} high` : ''}
                      {light.angle !== null ? ` · ${Math.round(light.angle)}° off your gaze` : ''}
                    </small>
                    {light.cap && <small>{capText(light.cap)}</small>}
                  </span>
                  <span className={`glare-badge tone-${statusTone(light.status)}`}>{STATUS_LABELS[light.status]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {report.hazards > 0 && (
        <button type="button" className="button small primary" disabled={!toDim.length}
          title={toDim.length ? 'Lowers only the lit lights that are over their limit. Nothing is brightened.' : 'No lit light is over its limit right now.'}
          onClick={() => {
            for (const item of toDim) sendLight(item.id, { brightness: item.level }, { brightness: item.level });
            toast(`Dimmed ${toDim.length} light${toDim.length === 1 ? '' : 's'}.`, false);
          }}>
          <ShieldCheck size={14} /> Dim {toDim.length || 'the'} flagged light{toDim.length === 1 ? '' : 's'}
        </button>
      )}
    </Panel>
  );
}
