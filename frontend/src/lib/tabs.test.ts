import { describe, expect, it } from 'vitest';
import { contextOrigin, focusAfterClose, refocusReady, REFOCUS_WINDOW, type TabId, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, RAIL_SNAP, tabMenuItems, clampRail, normalizeRail, settleRail, ALL_TABS, DEFAULT_TABS, TAB_PLACEMENTS, closeTab, isVertical, normalizePlacement, moveTab, neighbour, normalizeTabs, openTabs, reopenTab, shiftTab, tabForRoute, type TabState } from './tabs';

const state = (order: string, closed = ''): TabState => normalizeTabs({ order: order.split(' ').filter(Boolean), closed: closed.split(' ').filter(Boolean) });

describe('saved tabs', () => {
  it('survive anything that was stored', () => {
    for (const junk of [null, 'x', 7, [], { order: 'home' }, { order: [1, 'nope'], closed: {} }]) expect(normalizeTabs(junk)).toEqual(DEFAULT_TABS);
  });
  it('keep the saved order, drop unknown tabs, and add new ones at the end', () => {
    const tabs = normalizeTabs({ order: ['scenes', 'gone', 'home', 'scenes'], closed: ['home', 'gone', 'home'] });
    expect(tabs.order.slice(0, 2)).toEqual(['scenes', 'home']);
    expect([...tabs.order].sort()).toEqual([...ALL_TABS].sort());
    expect(tabs.closed).toEqual(['home']);
  });
  it('never come back with every tab closed', () => {
    expect(normalizeTabs({ order: ALL_TABS, closed: ALL_TABS }).closed).toEqual([]);
  });
});

describe('rearranging', () => {
  const tabs = state('home scenes lights settings');
  it('moves a tab before another, or to the end', () => {
    expect(moveTab(tabs, 'settings', 'home').order.slice(0, 4)).toEqual(['settings', 'home', 'scenes', 'lights']);
    expect(moveTab(tabs, 'home', null).order.at(-1)).toBe('home');
    expect(moveTab(tabs, 'home', 'home')).toBe(tabs);
  });
  it('shifts one place among the open tabs, skipping closed ones, and stops at the ends', () => {
    const some = closeTab(tabs, 'scenes');
    expect(openTabs(shiftTab(some, 'home', 1)).slice(0, 2)).toEqual(['lights', 'home']);
    expect(openTabs(shiftTab(some, 'lights', -1)).slice(0, 2)).toEqual(['lights', 'home']);
    expect(shiftTab(some, 'home', -1)).toBe(some);
    const last = openTabs(some).at(-1)!;
    expect(shiftTab(some, last, 1)).toBe(some);
  });
});

describe('closing and reopening', () => {
  it('closes, reopens in the same place, and keeps the last tab open', () => {
    const tabs = state('home scenes lights');
    const closed = closeTab(tabs, 'scenes');
    expect(openTabs(closed)).not.toContain('scenes');
    expect(openTabs(reopenTab(closed, 'scenes')).slice(0, 3)).toEqual(['home', 'scenes', 'lights']);
    let one = tabs;
    for (const id of ALL_TABS) one = closeTab(one, id);
    expect(openTabs(one)).toHaveLength(1);
  });
  it('picks the tab to the right after a close, else the one to the left', () => {
    const tabs = state('home scenes lights');
    expect(neighbour(tabs, 'home')).toBe('scenes');
    expect(neighbour(tabs, openTabs(tabs).at(-1)!)).toBe(openTabs(tabs).at(-2));
    expect(neighbour(tabs, 'home', ['home', 'lights'])).toBe('lights'); // room tabs can be unavailable
  });
});

it('every screen has a tab', () => {
  expect(tabForRoute({ view: 'design', room: 'Office', tab: 'plan' })).toBe('3d');
  expect(tabForRoute({ view: 'studio-room', tab: '3d' })).toBe('3d');
  expect(tabForRoute({ view: 'studio' })).toBe('studio');
  expect(tabForRoute({ view: 'design', room: 'Office', tab: '3d' })).toBe('3d');
  expect(tabForRoute({ view: 'room', room: 'Office' })).toBe('workbench');
  expect(tabForRoute({ view: 'scene', id: 's' })).toBe('scenes');
  expect(tabForRoute({ view: 'setup' })).toBe('settings');
  expect(tabForRoute({ view: 'help' })).toBe('help');
  expect(tabForRoute({ view: 'home' })).toBe('home');
});

describe('tab placement', () => {
  it('lists the four places in order', () => {
    expect(TAB_PLACEMENTS).toEqual(['top', 'bottom', 'left', 'right']);
  });
  it('reads anything that is not a place as top', () => {
    for (const place of TAB_PLACEMENTS) expect(normalizePlacement(place)).toBe(place);
    for (const junk of [null, undefined, 7, {}, [], 'Left', 'middle', '', ['left']]) expect(normalizePlacement(junk)).toBe('top');
  });
  it('knows which places are rails', () => {
    expect(TAB_PLACEMENTS.filter(isVertical)).toEqual(['left', 'right']);
  });
});

