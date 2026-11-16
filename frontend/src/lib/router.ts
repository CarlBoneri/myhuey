import { useEffect, useState } from 'react';

export type DesignTab = 'plan' | '3d' | 'photo';

export type Route =
  | { view: 'home' }
  /** A room's workbench: use and tune it. */
  | { view: 'room'; room: string }
  /** The whole-home floor plan; `focus` selects a room for reshaping. */
  | { view: 'studio'; focus?: string }
  /** One room's designer in the Studio: outline, furniture, light placement, photo. */
  | { view: 'design'; room: string; tab: DesignTab }
  | { view: 'setup' }
  | { view: 'scenes' }
  | { view: 'scene'; id: string }
  | { view: 'lights' }
  | { view: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [first, second, third, fourth] = parts;
  if (first === 'room' && second) {
    // Old links: the room page's photo tab now lives in the Studio.
    return third === 'photo' ? { view: 'design', room: second, tab: 'photo' } : { view: 'room', room: second };
  }
  if (first === 'studio') {
    if (second === 'room' && third) return { view: 'design', room: third, tab: fourth === 'photo' || fourth === '3d' ? fourth : 'plan' };
    if (second === 'plan' && third) return { view: 'studio', focus: third };
    return { view: 'studio' };
  }
  if (first === 'plan') return second ? { view: 'studio', focus: second } : { view: 'studio' };
  if (first === 'scenes' && second) return { view: 'scene', id: second };
  if (first === 'scenes') return { view: 'scenes' };
  if (first === 'lights') return { view: 'lights' };
  if (first === 'setup') return { view: 'setup' };
  if (first === 'settings') return second === 'lights' ? { view: 'lights' } : { view: 'settings' };
  return { view: 'home' };
}

const part = encodeURIComponent;

export function href(route: Route): string {
  switch (route.view) {
    case 'room':
      return `#/room/${part(route.room)}`;
    case 'design':
      return `#/studio/room/${part(route.room)}${route.tab === 'plan' ? '' : `/${route.tab}`}`;
    case 'studio':
      return route.focus ? `#/studio/plan/${part(route.focus)}` : '#/studio';
    case 'scene':
      return `#/scenes/${part(route.id)}`;
    case 'home':
      return '#/';
    default:
      return `#/${route.view}`;
  }
}

export const go = (route: Route) => {
  window.location.hash = href(route);
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
