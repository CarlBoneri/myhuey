import { useEffect, useState, type CSSProperties } from 'react';
import { Box, CircleHelp, Command, House, Lightbulb, Map as MapIcon, Palette, Settings, SlidersHorizontal, Sparkles, Terminal, X } from 'lucide-react';
import { applyTheme, applyTransparency, followSystemTheme, normalizeTheme, themeGroups, type Theme } from './lib/theme';
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
import { HelpView } from './views/HelpView';
import { topicFor } from './lib/helpDocs';
import { resolveStudioRoute, studioRoom } from './lib/studio';
import { RAIL_ICONS, isVertical, openTabs, reopenTab, tabForRoute, type TabId, type TabPlacement } from './lib/tabs';
import { TabStrip, type Tab } from './components/TabStrip';
import { SandboxBanner } from './components/SandboxBanner';
import { PromptBar } from './components/PromptBar';
import { CommandPalette } from './components/CommandPalette';
import { WorkflowsDrawer } from './components/WorkflowsDrawer';
import { API_VERSION } from './api';
import { useUi } from './uiStore';
import { snapshot } from './lib/runCommand';

/** Below this width a rail has no room beside the content, so it is drawn in the top bar instead. */
const NARROW = '(max-width: 719.98px)';
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** Every tab there can be. The workbench tab follows the room you were last in, and needs one; the Studio's 3D tab only needs a room to exist. */
function allTabs(studio: string | null, room: string | null): Tab[] {
  return [
    ...(studio ? [{ id: '3d' as TabId, label: 'Studio · 3D & Glare', icon: Box, route: { view: 'design', room: studio, tab: '3d' } as Route }] : []),
    { id: 'home', label: 'Home · Active', icon: House, route: { view: 'home' } },
    ...(room ? [{ id: 'workbench' as TabId, label: `Workbench · ${room}`, icon: SlidersHorizontal, route: { view: 'room', room } as Route }] : []),
    { id: 'studio', label: 'Studio · Floor Plan', icon: MapIcon, route: { view: 'studio' } },
    { id: 'scenes', label: 'Scenes', icon: Palette, route: { view: 'scenes' } },
    { id: 'lights', label: 'Lights & Groups', icon: Lightbulb, route: { view: 'lights' } },
    { id: 'settings', label: 'Settings & CLI', icon: Settings, route: { view: 'settings' } },
    { id: 'help', label: 'Help', icon: CircleHelp, route: { view: 'help' } },
  ];
}

