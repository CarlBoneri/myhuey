// Edit a Hue gradient: 2 to 5 colors spaced evenly along the light (Hue fixes the spacing;
// only colors and order can change), the mode they are drawn in, and an optional effect.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import type { BridgeLight } from '../types';
import { gradientStops, renderStops } from '../lib/color';
import { createLightWriter } from '../lib/lights';
import { ColorPicker } from './ColorPicker';
import { IconButton } from './ui';

export const MODE_LABELS: Record<string, string> = {
  interpolated_palette: 'Blend',
  interpolated_palette_mirrored: 'Mirrored',
  segmented_palette: 'Bands',
  random_pixelated: 'Scatter',
};

const label = (value: string) => (value === 'no_effect' ? 'None' : value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '));

export interface GradientValue {
  colors: string[];
  mode: string;
  effect?: string | null;
}

/** The hard-stepped CSS gradient for a bar preview of `colors` drawn in `mode`. */
export function gradientCss(colors: string[], mode: string, steps = 48): string {
  const stops = renderStops(colors, mode, steps);
  if (!stops.length) return '#1a1825';
  return `linear-gradient(90deg, ${stops.map((c, i) => `${c} ${(i / steps) * 100}% ${((i + 1) / steps) * 100}%`).join(', ')})`;
}

export function GradientEditor({ value, onChange, modes, capable, effects, palette }: {
  value: GradientValue;
  onChange: (next: GradientValue) => void;
  modes: string[];
  capable: number;
  effects?: string[];
  palette?: string[];
}) {
  const [selected, setSelected] = useState(0);
  const dragFrom = useRef<number | null>(null);
  const colors = value.colors;
  const index = Math.min(selected, colors.length - 1);
  const max = Math.max(2, Math.min(5, capable || 5));

  const set = (next: Partial<GradientValue>) => onChange({ ...value, ...next });
  const setColors = (next: string[]) => set({ colors: next });

  const add = () => {
    if (colors.length >= max) return;
    // A new stop goes after the selected one, colored halfway to its neighbor.
    const after = colors[index + 1] ?? colors[index];
    const middle = gradientStops([colors[index], after], 3)[1];
    const next = [...colors.slice(0, index + 1), middle, ...colors.slice(index + 1)];
    setColors(next);
    setSelected(index + 1);
  };
  const remove = () => {
    if (colors.length <= 2) return;
    setColors(colors.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...colors];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setColors(next);
    setSelected(to);
  };

  return (
    <div className="gradient-editor">
      <div className="gradient-bar" style={{ background: gradientCss(colors, value.mode) }} aria-hidden="true" />
      <div className="gradient-stops" role="listbox" aria-label="Gradient colors, start to end">
        {colors.map((color, i) => (
          <button
            key={i}
            type="button"
            role="option"
            aria-selected={i === index}
            className={`gradient-stop${i === index ? ' active' : ''}`}
            style={{ background: color, left: `${colors.length === 1 ? 50 : (i / (colors.length - 1)) * 100}%` }}
            title={`Point ${i + 1}: ${color}. Drag to reorder.`}
            draggable
            onDragStart={() => { dragFrom.current = i; }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
            onClick={() => setSelected(i)}
          />
        ))}
      </div>
      <div className="gradient-tools">
        <span className="hint">{colors.length} of {max} points</span>
        <IconButton label="Add a point" onClick={add} disabled={colors.length >= max}><Plus size={15} /></IconButton>
        <IconButton label="Remove this point" onClick={remove} disabled={colors.length <= 2}><Minus size={15} /></IconButton>
        <IconButton label="Reverse the gradient" onClick={() => { setColors([...colors].reverse()); setSelected(colors.length - 1 - index); }}><ArrowLeftRight size={15} /></IconButton>
        <button type="button" className="button subtle small" onClick={() => setColors(colors.map(() => colors[index]))} title="Set every point to this color">One color</button>
      </div>

      {modes.length > 1 && (
        <div className="pill-row" role="radiogroup" aria-label="Gradient mode">
          {modes.map((mode) => (
            <button key={mode} type="button" role="radio" aria-checked={value.mode === mode} className={`pill${value.mode === mode ? ' active' : ''}`} onClick={() => set({ mode })}>
              {MODE_LABELS[mode] ?? label(mode)}
            </button>
          ))}
        </div>
      )}

      {value.effect && value.effect !== 'no_effect' && (
        <p className="hint">The {label(value.effect).toLowerCase()} effect replaces these colors on the light. Pick None to show them again.</p>
      )}
      <ColorPicker compact value={colors[index]} palette={palette} onChange={(hex) => setColors(colors.map((c, i) => (i === index ? hex : c)))} />

      {effects && effects.length > 1 && (
        <div className="effect-group">
          <h4>Effect</h4>
          <div className="pill-row" role="radiogroup" aria-label="Effect">
            {effects.map((effect) => (
              <button key={effect} type="button" role="radio" aria-checked={(value.effect ?? 'no_effect') === effect}
                className={`pill${(value.effect ?? 'no_effect') === effect ? ' active' : ''}`} onClick={() => set({ effect })}>
                {label(effect)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The editor wired to a real light: every change is sent to the bridge (debounced, in order). */
export function LiveGradientEditor({ light, palette }: { light: BridgeLight; palette?: string[] }) {
  const gradient = light.gradient!;
  const initial = (): GradientValue => ({
    colors: gradient.points.length >= 2 ? gradient.points : [light.color ?? '#ffb36b', light.color ?? '#ffb36b'],
    mode: gradient.mode,
    effect: light.effect?.current ?? 'no_effect',
  });
  const [value, setValue] = useState<GradientValue>(initial);
  const editing = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<GradientValue | null>(null);
  const writer = useRef<ReturnType<typeof createLightWriter> | null>(null);
  if (!writer.current) {
    writer.current = createLightWriter(async (write) => {
      if (write.type === 'gradient') await api.setGradient(light.id, write.colors, write.mode);
      else await api.setEffect(light.id, write.effect);
    }, initial());
  }

  // Follow the bridge between edits (another app may change the light), but not mid-edit.
  useEffect(() => {
    if (Date.now() - editing.current > 3000) {
      const fresh = initial();
      setValue(fresh);
      writer.current!.reset(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light.id, gradient.points.join(), gradient.mode, light.effect?.current]);

  const flush = () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    writer.current!.push(next).then(
      () => useStore.getState().patchLight(light.id, {
        on: true,
        color: next.colors[0],
        gradient: { ...gradient, points: next.effect && next.effect !== 'no_effect' ? [] : next.colors, mode: next.mode },
        effect: light.effect ? { ...light.effect, current: next.effect ?? 'no_effect' } : null,
      }),
      (error) => useStore.getState().toast((error as Error).message),
    );
  };

  const change = (next: GradientValue) => {
    editing.current = Date.now();
    setValue(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 150);
  };
  // Closing the panel sends the last edit instead of dropping it.
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GradientEditor value={value} onChange={change} modes={gradient.modes} capable={gradient.points_capable}
      effects={light.effect?.values} palette={palette} />
  );
}
