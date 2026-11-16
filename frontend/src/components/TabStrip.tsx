// The window tabs, drawn once and placed three ways: in the top bar, in a strip above the prompt
// (both horizontal), or in a rail down one side (vertical). Drag, close, reopen, reset, and the
// keyboard moves all work the same in each; only the axis changes.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Plus, RotateCcw, X, type LucideIcon } from 'lucide-react';
import { href, go, type Route } from '../lib/router';
import { DEFAULT_TABS, TAB_PLACEMENTS, closeTab, isVertical, moveTab, neighbour, reopenTab, shiftTab, type TabId, type TabPlacement, type TabState } from '../lib/tabs';
import { useUi } from '../uiStore';

export interface Tab { id: TabId; label: string; icon: LucideIcon; route: Route }
const TAB_DRAG = 'application/x-myhuey-tab';
const PLACE_LABELS: Record<TabPlacement, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };

interface Props {
  /** Where the strip is drawn right now (a rail falls back to top in a narrow window). */
  placement: TabPlacement;
  tabs: Tab[];
  closed: Tab[];
  /** Every tab that exists right now, to pick the one to show after a close. */
  available: TabId[];
  byId: Map<TabId, Tab>;
  activeTab: TabId;
  state: TabState;
  setTabs: (tabs: TabState) => void;
}

export function TabStrip({ placement, tabs, closed, available, byId, activeTab, state, setTabs }: Props) {
  const { tabPlacement, setTabPlacement } = useUi();
  const vertical = isVertical(placement);
  const [menu, setMenu] = useState<CSSProperties | null>(null);
  const [dropAt, setDropAt] = useState<TabId | 'end' | null>(null);
  const dragging = useRef<TabId | null>(null);

  useEffect(() => {
    if (!menu) return;
    const shut = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') shut(); };
    window.addEventListener('pointerdown', shut);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', shut); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => setMenu(null), [placement]);

  const close = (id: TabId) => {
    const next = closeTab(state, id);
    if (next === state) return;
    if (id === activeTab) {
      const to = neighbour(state, id, available);
      if (to && byId.get(to)) go(byId.get(to)!.route);
    }
    setTabs(next);
  };
  const dropOn = (target: TabId | null) => {
    if (dragging.current) setTabs(moveTab(state, dragging.current, target));
    dragging.current = null;
    setDropAt(null);
  };
  // The menu is fixed so the strip's own scrolling cannot clip it; it opens away from the screen edge it sits against.
  const toggleMenu = (button: HTMLElement) => {
    if (menu) return setMenu(null);
    const box = button.getBoundingClientRect();
    const style: CSSProperties = { maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' };
    if (vertical) {
      if (placement === 'left') style.left = box.right + 6; else style.right = window.innerWidth - box.left + 6;
      style.bottom = Math.max(8, window.innerHeight - box.bottom);
    } else {
      if (box.left > window.innerWidth - 260) style.right = Math.max(8, window.innerWidth - box.right); else style.left = Math.max(8, box.left);
      if (placement === 'bottom') style.bottom = window.innerHeight - box.top + 6; else style.top = box.bottom + 6;
    }
    setMenu(style);
  };

  return (
    <nav className={`tabs ${placement}${vertical ? ' rail' : ''}`} aria-label="Main" aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onDragOver={(event) => { if (dragging.current) { event.preventDefault(); setDropAt('end'); } }}
      onDrop={(event) => { event.preventDefault(); dropOn(null); }}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        return (
          <span key={tab.id} className={`tab${active ? ' active' : ''}${dropAt === tab.id ? ' drop-before' : ''}`} draggable
            onDragStart={(event) => { dragging.current = tab.id; event.dataTransfer.setData(TAB_DRAG, tab.id); event.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { dragging.current = null; setDropAt(null); }}
            onDragOver={(event) => {
              if (!dragging.current) return;
              event.preventDefault();
              event.stopPropagation();
              // Past the middle of a tab means "after it": before the next tab, or at the end.
              const box = event.currentTarget.getBoundingClientRect();
              const after = vertical ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
              setDropAt(after ? tabs[index + 1]?.id ?? 'end' : tab.id);
            }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropOn(dropAt === 'end' || dropAt === null ? null : dropAt); }}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}>
            <a href={href(tab.route)} draggable={false} aria-current={active ? 'page' : undefined}
              title={vertical ? 'Drag to move · Alt-Shift-↑ ↓ moves it with the keyboard' : 'Drag to move · Alt-Shift-← → moves it with the keyboard'}
              onKeyDown={(event) => {
                const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
                if (!(event.altKey && event.shiftKey) || !keys.includes(event.key)) return;
                event.preventDefault();
                setTabs(shiftTab(state, tab.id, event.key === keys[0] ? -1 : 1));
              }}>
              <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
              <span>{tab.label}</span>
            </a>
            {tabs.length > 1 && (
              <button type="button" className="tab-close" aria-label={`Close the ${tab.label} tab`} title="Close this tab" onClick={() => close(tab.id)}><X size={11} /></button>
            )}
          </span>
        );
      })}
      {dropAt === 'end' && <span className="tab-drop-end" aria-hidden="true" />}
      <span className="tab-add" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="tab-close always" aria-haspopup="menu" aria-expanded={!!menu} aria-label="Reopen or reset tabs, or move the tabs"
          title={closed.length ? `Reopen a closed tab (${closed.length}), or move the tabs` : 'Reset the tabs, or move them'} onClick={(event) => toggleMenu(event.currentTarget)}><Plus size={13} /></button>
        {menu && (
          <div className="tab-menu" role="menu" style={menu}>
            {closed.map((tab) => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} type="button" role="menuitem" onClick={() => { setTabs(reopenTab(state, tab.id)); setMenu(null); go(tab.route); }}>
                  <Icon size={13} aria-hidden="true" /> {tab.label}
                </button>
              );
            })}
            {!closed.length && <p>No closed tabs. × on a tab closes it.</p>}
            <button type="button" role="menuitem" onClick={() => { setTabs(DEFAULT_TABS); setMenu(null); }}><RotateCcw size={13} aria-hidden="true" /> Reset the tabs</button>
            <div role="group" aria-label="Tab position" className="tab-menu-group">
              <span className="tab-menu-label" aria-hidden="true">Tab position</span>
              {TAB_PLACEMENTS.map((place) => (
                <button key={place} type="button" role="menuitemradio" aria-checked={place === tabPlacement} className={place === tabPlacement ? 'checked' : ''}
                  onClick={() => { setTabPlacement(place); setMenu(null); }}>
                  <span className="tab-menu-mark" aria-hidden="true">{place === tabPlacement ? '●' : ''}</span> {PLACE_LABELS[place]}
                </button>
              ))}
            </div>
          </div>
        )}
      </span>
    </nav>
  );
}
