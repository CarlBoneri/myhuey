import type { RefreshMove, RefreshPlan, RoomRefresh } from '../types';
import { Panel } from './ui';

const lights = (n: number) => `${n} light${n === 1 ? '' : 's'}`;

// A room linked this time under another name shows the Hue name too: "Family room (Hue: Den)".
const heading = (r: RoomRefresh) => (r.link && r.hue_name && r.hue_name !== r.room ? `${r.room} (Hue: ${r.hue_name})` : r.room);

function Line({ sign, move }: { sign: '+' | '−'; move: RefreshMove }) {
  const arrives = sign === '+';
  const word = arrives ? 'arrives' : 'leaves';
  const preposition = arrives ? 'from' : 'to';
  let label = move.other ? `${move.label} ${word} ${preposition} ${move.other}` : `${move.label} ${word}`;
  let text = move.other ? `${sign} ${move.label} (${preposition} ${move.other})` : `${sign} ${move.label}`;
  if (arrives && move.other && move.also) {
    label = `${move.label} arrives, and stays in ${move.other} too`;
    text = `${sign} ${move.label} (also in ${move.other})`;
  }
  return <p className="hint" aria-label={label}>{text}</p>;
}

export function RefreshRoomsPanel({ plan, busy, onCancel, onApply }: { plan: RefreshPlan; busy: boolean; onCancel: () => void; onApply: () => void }) {
  const changed = plan.rooms.filter((r) => r.status === 'changed');
  const added = plan.rooms.filter((r) => r.status === 'new');
  const alone = plan.rooms.filter((r) => r.status === 'left_alone');
  const same = plan.rooms.filter((r) => r.status === 'unchanged').length;
  const nothing = !changed.length && !added.length;
  return (
    <Panel title="Refresh from Hue">
      {nothing ? (
        <>
          <p className="hint">Your rooms already match Hue.</p>
          <div className="button-row">
            <button type="button" className="button primary" disabled={busy} onClick={plan.rooms.some((r) => r.link) ? onApply : onCancel}>Done</button>
          </div>
        </>
      ) : (
        <>
          {changed.map((r) => (
            <div key={r.room}>
              <strong>{heading(r)}</strong>
              {r.arrive.map((m) => <Line key={`a${m.light_id}`} sign="+" move={m} />)}
              {r.leave.map((m) => <Line key={`l${m.light_id}`} sign={'−'} move={m} />)}
            </div>
          ))}
          {added.map((r) => <p key={r.room} className="hint">{`${heading(r)}: new room, ${lights(r.arrive.length)}`}</p>)}
          {alone.map((r) => <p key={r.room} className="hint">{`${r.room}: not on the bridge, left alone`}</p>)}
          {same > 0 && <p className="hint">{same === 1 ? '1 room already matches' : `${same} rooms already match`}</p>}
          <div className="button-row">
            <button type="button" className="button" disabled={busy} onClick={onCancel}>Cancel</button>
            <button type="button" className="button primary" disabled={busy} onClick={onApply}>Apply</button>
          </div>
        </>
      )}
    </Panel>
  );
}
