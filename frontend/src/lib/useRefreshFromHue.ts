import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { attempt, useStore } from '../store';
import type { RefreshPlan } from '../types';

/** Refresh from Hue on the floor plan: read a preview, then apply exactly what was shown.
 *  A preview belongs to the layout it was read in, so opening another layout drops it. */
export function useRefreshFromHue() {
  const { refreshRooms, toast, layout } = useStore();
  const [plan, setPlan] = useState<RefreshPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const openLayout = useRef(layout);
  useEffect(() => {
    if (openLayout.current === layout) return;
    openLayout.current = layout;
    setPlan(null);
  }, [layout]);

  // A preview that comes back after another layout was opened is not shown.
  const showPreview = async () => {
    const askedIn = openLayout.current;
    const preview = await attempt(() => api.refreshPreview());
    if (preview && openLayout.current === askedIn) setPlan(preview);
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const applied = await api.refreshApply(plan.fingerprint);
      const names = applied.rooms.filter((r) => r.status === 'new' || r.status === 'changed').map((r) => r.room);
      toast(names.length ? `Refreshed ${names.join(', ')}` : 'Rooms linked to Hue.', false);
      await refreshRooms();
      setPlan(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not refresh from Hue.', true);
      // Hue changed since the preview: show the new one so the person looks again.
      if (error instanceof ApiError && error.status === 409) await showPreview();
    } finally {
      setBusy(false);
    }
  };

  return { plan, busy, preview: showPreview, apply, cancel: () => setPlan(null) };
}
