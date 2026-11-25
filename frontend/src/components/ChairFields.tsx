// A chair can be where you sit: your eyes go over it, at its seat height plus your own sitting eye height.
import type { Furniture, Units } from '../types';
import { LengthInput } from './ui';

export const DEFAULT_SEAT_HEIGHT = 46;

export function ChairFields({ item, units, onChange }: { item: Furniture; units: Units; onChange: (next: Furniture) => void }) {
  const sits = item.seat != null;
  return (
    <>
      <label className="check-row">
        <input type="checkbox" checked={sits} onChange={(event) => onChange({ ...item, seat: event.target.checked ? DEFAULT_SEAT_HEIGHT : null })} />
        I sit here
      </label>
      {sits && (
        <LengthInput label="Seat height" value={item.seat!} units={units}
          onCommit={(cm) => onChange({ ...item, seat: Math.round(Math.min(90, Math.max(30, cm))) })} />
      )}
    </>
  );
}
