// Extract a color theme from an image, the way a theme-from-image tool works: pick a mood, see
// a picker on the image for every swatch, and drag a picker to take the color under it.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Mood, Swatch as SwatchT } from '../types';
import { attempt } from '../store';
import { readableOn } from '../lib/color';

export type ThemeMood = Mood | 'custom';
const MOODS: { value: ThemeMood; label: string }[] = [
  { value: 'colorful', label: 'Colorful' },
  { value: 'bright', label: 'Bright' },
  { value: 'muted', label: 'Muted' },
  { value: 'deep', label: 'Deep' },
  { value: 'dark', label: 'Dark' },
  { value: 'custom', label: 'Custom' },
];

function useImagePixels(src: string) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const element = document.createElement('canvas');
      element.width = image.naturalWidth;
      element.height = image.naturalHeight;
      element.getContext('2d', { willReadFrequently: true })!.drawImage(image, 0, 0);
      canvas.current = element;
    };
    image.src = src;
  }, [src]);
  return (u: number, v: number): string | null => {
    const element = canvas.current;
    if (!element) return null;
    const x = Math.min(element.width - 1, Math.max(0, Math.floor(u * element.width)));
    const y = Math.min(element.height - 1, Math.max(0, Math.floor(v * element.height)));
    const [r, g, b] = element.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };
}

export function ThemeExtractor({ file, picks, mood, onChange, selected, onSelect }: {
  file: string;
  picks: SwatchT[];
  mood: ThemeMood;
  onChange: (next: { picks: SwatchT[]; mood: ThemeMood }) => void;
  selected?: number;
  onSelect?: (index: number, color: string) => void;
}) {
  const src = api.imageUrl(file);
  const sample = useImagePixels(src);
  const frame = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(Math.max(1, picks.length || 5));
  const [busy, setBusy] = useState(false);

  const extract = async (nextMood: Mood, nextCount = count) => {
    setBusy(true);
    const result = await attempt(() => api.theme(file, nextMood, nextCount));
    setBusy(false);
    if (result) onChange({ picks: result.theme, mood: nextMood });
  };

  const drag = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    onSelect?.(index, picks[index].color);
    const rect = frame.current!.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const v = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const color = sample(u, v) ?? picks[index].color;
      onChange({ mood: 'custom', picks: picks.map((pick, i) => (i === index ? { color, x: Math.round(u * 1e4) / 1e4, y: Math.round(v * 1e4) / 1e4 } : pick)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="theme-extractor">
      <div className="theme-moods" role="radiogroup" aria-label="Color mood">
        {MOODS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mood === option.value}
            className={`pill${mood === option.value ? ' active' : ''}`}
            disabled={busy || option.value === 'custom'}
            onClick={() => option.value !== 'custom' && extract(option.value)}
          >
            {option.label}
          </button>
        ))}
        <label className="theme-count">
          Colors
          <select
            className="input"
            value={count}
            onChange={(event) => {
              const next = Number(event.target.value);
              setCount(next);
              extract(mood === 'custom' ? 'colorful' : mood, next);
            }}
          >
            {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="theme-image">
        <div className="theme-frame" ref={frame}>
          <img src={src} alt="Source for the color theme" draggable={false} />
          {picks.map((pick, index) => (
            <button
              key={index}
              type="button"
              className={`picker${selected === index ? ' active' : ''}`}
              style={{ left: `${pick.x * 100}%`, top: `${pick.y * 100}%`, background: pick.color }}
              onPointerDown={drag(index)}
              aria-label={`Color picker ${index + 1}, ${pick.color}. Drag to pick another color.`}
            />
          ))}
        </div>
      </div>

      <div className="theme-strip">
        {picks.map((pick, index) => (
          <button
            key={index}
            type="button"
            className={`theme-swatch${selected === index ? ' active' : ''}`}
            style={{ background: pick.color, color: readableOn(pick.color) }}
            onClick={() => onSelect?.(index, pick.color)}
            title="Use this color"
          >
            <span className="mono">{pick.color.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
