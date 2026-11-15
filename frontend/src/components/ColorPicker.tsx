// A perceptual color picker: OKLCH and HCT (Material) first, HSL and RGB for familiarity.
// The 2D field shows chroma across and lightness (or tone) down at the current hue; colors the
// screen cannot show are dimmed rather than silently clipped.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  harmonies, hctToHex, hexToHct, hexToHsl, hexToLab, hexToOklch, hexToRgb, hslToHex, inGamut, mixes, normalizeHex,
  oklchToHex, rgbToHex, tonalPalette, type HctColor, type Oklch,
} from '../lib/color';
import { Segmented, Slider, Swatch } from './ui';

type Mode = 'oklch' | 'hct' | 'hsl' | 'rgb';
const MAX_C = 0.37;
const MAX_HCT_C = 120;

function useField(draw: (x: number, y: number) => [number, number, number, number], deps: unknown[], width = 96, height = 72) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b, a] = draw(x / (width - 1), y / (height - 1));
        const i = (y * width + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = a;
      }
    }
    ctx.putImageData(image, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function ColorPicker({ value, onChange, palette = [], compact = false }: {
  value: string; onChange: (hex: string) => void; palette?: string[]; compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('oklch');
  // Keep the hue the user chose even where gray makes it undefined.
  const [lch, setLch] = useState<Oklch>(() => hexToOklch(value));
  const [hct, setHct] = useState<HctColor>(() => hexToHct(value));
  const [hexText, setHexText] = useState(value);
  const last = useRef(value);

  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    const next = hexToOklch(value);
    setLch((current) => ({ ...next, h: next.c < 0.005 ? current.h : next.h }));
    const nextHct = hexToHct(value);
    setHct((current) => ({ ...nextHct, h: nextHct.c < 1 ? current.h : nextHct.h }));
    setHexText(value);
  }, [value]);

  const emit = (hex: string) => {
    last.current = hex;
    setHexText(hex);
    onChange(hex);
  };
  const setFromLch = (next: Oklch) => {
    setLch(next);
    const hex = oklchToHex(next);
    setHct((current) => ({ ...hexToHct(hex), h: next.c < 0.005 ? current.h : hexToHct(hex).h }));
    emit(hex);
  };
  const setFromHct = (next: HctColor) => {
    setHct(next);
    const hex = hctToHex(next);
    setLch((current) => ({ ...hexToOklch(hex), h: next.c < 1 ? current.h : hexToOklch(hex).h }));
    emit(hex);
  };
  const setFromHex = (hex: string) => {
    const next = hexToOklch(hex);
    setLch((current) => ({ ...next, h: next.c < 0.005 ? current.h : next.h }));
    setHct(hexToHct(hex));
    emit(hex);
  };

  const hsl = hexToHsl(value);
  const rgb = hexToRgb(value);

  const fieldRef = useField(
    (fx, fy) => {
      let hex: string;
      let ok = true;
      if (mode === 'hct') {
        hex = hctToHex({ h: hct.h, c: fx * MAX_HCT_C, t: (1 - fy) * 100 });
        const back = hexToHct(hex);
        ok = Math.abs(back.c - fx * MAX_HCT_C) < 4;
      } else if (mode === 'oklch') {
        const color = { l: 1 - fy, c: fx * MAX_C, h: lch.h };
        ok = inGamut(color);
        hex = oklchToHex(color);
      } else {
        hex = hslToHex([hsl[0], fx * 100, (1 - fy) * 100]);
      }
      const [r, g, b] = hexToRgb(hex);
      return ok ? [r, g, b, 255] : [r * 0.35, g * 0.35, b * 0.35, 255];
    },
    [mode, Math.round(lch.h), Math.round(hct.h), mode === 'hsl' || mode === 'rgb' ? hsl[0] : 0],
  );

  const marker = mode === 'hct'
    ? { x: hct.c / MAX_HCT_C, y: 1 - hct.t / 100 }
    : mode === 'oklch'
      ? { x: lch.c / MAX_C, y: 1 - lch.l }
      : { x: hsl[1] / 100, y: 1 - hsl[2] / 100 };

  const pickFromField = (clientX: number, clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    if (mode === 'hct') setFromHct({ h: hct.h, c: fx * MAX_HCT_C, t: (1 - fy) * 100 });
    else if (mode === 'oklch') setFromLch({ l: 1 - fy, c: fx * MAX_C, h: lch.h });
    else setFromHex(hslToHex([hsl[0], fx * 100, (1 - fy) * 100]));
  };

  const track = (stops: string[]) => `linear-gradient(90deg, ${stops.join(', ')})`;
  const range = (count: number, fn: (t: number) => string) => Array.from({ length: count }, (_, i) => fn(i / (count - 1)));

  const tones = useMemo(() => tonalPalette(value, [10, 20, 30, 40, 50, 60, 70, 80, 90, 95]), [value]);
  const sets = useMemo(() => harmonies(value), [value]);
  const blends = useMemo(() => mixes(value, 7), [value]);

  return (
    <div className={`color-picker${compact ? ' compact' : ''}`}>
      <Segmented
        label="Color model"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'oklch', label: 'OKLCH', title: 'Perceptual lightness, chroma, hue' },
          { value: 'hct', label: 'HCT', title: 'Material hue, chroma, tone' },
          { value: 'hsl', label: 'HSL' },
          { value: 'rgb', label: 'RGB' },
        ]}
      />
      <div
        className="color-field"
        onPointerDown={(event) => {
          const element = event.currentTarget;
          element.setPointerCapture(event.pointerId);
          pickFromField(event.clientX, event.clientY, element);
        }}
        onPointerMove={(event) => {
          if (event.buttons) pickFromField(event.clientX, event.clientY, event.currentTarget);
        }}
        role="slider"
        aria-label="Chroma and lightness"
        aria-valuetext={value}
      >
        <canvas ref={fieldRef} />
        <span className="field-marker" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%`, background: value }} />
        <span className="field-axis x">{mode === 'hsl' || mode === 'rgb' ? 'Saturation' : 'Chroma'} →</span>
      </div>

      {mode === 'oklch' && (
        <>
          <Slider label="Lightness" value={lch.l * 100} min={0} max={100} step={0.5} format={(v) => `${v.toFixed(0)}%`}
            track={track(range(8, (t) => oklchToHex({ ...lch, l: t })))} onChange={(v) => setFromLch({ ...lch, l: v / 100 })} />
          <Slider label="Chroma" value={lch.c} min={0} max={MAX_C} step={0.002} format={(v) => v.toFixed(3)}
            track={track(range(8, (t) => oklchToHex({ ...lch, c: t * MAX_C })))} onChange={(v) => setFromLch({ ...lch, c: v })} />
          <Slider label="Hue" value={lch.h} min={0} max={360} format={(v) => `${v.toFixed(0)}°`}
            track={track(range(13, (t) => oklchToHex({ l: 0.72, c: 0.15, h: t * 360 })))} onChange={(v) => setFromLch({ ...lch, h: v })} />
        </>
      )}
      {mode === 'hct' && (
        <>
          <Slider label="Hue" value={hct.h} min={0} max={360} format={(v) => `${v.toFixed(0)}°`}
            track={track(range(13, (t) => hctToHex({ h: t * 360, c: 60, t: 60 })))} onChange={(v) => setFromHct({ ...hct, h: v })} />
          <Slider label="Chroma" value={hct.c} min={0} max={MAX_HCT_C} format={(v) => v.toFixed(0)}
            track={track(range(8, (t) => hctToHex({ ...hct, c: t * MAX_HCT_C })))} onChange={(v) => setFromHct({ ...hct, c: v })} />
          <Slider label="Tone" value={hct.t} min={0} max={100} format={(v) => v.toFixed(0)}
            track={track(range(8, (t) => hctToHex({ ...hct, t: t * 100 })))} onChange={(v) => setFromHct({ ...hct, t: v })} />
        </>
      )}
      {mode === 'hsl' && (
        <>
          <Slider label="Hue" value={hsl[0]} min={0} max={360} track={track(range(13, (t) => hslToHex([t * 360, 100, 50])))} onChange={(v) => setFromHex(hslToHex([v, hsl[1], hsl[2]]))} />
          <Slider label="Saturation" value={hsl[1]} min={0} max={100} track={track([hslToHex([hsl[0], 0, hsl[2]]), hslToHex([hsl[0], 100, hsl[2]])])} onChange={(v) => setFromHex(hslToHex([hsl[0], v, hsl[2]]))} />
          <Slider label="Lightness" value={hsl[2]} min={0} max={100} track={track(['#000', hslToHex([hsl[0], hsl[1], 50]), '#fff'])} onChange={(v) => setFromHex(hslToHex([hsl[0], hsl[1], v]))} />
        </>
      )}
      {mode === 'rgb' && (
        <>
          {(['Red', 'Green', 'Blue'] as const).map((name, channel) => (
            <Slider key={name} label={name} value={rgb[channel]} min={0} max={255}
              track={track([0, 255].map((v) => rgbToHex(rgb.map((c, i) => (i === channel ? v : c)) as [number, number, number])))}
              onChange={(v) => setFromHex(rgbToHex(rgb.map((c, i) => (i === channel ? v : c)) as [number, number, number]))} />
          ))}
        </>
      )}

      <div className="hex-row">
        <span className="hex-preview" style={{ background: value }} />
        <input
          className="input mono"
          value={hexText}
          aria-label="Hex color"
          onChange={(event) => {
            setHexText(event.target.value);
            const hex = normalizeHex(event.target.value);
            if (hex) setFromHex(hex);
          }}
        />
        <span className="readout mono" title="CIE LAB">LAB {hexToLab(value).join(' ')}</span>
      </div>

      {!compact && (
        <div className="color-extras">
          {palette.length > 0 && (
            <div className="swatch-group">
              <h4>Palette</h4>
              <div className="swatch-row">{palette.map((color, i) => <Swatch key={`${color}${i}`} color={color} active={color === value} onClick={() => setFromHex(color)} />)}</div>
            </div>
          )}
          <div className="swatch-group">
            <h4>Tonal palette</h4>
            <div className="tone-row">
              {tones.map((color, i) => (
                <button key={i} type="button" className="tone" style={{ background: color }} title={color} onClick={() => setFromHex(color)} aria-label={`Tone ${color}`} />
              ))}
            </div>
          </div>
          <div className="swatch-group">
            <h4>Shades, tints, tones</h4>
            {(['shades', 'tints', 'tones'] as const).map((row) => (
              <div key={row} className="tone-row small">
                {blends[row].map((color, i) => (
                  <button key={i} type="button" className="tone" style={{ background: color }} title={color} onClick={() => setFromHex(color)} aria-label={`${row} ${color}`} />
                ))}
              </div>
            ))}
          </div>
          <div className="swatch-group">
            <h4>Harmonies</h4>
            {sets.map((set) => (
              <div key={set.name} className="harmony">
                <span>{set.name}</span>
                <div className="swatch-row">{set.colors.map((color, i) => <Swatch key={i} color={color} size={22} onClick={() => setFromHex(color)} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
