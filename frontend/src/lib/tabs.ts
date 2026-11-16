// The workspace tabs as the user arranged them: an order, and which are closed. Kept per browser.
import type { Route } from './router';

export type TabId = '3d' | 'home' | 'workbench' | 'studio' | 'scenes' | 'lights' | 'settings' | 'help';
export const ALL_TABS: TabId[] = ['3d', 'home', 'workbench', 'studio', 'scenes', 'lights', 'settings', 'help'];
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
    case 'design': return '3d';
    case 'studio': return 'studio';
    case 'scenes': case 'scene': return 'scenes';
    case 'lights': return 'lights';
    case 'settings': case 'setup': return 'settings';
    case 'help': return 'help';
    default: return 'home';
  }
}
