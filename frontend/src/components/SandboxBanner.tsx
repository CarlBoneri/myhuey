// Shown on every screen while a sandbox is open, so it's never mistaken for the Active home.
import { FlaskConical } from 'lucide-react';
import { api } from '../api';
import { attempt, useStore } from '../store';

export function SandboxBanner() {
  const { layout, layouts, openLayout, toast } = useStore();
  if (!layout) return null;
  const name = layouts.find((item) => item.id === layout)?.name ?? 'Sandbox';
  return (
    <div className="sandbox-banner" role="status">
      <FlaskConical size={16} strokeWidth={1.6} aria-hidden="true" />
      <span>Sandbox: <strong>{name}</strong>, not active</span>
      <div className="button-row">
        <button type="button" className="button primary" onClick={async () => {
          if (await attempt(() => api.activateLayout(layout))) {
            await openLayout(null);
            toast(`${name} is now active`, false);
          }
        }}>Make active</button>
        <button type="button" className="button subtle" onClick={() => openLayout(null)}>Back to Active</button>
      </div>
    </div>
  );
}