describe('the tab rail', () => {
  const standard = { width: RAIL_DEFAULT, collapsed: false };
  it('has the limits the owner set', () => {
    expect([RAIL_MIN, RAIL_DEFAULT, RAIL_MAX, RAIL_SNAP]).toEqual([150, 210, 420, 110]);
  });
  it('reads anything that was stored as a safe rail', () => {
    for (const junk of [null, undefined, 'x', 7, [], {}, { width: 'wide' }, { width: NaN }, { width: Infinity }]) expect(normalizeRail(junk)).toEqual(standard);
    expect(normalizeRail({ width: 300, collapsed: true })).toEqual({ width: 300, collapsed: true });
    expect(normalizeRail({ width: 10 })).toEqual({ width: RAIL_MIN, collapsed: false });
    expect(normalizeRail({ width: 9000 })).toEqual({ width: RAIL_MAX, collapsed: false });
    expect(normalizeRail({ width: 250.6, collapsed: 'yes' })).toEqual({ width: 251, collapsed: false });
  });
  it('clamps a width', () => {
    expect([clampRail(0), clampRail(200), clampRail(1000), clampRail(NaN)]).toEqual([RAIL_MIN, 200, RAIL_MAX, RAIL_DEFAULT]);
  });
  it('snaps to collapsed when dragged narrower than the snap width, and remembers the old width', () => {
    expect(settleRail(109, { width: 260, collapsed: false })).toEqual({ width: 260, collapsed: true });
    expect(settleRail(110, { width: 260, collapsed: false })).toEqual({ width: RAIL_MIN, collapsed: false });
    expect(settleRail(130, { width: 260, collapsed: false })).toEqual({ width: RAIL_MIN, collapsed: false });
    expect(settleRail(300, { width: 260, collapsed: false })).toEqual({ width: 300, collapsed: false });
    expect(settleRail(999, { width: 260, collapsed: false })).toEqual({ width: RAIL_MAX, collapsed: false });
  });
});

describe('where focus goes when the tab menu closes', () => {
  const all = { restore: true, active: true, any: true, toggle: true };
  it('goes back to where it was while that is still on the page', () => {
    expect(focusAfterClose(all)).toBe('restore');
  });
  it('falls back to the active tab, then any tab, then the rail toggle', () => {
    expect(focusAfterClose({ ...all, restore: false })).toBe('active');
    expect(focusAfterClose({ ...all, restore: false, active: false })).toBe('any');
    expect(focusAfterClose({ restore: false, active: false, any: false, toggle: true })).toBe('toggle');
    expect(focusAfterClose({ restore: false, active: false, any: false, toggle: false })).toBe('none');
  });
});

describe('what opened the context menu', () => {
  it('is the keyboard when a menu key went down a moment ago, else the pointer', () => {
    expect(contextOrigin(1000, 1200)).toBe('keyboard');
    expect(contextOrigin(1000, 5000)).toBe('pointer');
    expect(contextOrigin(null, 1000)).toBe('pointer');
  });
});

describe('the right-click menu on the tabs', () => {
  const rail = { width: 210, collapsed: false };
  const kinds = (items: ReturnType<typeof tabMenuItems>) => items.map((item) => item.kind);
  it('offers close only on a tab that can be closed, and position always', () => {
    const on = tabMenuItems({ closable: true, tabPlacement: 'top', drawnAsRail: false, rail });
    expect(kinds(on)).toEqual(['close', 'place', 'place', 'place', 'place', 'reset-tabs']);
    expect(kinds(tabMenuItems({ closable: false, tabPlacement: 'top', drawnAsRail: false, rail }))).not.toContain('close');
  });
  it('lists the four places in order and marks the current one', () => {
    const places = tabMenuItems({ closable: false, tabPlacement: 'left', drawnAsRail: false, rail }).filter((item) => item.kind === 'place');
    expect(places).toEqual([
      { kind: 'place', placement: 'top', checked: false }, { kind: 'place', placement: 'bottom', checked: false },
      { kind: 'place', placement: 'left', checked: true }, { kind: 'place', placement: 'right', checked: false },
    ]);
  });
  it('offers the rail items only when the tabs are drawn as a rail, in the right state', () => {
    const items = tabMenuItems({ closable: true, tabPlacement: 'left', drawnAsRail: true, rail: { width: 300, collapsed: true } });
    expect(kinds(items)).toEqual(['close', 'place', 'place', 'place', 'place', 'rail-fold', 'rail-reset', 'reset-tabs']);
    expect(items.find((item) => item.kind === 'rail-fold')).toEqual({ kind: 'rail-fold', collapsed: true });
    // saved as left in a narrow window: drawn at the top, so no rail items
    expect(kinds(tabMenuItems({ closable: false, tabPlacement: 'left', drawnAsRail: false, rail }))).not.toContain('rail-fold');
  });
});

describe('refocusReady', () => {
  const claim = { waitFor: 'scenes' as TabId, at: 1000 };
  it('places focus now when nothing is awaited', () => {
    expect(refocusReady({ waitFor: null, at: 1000 }, { restore: false }, 'home', 1001)).toBe('now');
  });
  it('places focus now when what had focus before can take it back', () => {
    expect(refocusReady(claim, { restore: true }, 'home', 1001)).toBe('now');
  });
  it('waits while the awaited tab is not yet the active one', () => {
    expect(refocusReady(claim, { restore: false }, 'home', 1001)).toBe('wait');
  });
  it('places focus once the awaited tab is active', () => {
    expect(refocusReady(claim, { restore: false }, 'scenes', 1200)).toBe('now');
  });
  it('gives up on an expired claim even if the awaited tab is active by then', () => {
    expect(refocusReady(claim, { restore: false }, 'scenes', 1000 + REFOCUS_WINDOW + 1)).toBe('drop');
  });
  it('gives up when the awaited tab has not arrived within the window', () => {
    expect(refocusReady(claim, { restore: false }, 'home', 1000 + REFOCUS_WINDOW + 1)).toBe('drop');
  });
});
