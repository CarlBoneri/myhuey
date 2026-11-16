import { useEffect } from 'react';
import { House, LayoutGrid, Lightbulb, Map as MapIcon, Moon, Palette, Settings, Sun, X } from 'lucide-react';
import { THEMES, applyTheme, followSystemTheme, resolveTheme, systemPrefersDark, themeToggle } from './lib/theme';
import { useStore } from './store';
import { href, useRoute, type Route } from './lib/router';
import { HomeView } from './views/HomeView';
import { PlanView } from './views/PlanView';
import { SETUP_SKIPPED_KEY, SetupView } from './views/SetupView';
import { go } from './lib/router';
import { RoomDesigner } from './views/RoomDesigner';
import { RoomWorkbench } from './views/RoomWorkbench';
import { ScenesView } from './views/ScenesView';
import { SceneEditor } from './views/SceneEditor';
import { LightsView } from './views/LightsView';
import { SettingsView } from './views/SettingsView';
import { SandboxBanner } from './components/SandboxBanner';

const NAV: { route: Route; label: string; icon: typeof House; match: Route['view'][] }[] = [
  { route: { view: 'home' }, label: 'Home', icon: House, match: ['home', 'room'] },
  { route: { view: 'studio' }, label: 'Studio', icon: MapIcon, match: ['studio', 'design'] },
  { route: { view: 'scenes' }, label: 'Scenes', icon: Palette, match: ['scenes', 'scene'] },
  { route: { view: 'lights' }, label: 'Lights', icon: Lightbulb, match: ['lights'] },
  { route: { view: 'settings' }, label: 'Settings', icon: Settings, match: ['settings', 'setup'] },
];

export function App() {
  const route = useRoute();
  const { ready, setup, load, refreshLights, toasts, dismiss, lightsError, serverStale, preferences, setPreferences } = useStore();

  const { theme, theme_dark, theme_light } = preferences;
  useEffect(() => {
    const prefs = { theme, theme_dark, theme_light };
    applyTheme(prefs);
    return followSystemTheme(prefs);
  }, [theme, theme_dark, theme_light]);
  const toggle = themeToggle(preferences, systemPrefersDark());
  const next = THEMES.find((t) => t.id === resolveTheme({ ...preferences, ...toggle }, systemPrefersDark()))!;

  useEffect(() => {
    void load();
  }, [load]);

  // First run: with no bridge paired, open the setup wizard once (unless it was skipped).
  useEffect(() => {
    if (!ready || setup?.configured || route.view === 'setup') return;
    let skipped = false;
    try { skipped = localStorage.getItem(SETUP_SKIPPED_KEY) === '1'; } catch { /* storage blocked */ }
    if (!skipped) go({ view: 'setup' });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read the lights from the bridge while the page is visible, as often as the preferences say (0 = never).
  useEffect(() => {
    if (!preferences.poll_seconds) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshLights();
    }, preferences.poll_seconds * 1000);
    return () => clearInterval(timer);
  }, [refreshLights, preferences.poll_seconds]);

  const view = (() => {
    if (!ready) return <div className="loading">Loading your home…</div>;
    switch (route.view) {
      case 'room':
        return <RoomWorkbench name={route.room} />;
      case 'design':
        return <RoomDesigner name={route.room} tab={route.tab} />;
      case 'scenes':
        return <ScenesView />;
      case 'scene':
        return <SceneEditor id={route.id} />;
      case 'studio':
        return <PlanView focus={route.focus} />;
      case 'setup':
        return <SetupView />;
      case 'lights':
        return <LightsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  })();

  return (
    <div className={`shell${preferences.show_light_glow ? '' : ' no-glow'}`}>
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
        <button type="button" className="rail-link theme-toggle" onClick={() => void setPreferences(toggle)}
          aria-label={`Switch to ${next.label}`} title={`Switch to ${next.label}`}>
          {next.kind === 'light' ? <Sun size={20} strokeWidth={1.5} /> : <Moon size={20} strokeWidth={1.5} />}
        </button>
        <div className={`bridge-dot${setup?.configured && !lightsError ? ' ok' : ''}`} title={setup?.configured ? (lightsError || `Bridge ${setup.bridge.ip}`) : 'No bridge paired'} />
      </nav>
      <main className="main">
        {serverStale && (
          <p className="stale-banner" role="alert">
            The MyHuey server is older than this page, so newer features will fail. Stop it and run <code>myhuey serve</code> again.
          </p>
        )}
        {ready && <SandboxBanner />}
        {view}
      </main>
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
