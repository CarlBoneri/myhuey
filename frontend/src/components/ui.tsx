import { useEffect, useState, type ReactNode, type CSSProperties, type InputHTMLAttributes } from 'react';
import type { Units } from '../types';
import { formatLength, parseLength } from '../lib/units';
import { HUE_ICONS } from './hueIcons';

export function HueIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const path = HUE_ICONS[name] ?? HUE_ICONS['bulb-classic'];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ active, onClick, children, title }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={`pill${active ? ' active' : ''}`} onClick={onClick} title={title} aria-pressed={active}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({ label, onClick, children, active, danger, disabled }: { label: string; onClick?: () => void; children: ReactNode; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-button${active ? ' active' : ''}${danger ? ' danger' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, onCommit, track, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; onCommit?: (value: number) => void; track?: string; format?: (value: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <output>{format ? format(value) : Math.round(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={track ? ({ '--track': track } as CSSProperties) : undefined}
        className={track ? 'tracked' : ''}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
      />
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

/** A length field: shows feet and inches or meters, accepts any unit when typed. */
export function LengthInput({ value, units, onCommit, label }: { value: number; units: Units; onCommit: (cm: number) => void; label: string }) {
  const [text, setText] = useState(formatLength(value, units));
  const [error, setError] = useState(false);
  useEffect(() => setText(formatLength(value, units)), [value, units]);
  const commit = () => {
    const parsed = parseLength(text, units);
    if (parsed === null || parsed <= 0) {
      setError(true);
      return;
    }
    setError(false);
    if (Math.abs(parsed - value) > 0.05) onCommit(parsed);
    setText(formatLength(parsed, units));
  };
  return (
    <Field label={label} hint={error ? `Try ${units === 'imperial' ? `12' 6" or 3.8m` : '3.8m or 12ft'}` : undefined}>
      <input
        className={`input${error ? ' invalid' : ''}`}
        value={text}
        aria-invalid={error}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
      />
    </Field>
  );
}

export function Swatch({ color, size = 28, active, onClick, title }: { color: string; size?: number; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      className={`swatch${active ? ' active' : ''}`}
      style={{ background: color, width: size, height: size }}
      onClick={onClick}
      title={title ?? color}
      aria-label={title ?? color}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
