// The workspace tabs as the user arranged them: an order, and which are closed. Kept per browser.
import type { Route } from './router';

export type TabId = '3d' | 'home' | 'workbench' | 'studio' | 'desks' | 'scenes' | 'lights' | 'settings' | 'help';
export const ALL_TABS: TabId[] = ['3d', 'home', 'workbench', 'studio', 'desks', 'scenes', 'lights', 'settings', 'help'];
export interface TabState { order: TabId[]; closed: TabId[] }
export const DEFAULT_TABS: TabState = { order: ALL_TABS, closed: [] };

const known = (value: unknown): value is TabId => ALL_TABS.includes(value as TabId);
const unique = (list: TabId[]) => list.filter((id, index) => list.indexOf(id) === index);

/** Saved tabs made safe: unknown tabs dropped, new ones added at the end, never all closed. */
export function normalizeTabs(saved: unknown): TabState {
  const raw = (saved && typeof saved === 'object' ? saved : {}) as { order?: unknown; closed?: unknown };
  const order = unique(Array.isArray(raw.order) ? raw.order.filter(known) : []);
  for (const id of ALL_TABS) if (!order.includes(id)) order.push(id);
  let closed = unique(Array.isArray(raw.closed) ? raw.closed.filter(known) : []);
  if (closed.length >= order.length) closed = [];
  return { order, closed };
}

/** Where the tabs sit: in the top bar, in a strip above the prompt, or in a rail down one side. */
export type TabPlacement = 'top' | 'bottom' | 'left' | 'right';
export const TAB_PLACEMENTS: TabPlacement[] = ['top', 'bottom', 'left', 'right'];

/** A saved placement made safe: anything that is not one of the four is top. */
export const normalizePlacement = (value: unknown): TabPlacement =>
  TAB_PLACEMENTS.find((place) => place === value) ?? 'top';

/** Rails run down the side; their tabs stack, so they move along the vertical axis. */
export const isVertical = (placement: TabPlacement): boolean => placement === 'left' || placement === 'right';

export const PLACE_LABELS: Record<TabPlacement, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };

/** Below this width a rail has no room beside the content, so it is drawn in the top bar instead. */
export const NARROW_QUERY = '(max-width: 719.98px)';
export const isNarrowWindow = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;

/** The one sentence that says a saved side rail is drawn at the top for now; null when the tabs are where they were saved. */
export function narrowRailNote(saved: TabPlacement, narrow: boolean): string | null {
  if (!narrow || !isVertical(saved)) return null;
  return `This window is too narrow for a side rail, so the tabs are at the top for now. ${PLACE_LABELS[saved]} is saved and applies when the window is wider.`;
}

/** The reply to `tabs <place>`: the placement, and the narrow-window note when a saved side rail is drawn at the top. */
export function tabsPlaceReply(placement: TabPlacement, narrow: boolean): string {
  const note = narrowRailNote(placement, narrow);
  return note ? `Tabs: ${placement}. ${note}` : `Tabs: ${placement}`;
}

/** The reply to a tab-rail command: what the rail is now, and, when it is not showing, the true reason why. */
export function tabsRailReply(said: string, placement: TabPlacement, narrow: boolean): string {
  if (!isVertical(placement)) return `${said}, saved. It applies when the tabs are on the left or right.`;
  return narrow ? `${said}, saved. ${narrowRailNote(placement, narrow)}` : said;
}

export const openTabs = (state: TabState): TabId[] => state.order.filter((id) => !state.closed.includes(id));

/** Move a tab to sit just before another, or to the end when `before` is null. */
export function moveTab(state: TabState, id: TabId, before: TabId | null): TabState {
  if (id === before) return state;
  const order = state.order.filter((item) => item !== id);
  const at = before === null ? order.length : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, id);
  return { ...state, order };
}

/** Move a tab one place left (-1) or right (1) among the open tabs. */
export function shiftTab(state: TabState, id: TabId, direction: -1 | 1): TabState {
  const open = openTabs(state);
  const from = open.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= open.length) return state;
  // Moving right means sitting before the tab after the neighbour (or at the end).
  return moveTab(state, id, direction === -1 ? open[to] : open[to + 1] ?? null);
}

/** Close a tab. The last open tab stays. */
export function closeTab(state: TabState, id: TabId): TabState {
  if (state.closed.includes(id) || openTabs(state).length <= 1) return state;
  return { ...state, closed: [...state.closed, id] };
}

export const reopenTab = (state: TabState, id: TabId): TabState =>
  state.closed.includes(id) ? { ...state, closed: state.closed.filter((item) => item !== id) } : state;

/** The tab to show after closing `id`: the one to its right, else the one to its left. */
export function neighbour(state: TabState, id: TabId, available: TabId[] = ALL_TABS): TabId | null {
  const open = openTabs(state).filter((item) => available.includes(item));
  const at = open.indexOf(id);
  if (at < 0) return open[0] ?? null;
  return open[at + 1] ?? open[at - 1] ?? null;
}

