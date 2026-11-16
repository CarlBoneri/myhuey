import { useEffect, useRef, useState } from 'react';
import { Box, CircleHelp, Command, House, Lightbulb, Map as MapIcon, Palette, Plus, RotateCcw, Settings, SlidersHorizontal, Sparkles, Terminal, X } from 'lucide-react';
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
import { DEFAULT_TABS, closeTab, moveTab, neighbour, openTabs, reopenTab, shiftTab, tabForRoute, type TabId } from './lib/tabs';
import { SandboxBanner } from './components/SandboxBanner';
import { PromptBar } from './components/PromptBar';
import { CommandPalette } from './components/CommandPalette';
import { WorkflowsDrawer } from './components/WorkflowsDrawer';
import { API_VERSION } from './api';
import { useUi } from './uiStore';
import { snapshot } from './lib/runCommand';

interface Tab { id: TabId; label: string; icon: typeof House; route: Route }
const TAB_DRAG = 'application/x-myhuey-tab';

/** Every tab there can be. The room tabs follow the room you were last in, and need one. */
function allTabs(room: string | null): Tab[] {
  return [
    ...(room ? [{ id: '3d' as TabId, label: 'Studio · 3D & Glare', icon: Box, route: { view: 'design', room, tab: '3d' } as Route }] : []),
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
  const { paletteOpen, workflowsOpen, setPalette, setWorkflows, setCurrentRoom, currentRoom, tabs: tabState, setTabs } = useUi();
  const [tabMenu, setTabMenu] = useState(false);
  const [dropAt, setDropAt] = useState<TabId | 'end' | null>(null);
  const dragging = useRef<TabId | null>(null);

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
  void rooms; void currentRoom; // the tabs are worked out from both
  const every = allTabs(ready ? snapshot().currentRoom : null);
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
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [tabMenu]);
  const close = (id: TabId) => {
    const next = closeTab(tabState, id);
    if (next === tabState) return;
    if (id === activeTab) {
      const to = neighbour(tabState, id, available);
      if (to && byId.get(to)) go(byId.get(to)!.route);
    }
    setTabs(next);
  };
  const dropOn = (target: TabId | null) => {
    if (dragging.current) setTabs(moveTab(tabState, dragging.current, target));
    dragging.current = null;
    setDropAt(null);
  };
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
      case 'help':
        return <HelpView topic={route.topic} />;
      default:
        return <HomeView />;
    }
  })();

  return (
    <div className={`shell${preferences.show_light_glow ? '' : ' no-glow'}`}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
          <a className="brand-chip" href="#/" aria-label="MyHuey home">
            <Terminal size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>MyHuey</span>
            <small title="The API revision this page was built for">rev {API_VERSION}</small>
          </a>
          <nav className="tabs" aria-label="Main"
            onDragOver={(event) => { if (dragging.current) { event.preventDefault(); setDropAt('end'); } }}
            onDrop={(event) => { event.preventDefault(); dropOn(null); }}>
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const active = tab.id === activeTab;
              return (
                <span key={tab.id} className={`tab${active ? ' active' : ''}${dropAt === tab.id ? ' drop-before' : ''}`} draggable
                  onDragStart={(event) => { dragging.current = tab.id; event.dataTransfer.setData(TAB_DRAG, tab.id); event.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { dragging.current = null; setDropAt(null); }}
                  onDragOver={(event) => {
                    if (!dragging.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    // Past the middle of a tab means "after it": before the next tab, or at the end.
                    const box = event.currentTarget.getBoundingClientRect();
                    const after = event.clientX > box.left + box.width / 2;
                    setDropAt(after ? tabs[index + 1]?.id ?? 'end' : tab.id);
                  }}
                  onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropOn(dropAt === 'end' || dropAt === null ? null : dropAt); }}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id); } }}>
                  <a href={href(tab.route)} draggable={false} aria-current={active ? 'page' : undefined}
                    title="Drag to move · Alt-Shift-← → moves it with the keyboard"
                    onKeyDown={(event) => {
                      if (!(event.altKey && event.shiftKey) || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                      event.preventDefault();
                      setTabs(shiftTab(tabState, tab.id, event.key === 'ArrowLeft' ? -1 : 1));
                    }}>
                    <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
                    <span>{tab.label}</span>
                  </a>
                  {tabs.length > 1 && (
                    <button type="button" className="tab-close" aria-label={`Close the ${tab.label} tab`} title="Close this tab" onClick={() => close(tab.id)}><X size={11} /></button>
                  )}
                </span>
              );
            })}
            {dropAt === 'end' && <span className="tab-drop-end" aria-hidden="true" />}
            <span className="tab-add" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" className="tab-close always" aria-haspopup="menu" aria-expanded={tabMenu} aria-label="Reopen or reset tabs"
                title={closed.length ? `Reopen a closed tab (${closed.length})` : 'Reset the tabs'} onClick={() => setTabMenu((open) => !open)}><Plus size={13} /></button>
              {tabMenu && (
                <div className="tab-menu" role="menu">
                  {closed.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} type="button" role="menuitem" onClick={() => { setTabs(reopenTab(tabState, tab.id)); setTabMenu(false); go(tab.route); }}>
                        <Icon size={13} aria-hidden="true" /> {tab.label}
                      </button>
                    );
                  })}
                  {!closed.length && <p>No closed tabs. × on a tab closes it.</p>}
                  <button type="button" role="menuitem" onClick={() => { setTabs(DEFAULT_TABS); setTabMenu(false); }}><RotateCcw size={13} aria-hidden="true" /> Reset the tabs</button>
                </div>
              )}
            </span>
          </nav>
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
      </div>
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
