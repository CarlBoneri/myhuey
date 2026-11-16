// The window tabs, drawn once and placed three ways: in the top bar, in a strip above the prompt
// (both horizontal), or in a rail down one side (vertical). Drag, close, reopen, reset, and the
// keyboard moves all work the same in each; only the axis changes. A rail can also be resized by
// its inner edge and folded to icons. Right-clicking the tabs opens a menu (TabContextMenu).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, X, type LucideIcon } from 'lucide-react';
import { href, go, type Route } from '../lib/router';
import { DEFAULT_TABS, contextOrigin, dragWidth, focusAfterClose, refocusReady, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, RAIL_STEP, clampRail, closeTab, isVertical, moveTab, narrowRailNote, neighbour, reopenTab, settleRail, shiftTab, tabMenuItems, type TabId, type TabMenuItem, type TabPlacement, type TabState } from '../lib/tabs';
import { useUi } from '../uiStore';
import { TabContextMenu } from './TabContextMenu';

export interface Tab { id: TabId; label: string; icon: LucideIcon; route: Route }
const TAB_DRAG = 'application/x-myhuey-tab';
/** Set when the tab menu closes by choice; a render of any strip (a placement change builds a new one) takes it and moves focus. `waitFor` is the tab a close is about to make active: the claim stays until that tab is active (or `at` is too old). */
let refocusAfterMenu: { restore: HTMLElement | null; waitFor: TabId | null; at: number } | null = null;

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

/** Where the right-click menu is open, on which tab (null: the empty part), and what had focus before. */
interface Context { x: number; y: number; tab: TabId | null; restore: HTMLElement | null }

