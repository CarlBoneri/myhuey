// A screen's shape, set the way a spec sheet gives it: diagonal and aspect, landscape or portrait,
// its curve (R in mm, as printed on the box), and how far it leans back.
import { useEffect, useState } from 'react';
import type { Furniture } from '../types';
import { ASPECTS, CURVES, CURVE_RANGE_MM, diagonalOf, sizeFromDiagonal } from '../lib/screen';
import { DEFAULT_MONITOR_TILT } from '../lib/glareMath';
import { Field, Segmented, Slider } from './ui';

const TILT_LIMIT = 45;
type CurveChoice = 'flat' | 'custom' | `${number}`;

/** A number field that commits on blur or Enter, and only when `valid` accepts it. */
function NumberField({ label, value, valid, hint, onCommit }: {
  label: string; value: number | null; valid: (n: number) => boolean; hint: string; onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState(false);
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n) || !valid(n)) return setError(true);
    setError(false);
    if (n !== value) onCommit(n);
  };
  return (
    <Field label={label} hint={error ? hint : undefined}>
      <input className={`input${error ? ' invalid' : ''}`} inputMode="decimal" aria-label={label} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </Field>
  );
}

/**
 * `onChange` gets every edit; `onCommit` (when given) follows each finished one, so the tilt slider
 * saves once on release rather than on every step.
 */
export function ScreenFields({ item, onChange, onCommit }: { item: Furniture; onChange: (next: Furniture) => void; onCommit?: () => void }) {
  const height = item.height ?? 40;
  const portrait = height > item.width;
  const [long, short] = portrait ? [height, item.width] : [item.width, height];
  const aspect = ASPECTS.find((a) => Math.abs(long / short - a.w / a.h) < 0.03);
  const sold = item.curve != null && CURVES.includes(item.curve);
  const [customCurve, setCustomCurve] = useState(item.curve != null && !sold);
  useEffect(() => setCustomCurve(item.curve != null && !CURVES.includes(item.curve)), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const curveChoice: CurveChoice = customCurve ? 'custom' : item.curve == null ? 'flat' : `${item.curve}`;
  const tilt = item.tilt ?? (item.kind.startsWith('monitor') ? DEFAULT_MONITOR_TILT : 0);

  const finish = (next: Furniture) => { onChange(next); onCommit?.(); };
  /** The panel at a diagonal, in a ratio given long side first, keeping the orientation. */
  const resize = (inches: number, w: number, h: number) => {
    const size = sizeFromDiagonal(inches, w, h);
    finish({ ...item, ...(portrait ? { width: size.height, height: size.width } : size) });
  };

  return (
    <>
      <div className="field-row">
        <NumberField label="Diagonal (in)" value={diagonalOf(item)} valid={(n) => n >= 5 && n <= 120} hint="Between 5 and 120 inches"
          onCommit={(inches) => (aspect ? resize(inches, aspect.w, aspect.h) : resize(inches, long, short))} />
      </div>
      <Segmented label="Aspect" value={aspect?.label ?? 'custom'}
        onChange={(label) => { const a = ASPECTS.find((x) => x.label === label); if (a) resize(diagonalOf(item), a.w, a.h); }}
        options={[...ASPECTS.map((a) => ({ value: a.label, label: a.label })), ...(aspect ? [] : [{ value: 'custom', label: 'Other', disabled: true }])]} />
      <Segmented label="Orientation" value={portrait ? 'portrait' : 'landscape'}
        onChange={(next) => {
          if ((next === 'portrait') === portrait) return;
          // A curved panel cannot stand on its end: turning it to portrait makes it flat.
          finish({ ...item, width: height, height: item.width, curve: next === 'portrait' ? null : item.curve });
          if (next === 'portrait') setCustomCurve(false);
        }}
        options={[{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }]} />
      <Segmented<CurveChoice> label="Curve" value={curveChoice}
        onChange={(choice) => {
          if (choice === 'custom') return setCustomCurve(true);
          setCustomCurve(false);
          finish({ ...item, curve: choice === 'flat' ? null : Number(choice) });
        }}
        options={[
          ...CURVES.map((c) => ({ value: (c === null ? 'flat' : `${c}`) as CurveChoice, label: c === null ? 'Flat' : `${c}R`, disabled: portrait && c !== null })),
          { value: 'custom' as CurveChoice, label: 'Custom', disabled: portrait },
        ]} />
      {customCurve && !portrait && (
        <NumberField label="Curve (R)" value={item.curve ?? null} hint={`Between ${CURVE_RANGE_MM[0]}R and ${CURVE_RANGE_MM[1]}R`}
          valid={(n) => n >= CURVE_RANGE_MM[0] && n <= CURVE_RANGE_MM[1]} onCommit={(curve) => finish({ ...item, curve })} />
      )}
      <Slider label="Tilt (leans back below 0)" value={tilt} min={-TILT_LIMIT} max={TILT_LIMIT} format={(v) => `${Math.round(v)}°`}
        onChange={(next) => onChange({ ...item, tilt: next })} onCommit={() => onCommit?.()} />
    </>
  );
}
