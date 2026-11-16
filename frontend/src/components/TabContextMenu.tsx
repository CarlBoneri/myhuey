// The right-click menu on the tab bar: close a tab, choose where the tabs sit, fold or reset the
// rail. It opens at the pointer (or beside a focused tab), stays inside the window, takes focus,
// and hands it back when it closes. What it offers is decided by tabMenuItems in lib/tabs.ts.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PanelLeftClose, PanelLeftOpen, RotateCcw, X } from 'lucide-react';
import type { TabMenuItem, TabPlacement } from '../lib/tabs';

export const PLACE_LABELS: Record<TabPlacement, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };
const EDGE = 8;

export function TabContextMenu({ items, at, onChoose, onClose }: {
  items: TabMenuItem[];
  /** Where to open: the pointer, or the corner of the tab it was asked for from. */
  at: { x: number; y: number };
  onChoose: (item: TabMenuItem) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: at.x, top: at.y, visibility: 'hidden' });

  // Measured before it is painted, then moved so the whole menu is inside the window.
  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    setStyle({
      left: Math.max(EDGE, Math.min(at.x, window.innerWidth - box.width - EDGE)),
      top: Math.max(EDGE, Math.min(at.y, window.innerHeight - box.height - EDGE)),
      maxHeight: `calc(100vh - ${EDGE * 2}px)`, overflowY: 'auto',
    });
    menu.current!.querySelector<HTMLElement>('button')?.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const move = (event: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.current!.querySelectorAll<HTMLElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const row = (item: TabMenuItem) => {
    switch (item.kind) {
      case 'close': return <button type="button" role="menuitem" onClick={() => onChoose(item)}><X size={13} aria-hidden="true" /> Close tab</button>;
      case 'rail-fold': return (
        <button type="button" role="menuitem" onClick={() => onChoose(item)}>
          {item.collapsed ? <PanelLeftOpen size={13} aria-hidden="true" /> : <PanelLeftClose size={13} aria-hidden="true" />} {item.collapsed ? 'Expand rail' : 'Collapse rail'}
        </button>
      );
      case 'rail-reset': return <button type="button" role="menuitem" onClick={() => onChoose(item)}><span className="tab-menu-mark" aria-hidden="true" /> Reset rail width</button>;
      case 'reset-tabs': return <button type="button" role="menuitem" onClick={() => onChoose(item)}><RotateCcw size={13} aria-hidden="true" /> Reset the tabs</button>;
      default: return null;
    }
  };
  const places = items.filter((item): item is Extract<TabMenuItem, { kind: 'place' }> => item.kind === 'place');
  const before = items.filter((item) => item.kind === 'close');
  const after = items.filter((item) => item.kind !== 'close' && item.kind !== 'place');
  const rail = after.filter((item) => item.kind !== 'reset-tabs');
  const reset = after.filter((item) => item.kind === 'reset-tabs');

  return (
    <div ref={menu} className="tab-menu context" role="menu" aria-label="Tabs" style={style} onKeyDown={move}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      {before.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}
      <div role="group" aria-label="Tab position" className="tab-menu-group">
        <span className="tab-menu-label" aria-hidden="true">Tab position</span>
        {places.map((item) => (
          <button key={item.placement} type="button" role="menuitemradio" aria-checked={item.checked} className={item.checked ? 'checked' : ''} onClick={() => onChoose(item)}>
            <span className="tab-menu-mark" aria-hidden="true">{item.checked ? '●' : ''}</span> {PLACE_LABELS[item.placement]}
          </button>
        ))}
      </div>
      {rail.length > 0 && <div role="group" aria-label="Tab rail" className="tab-menu-group">{rail.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}</div>}
      <div className="tab-menu-group" role="none">{reset.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}</div>
    </div>
  );
}
