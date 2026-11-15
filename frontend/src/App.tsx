import { useEffect } from 'react';
import { House, LayoutGrid, Lightbulb, Map as MapIcon, Palette, Settings, X } from 'lucide-react';
import { useStore } from './store';
import { href, useRoute, type Route } from './lib/router';
import { HomeView } from './views/HomeView';
import { PlanView } from './views/PlanView';
import { RoomView } from './views/RoomView';
import { ScenesView } from './views/ScenesView';
import { SceneEditor } from './views/SceneEditor';
import { LightsView } from './views/LightsView';
import { SettingsView } from './views/SettingsView';

const NAV: { route: Route; label: string; icon: typeof House; match: Route['view'][] }[] = [
  { route: { view: 'home' }, label: 'Home', icon: House, match: ['home', 'room'] },
  { route: { view: 'plan' }, label: 'Plan', icon: MapIcon, match: ['plan'] },
  { route: { view: 'scenes' }, label: 'Scenes', icon: Palette, match: ['scenes', 'scene'] },
  { route: { view: 'lights' }, label: 'Lights', icon: Lightbulb, match: ['lights'] },
  { route: { view: 'settings' }, label: 'Bridge', icon: Settings, match: ['settings'] },
];

export function App() {
  const route = useRoute();
  const { ready, setup, load, refreshLights, toasts, dismiss, lightsError } = useStore();

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the bridge every 5 seconds while the page is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshLights();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshLights]);

  const view = (() => {
    if (!ready) return <div className="loading">Loading your home…</div>;
    switch (route.view) {
      case 'room':
        return <RoomView name={route.room} tab={route.tab} />;
      case 'scenes':
        return <ScenesView />;
      case 'scene':
        return <SceneEditor id={route.id} />;
      case 'lights':
        return <LightsView />;
      case 'plan':
        return <PlanView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  })();

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <nav className="rail" aria-label="Main">
        <a className="brand" href="#/" aria-label="MyHuey home">
          <LayoutGrid size={22} strokeWidth={1.5} />
        </a>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.match.includes(route.view);
          return (
            <a key={item.label} href={href(item.route)} className={`rail-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={20} strokeWidth={1.5} />
              <span>{item.label}</span>
            </a>
          );
        })}
        <div className={`bridge-dot${setup?.configured && !lightsError ? ' ok' : ''}`} title={setup?.configured ? (lightsError || `Bridge ${setup.bridge.ip}`) : 'No bridge paired'} />
      </nav>
      <main className="main">{view}</main>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.error ? ' error' : ''}`}>
            <span>{toast.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