/** Which tab a screen belongs to. */
export function tabForRoute(route: Route): TabId {
  switch (route.view) {
    case 'room': return 'workbench';
    case 'design': case 'studio-room': return '3d';
    case 'studio': return 'studio';
    case 'desks': case 'desk-set': return 'desks';
    case 'scenes': case 'scene': return 'scenes';
    case 'lights': return 'lights';
    case 'settings': case 'setup': return 'settings';
    case 'help': return 'help';
    default: return 'home';
  }
}

/** The tab rail (tabs on the left or right): how wide it is, and whether it is folded to icons. */
export interface TabRail { width: number; collapsed: boolean }
export const RAIL_MIN = 150;
export const RAIL_MAX = 420;
export const RAIL_DEFAULT = 210;
/** Dragging the rail narrower than this and letting go folds it to icons. */
export const RAIL_SNAP = 110;
/** The width of the icon-only rail. */
export const RAIL_ICONS = 48;
/** What an arrow key on the rail's handle moves it by. */
export const RAIL_STEP = 16;

export const clampRail = (width: number): number =>
  Number.isFinite(width) ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width))) : RAIL_DEFAULT;

/** A saved rail made safe: anything unreadable is the standard open rail, and the width stays in range. */
export function normalizeRail(saved: unknown): TabRail {
  const raw = (saved && typeof saved === 'object' ? saved : {}) as { width?: unknown; collapsed?: unknown };
  return { width: typeof raw.width === 'number' ? clampRail(raw.width) : RAIL_DEFAULT, collapsed: raw.collapsed === true };
}

/** Where a drag of the rail's edge ends: too narrow folds it (and keeps the width it had), otherwise it opens at the clamped width. */
export function settleRail(dragged: number, before: TabRail): TabRail {
  return dragged < RAIL_SNAP ? { width: before.width, collapsed: true } : { width: clampRail(dragged), collapsed: false };
}

/** The rail's width while its handle is dragged: the width it had, plus how far the pointer has moved toward the page. */
export function dragWidth(startWidth: number, startX: number, x: number, side: 'left' | 'right'): number {
  return side === 'left' ? startWidth + (x - startX) : startWidth - (x - startX);
}

/** After the tab menu closes: back where focus was, else the active tab, any tab, or the rail toggle. */
export function focusAfterClose(has: { restore: boolean; active: boolean; any: boolean; toggle: boolean }): 'restore' | 'active' | 'any' | 'toggle' | 'none' {
  return has.restore ? 'restore' : has.active ? 'active' : has.any ? 'any' : has.toggle ? 'toggle' : 'none';
}

/** How long a focus claim waits for the tab that is about to become active before it gives up. */
export const REFOCUS_WINDOW = 1500;
/** Closing the active tab opens its neighbour, but the app only learns that on a later `hashchange`: wait for it, so focus lands on the tab that became active. */
export function refocusReady(claim: { waitFor: TabId | null; at: number }, has: { restore: boolean }, activeTab: TabId, now: number): 'now' | 'wait' | 'drop' {
  // A claim that waited too long is dropped even if its tab is active by now, or focus would be pulled there later.
  if (claim.waitFor !== null && now - claim.at > REFOCUS_WINDOW) return 'drop';
  return claim.waitFor === null || has.restore || activeTab === claim.waitFor ? 'now' : 'wait';
}

/** How long after a menu key goes down a `contextmenu` event still counts as coming from it. */
export const MENU_KEY_WINDOW = 1500;
/** A `contextmenu` event has no reliable sign of where it came from, so the key press that came before it says. */
export const contextOrigin = (keyDownAt: number | null, now: number): 'keyboard' | 'pointer' =>
  keyDownAt !== null && now - keyDownAt <= MENU_KEY_WINDOW ? 'keyboard' : 'pointer';

/** What the right-click menu on the tabs offers, in order. */
export type TabMenuItem =
  | { kind: 'close' }
  | { kind: 'place'; placement: TabPlacement; checked: boolean }
  | { kind: 'rail-fold'; collapsed: boolean }
  | { kind: 'rail-reset' }
  | { kind: 'reset-tabs' };

export function tabMenuItems(ctx: { closable: boolean; tabPlacement: TabPlacement; drawnAsRail: boolean; rail: TabRail }): TabMenuItem[] {
  return [
    ...(ctx.closable ? [{ kind: 'close' } as const] : []),
    ...TAB_PLACEMENTS.map((placement): TabMenuItem => ({ kind: 'place', placement, checked: placement === ctx.tabPlacement })),
    ...(ctx.drawnAsRail ? [{ kind: 'rail-fold', collapsed: ctx.rail.collapsed } as const, { kind: 'rail-reset' } as const] : []),
    { kind: 'reset-tabs' },
  ];
}
