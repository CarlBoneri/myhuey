import { describe, expect, it } from 'vitest';
import { ALL_TABS, DEFAULT_TABS, closeTab, moveTab, neighbour, normalizeTabs, openTabs, reopenTab, shiftTab, tabForRoute, type TabState } from './tabs';

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
  expect(tabForRoute({ view: 'room', room: 'Office' })).toBe('workbench');
  expect(tabForRoute({ view: 'scene', id: 's' })).toBe('scenes');
  expect(tabForRoute({ view: 'setup' })).toBe('settings');
  expect(tabForRoute({ view: 'help' })).toBe('help');
  expect(tabForRoute({ view: 'home' })).toBe('home');
});
