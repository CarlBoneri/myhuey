import { Children, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactNode, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useUi } from '../uiStore';
import type { Units } from '../types';
import { formatLength, parseLength } from '../lib/units';
import { SIDEBAR_WIDTH, sidebarAfterDrag } from '../lib/paneDrag';
import { isMac, isResizePress } from '../lib/pointer';
import { clamp } from '../lib/view3d';
import { HUE_ICONS } from './hueIcons';

export function HueIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const path = HUE_ICONS[name] ?? HUE_ICONS['bulb-classic'];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** The words in a title, for naming a panel whose title is more than text (an icon and a label). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return Children.toArray(node.props.children).map(textOf).join('');
  return '';
}

/** Inside a sidebar, panels fold. The sidebar knows its panels so one Alt-click can fold or open them all. */
const SidebarContext = createContext<{ name: string; keys: Set<string> } | null>(null);

/**
 * A side column of panels that fold away, like the tool windows of an editor. Drag the bar on its
 * left edge (or focus it and use the arrow keys) to make it wider or narrower; double-click the bar
 * for the usual width. The width is remembered per sidebar.
 */
export function Sidebar({ name, children, className = '' }: { name: string; children: ReactNode; className?: string }) {
  const keys = useRef(new Set<string>());
  const saved = useUi((state) => state.sidebarWidths[name]);
  const setWidth = useUi((state) => state.setSidebarWidth);
  const width = saved ?? SIDEBAR_WIDTH.initial;
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isResizePress(event, isMac())) return;
    const bar = event.currentTarget;
    // Claim the press: left alone, the browser starts a text selection and cancels the resize.
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    const [startX, startWidth] = [event.clientX, width];
    const move = (e: PointerEvent) => setWidth(name, sidebarAfterDrag(startWidth, startX, e.clientX));
    const stop = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', stop); bar.removeEventListener('pointercancel', stop); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  };
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
    if (!step) return;
    event.preventDefault();
    setWidth(name, clamp(width + step, [SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max]));
  };
  const size = { '--side-w': `${width}px` } as CSSProperties;
  return (
    <SidebarContext.Provider value={{ name, keys: keys.current }}>
      <div className="sidebar-grip" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" tabIndex={0}
        aria-valuenow={width} aria-valuemin={SIDEBAR_WIDTH.min} aria-valuemax={SIDEBAR_WIDTH.max}
        title="Drag to resize · double-click to reset" style={size} onPointerDown={drag} onKeyDown={nudge}
        onDoubleClick={() => setWidth(name, null)}><span /></div>
      <aside className={`inspector ${className}`} style={size}>{children}</aside>
    </SidebarContext.Provider>
  );
}

/**
 * A titled block. In a Sidebar it folds: click the title (or its triangle) to hide the body,
 * Alt-click to fold or open every panel in that sidebar. What is folded is remembered per
 * browser, under the panel's `id` or, without one, its title.
 */
export function Panel({ title, actions, children, className = '', id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const sidebar = useContext(SidebarContext);
  const bodyId = useId();
  const key = sidebar && title ? `${sidebar.name}/${id ?? textOf(title).trim().toLowerCase()}` : null;
  const folded = useUi((state) => (key ? !!state.folded[key] : false));
  useEffect(() => {
    if (!sidebar || !key) return;
    sidebar.keys.add(key);
    return () => { sidebar.keys.delete(key); };
  }, [sidebar, key]);
  if (!key || !sidebar) {
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
  return (
    <section className={`panel foldable${folded ? ' folded' : ''} ${className}`}>
      <header className="panel-head">
        <h2>
          <button type="button" className="panel-toggle" aria-expanded={!folded} aria-controls={bodyId}
            title={`${folded ? 'Show' : 'Hide'} this panel · Alt-click for all of them`}
            onClick={(event) => useUi.getState().setFolded(event.altKey ? [...sidebar.keys] : [key], !folded)}>
            <svg className="panel-twist" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l6 4-6 4z" fill="currentColor" /></svg>
            <span>{title}</span>
          </button>
        </h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {/* Hidden, not removed: half-typed fields and open pickers are still there when it opens again. */}
      <div className="panel-body" id={bodyId} hidden={folded}>{children}</div>
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

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
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
