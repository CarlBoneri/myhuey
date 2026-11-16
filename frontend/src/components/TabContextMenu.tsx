// The right-click menu on the tab bar: close a tab, choose where the tabs sit, fold or reset the
// rail. It opens at the pointer (or beside a focused tab), stays inside the window, takes focus,
// and hands it back when it closes. Escape and Tab both leave it. What it offers is decided by tabMenuItems in lib/tabs.ts.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeftClose, PanelLeftOpen, RotateCcw, X } from 'lucide-react';
import { moveMenuFocus } from '../lib/menuKeys';
import { PLACE_LABELS, type TabMenuItem } from '../lib/tabs';

const EDGE = 8;

export function TabContextMenu({ items, at, note, onChoose, onClose }: {
  items: TabMenuItem[];
  /** Said under the position rows when the tabs are not drawn where they were saved. */
  note?: string | null;
  /** Where to open: the pointer, or the corner of the tab it was asked for from. */
  at: { x: number; y: number };
  onChoose: (item: TabMenuItem) => void;
  /** `restoreFocus` is true when the person chose to leave (Escape, an item), false when focus already went elsewhere. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const noteId = useId();

  // Measured before it is painted, then moved through the element (so it stays visible and can take
  // focus) until the whole menu is inside the window.
  useLayoutEffect(() => {
    const node = menu.current!;
    const box = node.getBoundingClientRect();
    node.style.left = `${Math.max(EDGE, Math.min(at.x, window.innerWidth - box.width - EDGE))}px`;
    node.style.top = `${Math.max(EDGE, Math.min(at.y, window.innerHeight - box.height - EDGE))}px`;
    node.querySelector<HTMLElement>('button')?.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(false); };
    // The menu's own scrolling (when it is taller than the window) is not a reason to close it.
    const scrolled = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(false); };
    const leave = () => onClose(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(true); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('blur', leave);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('blur', leave);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const move = (event: React.KeyboardEvent) => {
    // Tab leaves the menu like Escape does, so focus goes back to the tab it came from.
    if (event.key === 'Tab') { event.preventDefault(); onClose(true); return; }
    if (moveMenuFocus(menu.current!, event.key)) event.preventDefault();
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

  // Drawn on the body: inside the nav, its stacking context would trap it under the rail's resize handle and the Workflows drawer.
  return createPortal(
    <div ref={menu} className="tab-menu context" role="menu" aria-label="Tabs" onKeyDown={move}
      style={{ left: at.x, top: at.y, maxHeight: `calc(100vh - ${EDGE * 2}px)`, overflowY: 'auto' }}
      onBlur={(event) => { const to = event.relatedTarget as Node | null; if (to && !menu.current?.contains(to)) onClose(false); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      {before.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}
      <div role="group" aria-label="Tab position" aria-describedby={note ? noteId : undefined} className="tab-menu-group">
        <span className="tab-menu-label" aria-hidden="true">Tab position</span>
        {places.map((item) => (
          <button key={item.placement} type="button" role="menuitemradio" aria-checked={item.checked} className={item.checked ? 'checked' : ''} onClick={() => onChoose(item)}>
            <span className="tab-menu-mark" aria-hidden="true">{item.checked ? '●' : ''}</span> {PLACE_LABELS[item.placement]}
          </button>
        ))}
        {note && <p className="tab-menu-note" id={noteId}>{note}</p>}
      </div>
      {rail.length > 0 && <div role="group" aria-label="Tab rail" className="tab-menu-group">{rail.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}</div>}
      <div className="tab-menu-group" role="none">{reset.map((item) => <span key={item.kind} role="none">{row(item)}</span>)}</div>
    </div>,
    document.body,
  );
}
