import { useEffect, useState } from 'react';
import { NARROW_QUERY, isNarrowWindow } from './tabs';

/** True while the window is too narrow for a side rail. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrowWindow);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}
