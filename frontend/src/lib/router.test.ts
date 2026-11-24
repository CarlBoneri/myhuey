import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from './router';

describe('routes', () => {
  it('parses home, the workbench, the studio, the designer and settings', () => {
    expect(parseRoute('#/')).toEqual({ view: 'home' });
    expect(parseRoute('#/room/Office')).toEqual({ view: 'room', room: 'Office' });
    expect(parseRoute('#/studio')).toEqual({ view: 'studio' });
    expect(parseRoute('#/studio/plan/Living%20room')).toEqual({ view: 'studio', focus: 'Living room' });
    expect(parseRoute('#/studio/room/Office')).toEqual({ view: 'design', room: 'Office', tab: 'plan' });
    expect(parseRoute('#/studio/room/Office/photo')).toEqual({ view: 'design', room: 'Office', tab: 'photo' });
    expect(parseRoute('#/studio/room/Office/3d')).toEqual({ view: 'design', room: 'Office', tab: '3d' });
    expect(href({ view: 'design', room: 'Office', tab: '3d' })).toBe('#/studio/room/Office/3d');
    expect(parseRoute('#/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#/lights')).toEqual({ view: 'lights' });
  });

  it('sends old links to their new screens', () => {
    expect(parseRoute('#/plan')).toEqual({ view: 'studio' });
    expect(parseRoute('#/plan/Den')).toEqual({ view: 'studio', focus: 'Den' });
    expect(parseRoute('#/room/Den/photo')).toEqual({ view: 'design', room: 'Den', tab: 'photo' });
    expect(parseRoute('#/room/Den/plan')).toEqual({ view: 'room', room: 'Den' });
    expect(parseRoute('#/settings/lights')).toEqual({ view: 'lights' });
  });

  it('round-trips awkward room names', () => {
    const routes: Route[] = [
      { view: 'design', room: 'A/B c', tab: 'photo' }, { view: 'design', room: 'Den', tab: 'plan' },
      { view: 'studio', focus: 'A/B' }, { view: 'studio' }, { view: 'room', room: '50% room' },
      { view: 'lights' }, { view: 'settings' }, { view: 'home' }, { view: 'scene', id: 'x1' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
  });

  it('addresses the desk designer, a design in it, and a placed desk set', () => {
    expect(parseRoute('#/studio/desks')).toEqual({ view: 'desks' });
    expect(parseRoute('#/studio/desks/abc')).toEqual({ view: 'desks', design: 'abc' });
    expect(parseRoute('#/studio/room/My%20Office/set/s1')).toEqual({ view: 'desk-set', room: 'My Office', set: 's1' });
    for (const route of [{ view: 'desks' }, { view: 'desks', design: 'abc' }, { view: 'desk-set', room: 'My Office', set: 's1' }] as Route[]) {
      expect(parseRoute(href(route))).toEqual(route);
    }
  });
});
