import { describe, expect, it } from 'vitest';
import { parseRoute, href } from './router';
import { nextDesignerKey, pickRoom, resolveStudioRoute, studioRoom, studioViewOf, switchView } from './studio';

const rooms = [{ name: 'Loft' }, { name: 'Office' }, { name: 'Den' }];

describe('which room the Studio opens', () => {
  it('prefers the focused room, then the remembered one, then the first', () => {
    expect(studioRoom(rooms, 'Office', 'Den')).toBe('Den');
    expect(studioRoom(rooms, 'Office')).toBe('Office');
    expect(studioRoom(rooms, 'Office', null)).toBe('Office');
    expect(studioRoom(rooms, null)).toBe('Loft');
  });
  it('skips a room that no longer exists', () => {
    expect(studioRoom(rooms, 'Gone', 'Also gone')).toBe('Loft');
    expect(studioRoom(rooms, 'Office', 'Gone')).toBe('Office');
  });
  it('is null when the home has no rooms', () => {
    expect(studioRoom([], 'Office', 'Den')).toBeNull();
  });
});

describe('the Studio view switch', () => {
  it('names the view each screen is', () => {
    expect(studioViewOf({ view: 'studio' })).toBe('home');
    expect(studioViewOf({ view: 'design', room: 'Den', tab: 'plan' })).toBe('plan');
    expect(studioViewOf({ view: 'design', room: 'Den', tab: '3d' })).toBe('3d');
  });
  it('keeps the room when the view changes', () => {
    expect(switchView('3d', 'photo', { rooms, remembered: 'Office', on: 'Den' })).toEqual({ view: 'design', room: 'Den', tab: 'photo' });
    expect(switchView('plan', 'home', { rooms, remembered: 'Office', on: 'Den' })).toEqual({ view: 'studio', focus: 'Den' });
  });
  it('from the home plan opens the focused room, else the remembered one, else the first', () => {
    expect(switchView('home', '3d', { rooms, remembered: 'Office', on: 'Den' })).toEqual({ view: 'design', room: 'Den', tab: '3d' });
    expect(switchView('home', 'plan', { rooms, remembered: 'Office', on: null })).toEqual({ view: 'design', room: 'Office', tab: 'plan' });
    expect(switchView('home', 'photo', { rooms, remembered: 'Gone', on: null })).toEqual({ view: 'design', room: 'Loft', tab: 'photo' });
  });
  it('stays on the home plan when there is no room to open', () => {
    expect(switchView('home', '3d', { rooms: [], remembered: null, on: null })).toEqual({ view: 'studio' });
    expect(switchView('home', 'home', { rooms, remembered: null, on: null })).toEqual({ view: 'studio' });
  });
});

describe('the room picker', () => {
  it('keeps the view when it picks another room', () => {
    expect(pickRoom('3d', 'Den', 'Office')).toEqual({ view: 'design', room: 'Den', tab: '3d' });
    expect(pickRoom('plan', 'Den', 'Office')).toEqual({ view: 'design', room: 'Den', tab: 'plan' });
    expect(pickRoom('photo', 'Den', 'Office')).toEqual({ view: 'design', room: 'Den', tab: 'photo' });
  });
  it('focuses the room on the home plan, and clears the focus for Whole home', () => {
    expect(pickRoom('home', 'Den', null)).toEqual({ view: 'studio', focus: 'Den' });
    expect(pickRoom('home', null, 'Den')).toEqual({ view: 'studio' });
  });
  it('goes from a room screen to the home plan focused on that room', () => {
    expect(pickRoom('3d', null, 'Office')).toEqual({ view: 'studio', focus: 'Office' });
  });
});

describe('room-less Studio addresses', () => {
  it('parse, and round-trip', () => {
    expect(parseRoute('#/studio/room')).toEqual({ view: 'studio-room', tab: 'plan' });
    expect(parseRoute('#/studio/3d')).toEqual({ view: 'studio-room', tab: '3d' });
    expect(parseRoute('#/studio/photo')).toEqual({ view: 'studio-room', tab: 'photo' });
    for (const tab of ['plan', '3d', 'photo'] as const) expect(parseRoute(href({ view: 'studio-room', tab }))).toEqual({ view: 'studio-room', tab });
  });
  it('leaves the old addresses alone', () => {
    expect(parseRoute('#/studio/room/Office/3d')).toEqual({ view: 'design', room: 'Office', tab: '3d' });
    expect(parseRoute('#/studio')).toEqual({ view: 'studio' });
    expect(parseRoute('#/studio/plan/Den')).toEqual({ view: 'studio', focus: 'Den' });
  });
  it('resolve to the remembered room, else the first, else the home plan', () => {
    const route = { view: 'studio-room', tab: '3d' } as const;
    expect(resolveStudioRoute(route, rooms, 'Office')).toEqual({ view: 'design', room: 'Office', tab: '3d' });
    expect(resolveStudioRoute(route, rooms, null)).toEqual({ view: 'design', room: 'Loft', tab: '3d' });
    expect(resolveStudioRoute(route, [], 'Office')).toEqual({ view: 'studio' });
    expect(resolveStudioRoute({ view: 'home' }, rooms, 'Office')).toEqual({ view: 'home' });
  });
});

describe('the designer survives a rename but not a room switch', () => {
  const start = { n: 3, room: 'Office' };
  it('keeps the key when the room did not change', () => {
    expect(nextDesignerKey(start, 'Office', null)).toBe(start);
  });
  it('keeps the key for a rename the designer made', () => {
    expect(nextDesignerKey(start, 'Study', { from: 'Office', to: 'Study' })).toEqual({ n: 3, room: 'Study' });
  });
  it('gives a fresh key for any other change of room', () => {
    expect(nextDesignerKey(start, 'Den', null)).toEqual({ n: 4, room: 'Den' });
    expect(nextDesignerKey(start, 'Den', { from: 'Office', to: 'Study' })).toEqual({ n: 4, room: 'Den' });
    expect(nextDesignerKey(start, 'Study', { from: 'Loft', to: 'Study' })).toEqual({ n: 4, room: 'Study' });
  });
});
