// Your own numbers: where your eyes are when you sit (above the seat) and stand, and how far you
// sit from the screens when no chair is marked as your seat. Saved with your preferences.
import type { Preferences, Units } from '../types';
import { LengthInput } from './ui';

type Eyes = Pick<Preferences, 'eye_sitting' | 'eye_standing' | 'screen_distance'>;
const LIMITS: Record<keyof Eyes, [number, number]> = { eye_sitting: [50, 90], eye_standing: [100, 200], screen_distance: [30, 150] };

export function EyeFields({ eyes, units, onChange }: { eyes: Eyes; units: Units; onChange: (changes: Partial<Eyes>) => void }) {
  const field = (key: keyof Eyes, label: string) => (
    <LengthInput label={label} value={eyes[key]} units={units}
      onCommit={(cm) => onChange({ [key]: Math.round(Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], cm))) })} />
  );
  return (
    <>
      <div className="field-row">
        {field('eye_sitting', 'Sitting eye height')}
        {field('eye_standing', 'Standing eye height')}
      </div>
      {field('screen_distance', 'Screen distance')}
      <p className="hint">Sitting eye height is measured from the chair seat. Screen distance is used when no chair is marked "I sit here".</p>
    </>
  );
}
