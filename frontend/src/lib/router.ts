import { useEffect, useState } from 'react';

export type Route =
  | { view: 'home' }
  | { view: 'room'; room: string; tab: 'plan' | 'photo' }
  | { view: 'scenes' }
  | { view: 'scene'; id: string }
  | { view: 'lights' }
  | { view: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'room' && parts[1]) return { view: 'room', room: parts[1], tab: parts[2] === 'photo' ? 'photo' : 'plan' };
  if (parts[0] === 'scenes' && parts[1]) return { view: 'scene', id: parts[1] };
  if (parts[0] === 'scenes') return { view: 'scenes' };
  if (parts[0] === 'lights') return { view: 'lights' };
  if (parts[0] === 'settings') return { view: 'settings' };
  return { view: 'home' };
}

export function href(route: Route): string {
  switch (route.view) {
    case 'room':
      return `#/room/${encodeURIComponent(route.room)}${route.tab === 'photo' ? '/photo' : ''}`;
    case 'scene':
      return `#/scenes/${encodeURIComponent(route.id)}`;
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