export function App() {
  const route = useRoute();
  const { ready, setup, load, refreshLights, toasts, dismiss, lightsError, serverStale, preferences, setPreferences, rooms } = useStore();
  const { paletteOpen, workflowsOpen, setPalette, setWorkflows, setCurrentRoom, currentRoom, tabs: tabState, setTabs, tabPlacement, tabRail } = useUi();
  const narrow = useNarrow();
  // The saved choice is untouched; a narrow window just draws a rail in the top bar.
  const placement: TabPlacement = narrow && isVertical(tabPlacement) ? 'top' : tabPlacement;

  const { theme, theme_dark, theme_light } = preferences;
  useEffect(() => {
    const prefs = { theme, theme_dark, theme_light };
    applyTheme(prefs);
    return followSystemTheme(prefs);
  }, [theme, theme_dark, theme_light]);
  useEffect(() => applyTransparency(preferences.reduce_transparency), [preferences.reduce_transparency]);

  // The room tabs follow the room on screen; ⌘K opens the palette and Escape closes the overlays.
  const routeRoom = route.view === 'room' || route.view === 'design' ? route.room : null;
  useEffect(() => { if (routeRoom) setCurrentRoom(routeRoom); }, [routeRoom, setCurrentRoom]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
      } else if (event.key === 'Escape' && useUi.getState().paletteOpen) setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);
  // The tabs are worked out from the rooms and the room you were last in.
  const studio = ready ? studioRoom(rooms, currentRoom) : null;
  const every = allTabs(studio, ready ? snapshot().currentRoom : null);
  const available = every.map((tab) => tab.id);
  const byId = new Map(every.map((tab) => [tab.id, tab]));
  const tabs = openTabs(tabState).map((id) => byId.get(id)).filter((tab): tab is Tab => !!tab);
  const closed = tabState.closed.map((id) => byId.get(id)).filter((tab): tab is Tab => !!tab);
  const activeTab = tabForRoute(route);
  // The screen you are on always has its tab: opening a screen whose tab was closed brings it back.
  useEffect(() => {
    const now = useUi.getState().tabs;
    if (now.closed.includes(activeTab)) setTabs(reopenTab(now, activeTab));
  }, [activeTab, setTabs]);
  // A Studio address with no room (#/studio/3d) becomes the address of the room it stands for.
  useEffect(() => {
    if (ready && route.view === 'studio-room') window.location.replace(href(resolveStudioRoute(route, rooms, currentRoom)));
  }, [ready, route, rooms, currentRoom]);
  const strip = <TabStrip placement={placement} tabs={tabs} closed={closed} available={available} byId={byId} activeTab={activeTab} state={tabState} setTabs={setTabs} />;
  const bridgeOk = !!setup?.configured && !lightsError;

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
        // Keyed by room: a room picked in the Studio starts clean, like opening that room's designer from anywhere.
        return <RoomDesigner key={route.room} name={route.room} tab={route.tab} />;
      case 'studio-room':
        return <div className="loading">Opening the Studio…</div>;
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
      case 'help':
        return <HelpView topic={route.topic} />;
      default:
        return <HomeView />;
    }
  })();

  return (
    // --rail-w is the one width of a side rail; the rail itself, the toasts, and the Workflows drawer all read it.
    <div className={`shell tabs-${placement}${preferences.show_light_glow ? '' : ' no-glow'}`}
      style={{ '--rail-w': `${tabRail.collapsed ? RAIL_ICONS : tabRail.width}px` } as CSSProperties}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
          <a className="brand-chip" href="#/" aria-label="MyHuey home">
            <Terminal size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>MyHuey</span>
            <small title="The API revision this page was built for">rev {API_VERSION}</small>
          </a>
          {placement === 'top' && strip}
        </div>
        <div className="topbar-right">
          <a className={`bridge-pill${bridgeOk ? ' ok' : ''}`} href="#/settings" title={setup?.configured ? (lightsError || 'The bridge is answering') : 'No bridge paired'}>
            <i aria-hidden="true" />
            {setup?.configured ? `${setup.bridge.ip ?? 'bridge'} · ${lightsError ? 'not answering' : 'connected'}` : 'No bridge paired'}
          </a>
          <select className="topbar-theme" aria-label="Color theme" title="Color theme" value={normalizeTheme(preferences.theme)}
            onChange={(event) => void setPreferences({ theme: event.target.value as Theme })}>
            {themeGroups().map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
            ))}
            <option value="system">System</option>
          </select>
          <button type="button" className={`chrome-button${workflowsOpen ? ' active' : ''}`} aria-pressed={workflowsOpen} onClick={() => setWorkflows(!workflowsOpen)}>
            <Sparkles size={13} aria-hidden="true" /> <span>Workflows</span>
          </button>
          <a className="chrome-button" href={href({ view: 'help', topic: topicFor(route) })} aria-label="Help for this screen" title="Help for this screen">
            <CircleHelp size={13} aria-hidden="true" />
          </a>
          <button type="button" className="chrome-button" onClick={() => setPalette(true)} aria-label="Open the command palette" title="Command palette">
            <Command size={13} aria-hidden="true" /> <span>⌘K</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        {placement === 'left' && strip}
      <main className="main">
        {serverStale && (
          <p className="stale-banner" role="alert">
            The MyHuey server is older than this page, so newer features will fail. Stop it and run <code>myhuey serve</code> again.
          </p>
        )}
        {ready && <SandboxBanner />}
        {view}
      </main>
        {workflowsOpen && <WorkflowsDrawer />}
        {placement === 'right' && strip}
      </div>
      {placement === 'bottom' && strip}
      <PromptBar />
      {paletteOpen && <CommandPalette />}
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