export function TabStrip({ placement, tabs, closed, available, byId, activeTab, state, setTabs }: Props) {
  const { tabPlacement, setTabPlacement, tabRail, setTabRail } = useUi();
  const vertical = isVertical(placement);
  const collapsed = vertical && tabRail.collapsed;
  const [menu, setMenu] = useState<CSSProperties | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [dropAt, setDropAt] = useState<TabId | 'end' | null>(null);
  const dragging = useRef<TabId | null>(null);
  const nav = useRef<HTMLElement>(null);
  const contextRef = useRef<Context | null>(null);
  contextRef.current = context;
  // A menu key that went down on a tab, so the `contextmenu` event that follows is known to be the keyboard's.
  const menuKey = useRef<{ at: number; tab: TabId; el: HTMLElement; timer?: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const shut = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') shut(); };
    window.addEventListener('pointerdown', shut);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', shut); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => { setMenu(null); setContext(null); }, [placement]);

  // The tab you are on stays in view when the strip (or rail) overflows.
  useEffect(() => {
    if (contextRef.current) return; // a scroll now would close the open menu
    const active = nav.current?.querySelector<HTMLElement>('.tab.active');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, placement, collapsed, tabs.length]);

  // After the menu closes (and what it chose has been drawn, even in a strip that was rebuilt elsewhere), put focus back.
  // No dependency list, so it runs after every render: a close that opens the neighbour is drawn twice, and the claim waits for the second.
  useEffect(() => {
    if (!refocusAfterMenu) return;
    const claim = refocusAfterMenu;
    const { restore } = claim;
    const ready = refocusReady(claim, { restore: !!restore?.isConnected }, activeTab, Date.now());
    if (ready === 'wait') return;
    refocusAfterMenu = null;
    if (ready === 'drop') return;
    const area = nav.current;
    const active = area?.querySelector<HTMLElement>('.tab.active a') ?? null;
    const any = area?.querySelector<HTMLElement>('.tab a') ?? null;
    const toggle = area?.querySelector<HTMLElement>('.rail-toggle') ?? null;
    const target = { restore: restore?.isConnected ? restore : null, active, any, toggle };
    const pick = focusAfterClose({ restore: !!target.restore, active: !!active, any: !!any, toggle: !!toggle });
    if (pick !== 'none') target[pick]!.focus();
  });

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
    setContext(null);
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

  // The right-click menu, from the pointer or (Shift+F10, the Menu key) from a focused tab.
  const openContext = (x: number, y: number, tab: TabId | null) => {
    setMenu(null);
    const active = document.activeElement;
    setContext({ x, y, tab, restore: active instanceof HTMLElement && active !== document.body ? active : null });
  };
  const shutContext = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) refocusAfterMenu = { restore: contextRef.current?.restore ?? null, waitFor: null, at: Date.now() };
    setContext(null);
  }, []);
  const choose = (item: TabMenuItem) => {
    const tab = context?.tab ?? null;
    shutContext(true);
    switch (item.kind) {
      case 'close':
        if (tab) {
          // Closing the active tab opens its neighbour; focus waits for that tab, and cannot go back to the tab being closed.
          const to = tab === activeTab && closeTab(state, tab) !== state ? neighbour(state, tab, available) : null;
          if (to && byId.get(to) && refocusAfterMenu) {
            refocusAfterMenu.waitFor = to;
            if (refocusAfterMenu.restore?.closest(`[data-tab="${tab}"]`)) refocusAfterMenu.restore = null;
          }
          close(tab);
        }
        break;
      case 'place': setTabPlacement(item.placement); break;
      case 'rail-fold': setTabRail({ ...tabRail, collapsed: !item.collapsed }); break;
      case 'rail-reset': setTabRail({ width: RAIL_DEFAULT, collapsed: tabRail.collapsed }); break;
      case 'reset-tabs': setTabs(DEFAULT_TABS); break;
    }
  };

  // The rail's inner edge: dragged with the pointer (live, snapping to icons on release), or moved by keys.
  const dragRail = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bar = event.currentTarget;
    // Claim the press: left alone, the browser starts a text selection and then a native drag of a tab, and cancels the resize.
    event.preventDefault();
    bar.focus();
    bar.setPointerCapture(event.pointerId);
    const before = useUi.getState().tabRail;
    const startX = event.clientX;
    let raw = before.width;
    const apply = (move: PointerEvent) => {
      raw = dragWidth(before.width, startX, move.clientX, placement === 'left' ? 'left' : 'right');
      setTabRail({ width: clampRail(raw), collapsed: false });
    };
    const stop = () => {
      bar.removeEventListener('pointermove', apply); bar.removeEventListener('pointerup', stop); bar.removeEventListener('pointercancel', stop);
      setTabRail(settleRail(raw, before));
    };
    bar.addEventListener('pointermove', apply);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  };
  const railKey = (event: React.KeyboardEvent) => {
    // The edge faces the content: for a left rail, right widens it; for a right rail, left does.
    const wider = placement === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const narrower = placement === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const width = tabRail.width;
    const next = event.key === wider ? width + RAIL_STEP : event.key === narrower ? width - RAIL_STEP
      : event.key === 'Home' ? RAIL_MIN : event.key === 'End' ? RAIL_MAX : null;
    if (next === null) return;
    event.preventDefault();
    setTabRail({ width: clampRail(next), collapsed: false });
  };

  const strip = (
    <nav ref={nav} className={`tabs ${placement}${vertical ? ' rail' : ''}${collapsed ? ' collapsed' : ''}`} aria-label="Main"
      onPointerDown={() => { if (menuKey.current) { window.clearTimeout(menuKey.current.timer); menuKey.current = null; } }}
      onContextMenu={(event) => {
        event.preventDefault();
        const key = menuKey.current;
        if (key && contextOrigin(key.at, Date.now()) === 'keyboard') {
          // From a menu key: anchor to the focused tab, whatever coordinates the browser put on the event.
          window.clearTimeout(key.timer);
          menuKey.current = null;
          const box = key.el.getBoundingClientRect();
          openContext(box.left + 8, box.bottom, key.tab);
          return;
        }
        const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
        openContext(event.clientX, event.clientY, (hit?.dataset.tab as TabId | undefined) ?? null);
      }}
      onDragOver={(event) => { if (dragging.current) { event.preventDefault(); setDropAt('end'); } }}
      onDrop={(event) => { event.preventDefault(); dropOn(null); }}>
      {vertical && (
        <button type="button" className={`rail-toggle ${placement}`} aria-expanded={!collapsed}
          aria-label="Tabs" title={collapsed ? 'Expand the tab rail' : 'Collapse the tab rail to icons'}
          onClick={() => setTabRail({ ...tabRail, collapsed: !collapsed })}>
          {collapsed ? <PanelLeftOpen size={14} aria-hidden="true" /> : <PanelLeftClose size={14} aria-hidden="true" />}
          {!collapsed && <span>Tabs</span>}
        </button>
      )}
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        return (
          <span key={tab.id} data-tab={tab.id} className={`tab${active ? ' active' : ''}${dropAt === tab.id ? ' drop-before' : ''}`} draggable
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
              aria-label={collapsed ? tab.label : undefined}
              title={collapsed ? tab.label : vertical ? 'Drag to move · Alt-Shift-↑ ↓ moves it with the keyboard' : 'Drag to move · Alt-Shift-← → moves it with the keyboard'}
              onKeyUp={(event) => {
                const key = menuKey.current;
                if (!key || !(event.key === 'ContextMenu' || event.key === 'F10')) return;
                // A browser that fires `contextmenu` has done so by now (and cleared the key); one that does not gets the menu here.
                key.timer = window.setTimeout(() => {
                  if (menuKey.current !== key) return;
                  menuKey.current = null;
                  const box = key.el.getBoundingClientRect();
                  openContext(box.left + 8, box.bottom, key.tab);
                }, 80);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  // Not opened here: the browser follows with a `contextmenu` event (handled once, on the nav).
                  // Where it does not, the key coming back up opens the menu.
                  menuKey.current = { at: Date.now(), tab: tab.id, el: event.currentTarget };
                  return;
                }
                const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
                if (!(event.altKey && event.shiftKey) || !keys.includes(event.key)) return;
                event.preventDefault();
                setTabs(shiftTab(state, tab.id, event.key === keys[0] ? -1 : 1));
              }}>
              <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
              <span>{tab.label}</span>
            </a>
            {tabs.length > 1 && !collapsed && (
              <button type="button" className="tab-close" aria-label={`Close the ${tab.label} tab`} title="Close this tab" onClick={() => close(tab.id)}><X size={11} /></button>
            )}
          </span>
        );
      })}
      {dropAt === 'end' && <span className="tab-drop-end" aria-hidden="true" />}
      <span className="tab-add" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="tab-close always" aria-haspopup="menu" aria-expanded={!!menu} aria-label="Reopen or reset tabs"
          title={closed.length ? `Reopen a closed tab (${closed.length}), or reset the tabs` : 'Reset the tabs'} onClick={(event) => toggleMenu(event.currentTarget)}><Plus size={13} /></button>
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
          </div>
        )}
      </span>
      {context && (
        <TabContextMenu at={{ x: context.x, y: context.y }} note={narrowRailNote(tabPlacement, isVertical(tabPlacement) && !vertical)} onClose={shutContext} onChoose={choose}
          items={tabMenuItems({ closable: context.tab !== null && tabs.length > 1, tabPlacement, drawnAsRail: vertical, rail: tabRail })} />
      )}
    </nav>
  );

  if (!vertical) return strip;
  return (
    <div className={`rail-shell ${placement}${collapsed ? ' collapsed' : ''}`}>
      {strip}
      {!collapsed && (
        <div className={`splitter col rail-handle ${placement}`} role="separator" aria-orientation="vertical" aria-label="Resize the tab rail" tabIndex={0}
          aria-valuemin={RAIL_MIN} aria-valuemax={RAIL_MAX} aria-valuenow={tabRail.width}
          title="Drag to resize · drag narrow to fold to icons · double-click to reset" onPointerDown={dragRail} onKeyDown={railKey}
          onDoubleClick={() => setTabRail({ width: RAIL_DEFAULT, collapsed: false })}><span /></div>
      )}
    </div>
  );
}
