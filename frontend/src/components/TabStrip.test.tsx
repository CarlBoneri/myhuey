// @vitest-environment happy-dom
import { Home, Lightbulb, Palette, Settings, Map as MapIcon } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '../test/dom';
import { REFOCUS_WINDOW, normalizeTabs, openTabs, type TabId, type TabPlacement, type TabState } from '../lib/tabs';
import { useUi } from '../uiStore';
import { TabStrip, type Tab } from './TabStrip';

const ids: TabId[] = ['home', 'studio', 'scenes', 'lights', 'settings'];
const byId = new Map<TabId, Tab>([
  ['home', { id: 'home', label: 'Home', icon: Home, route: { view: 'home' } }],
  ['studio', { id: 'studio', label: 'Studio', icon: MapIcon, route: { view: 'studio' } }],
  ['scenes', { id: 'scenes', label: 'Scenes', icon: Palette, route: { view: 'scenes' } }],
  ['lights', { id: 'lights', label: 'Lights', icon: Lightbulb, route: { view: 'lights' } }],
  ['settings', { id: 'settings', label: 'Settings', icon: Settings, route: { view: 'settings' } }],
]);
const everyone = normalizeTabs({ order: ids, closed: [] });
const link = (label: string) => screen.getByRole('link', { name: new RegExp(label) });

// A strip with five tabs, `home` active, placement `top`. `rerender` takes the state the strip should now show.
function strip(over: { activeTab?: TabId; state?: TabState; placement?: TabPlacement } = {}, extra?: React.ReactNode) {
  const setTabs = vi.fn();
  const draw = (o: { activeTab?: TabId; state?: TabState; placement?: TabPlacement }) => {
    const state = o.state ?? everyone;
    const open = openTabs(state).filter((id) => ids.includes(id)).map((id) => byId.get(id)!);
    return (
      <>
        {extra}
        <TabStrip placement={o.placement ?? 'top'} tabs={open} closed={state.closed.filter((id) => ids.includes(id)).map((id) => byId.get(id)!)} available={ids} byId={byId}
          activeTab={o.activeTab ?? 'home'} state={state} setTabs={setTabs} />
      </>
    );
  };
  const view = render(draw(over));
  return { setTabs, rerender: (o: { activeTab?: TabId; state?: TabState; placement?: TabPlacement }) => view.rerender(draw(o)) };
}

beforeEach(() => {
  useUi.setState({ tabPlacement: 'top', tabRail: { width: 210, collapsed: false } });
  window.location.hash = '';
});
afterEach(() => { vi.useRealTimers(); });

describe('TabStrip focus after the menu closes', () => {
  it('after Close tab on the active tab from the menu, focus lands on the tab that became active', () => {
    const { setTabs, rerender } = strip();
    link('Home').focus();
    fireEvent.contextMenu(link('Home'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    const next = setTabs.mock.calls[0][0] as TabState;
    expect(next.closed).toContain('home');
    // The tab is gone but the app has not yet learned the new active tab: no early fallback to the first tab.
    rerender({ state: next, activeTab: 'home' });
    expect(document.activeElement?.closest('.tab a')).toBeNull();
    rerender({ state: next, activeTab: 'studio' });
    expect(document.activeElement).toBe(link('Studio'));
  });

  it('after Close tab on another tab, focus goes back to where it was', () => {
    const { setTabs, rerender } = strip();
    link('Home').focus();
    fireEvent.contextMenu(link('Lights'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    rerender({ state: setTabs.mock.calls[0][0] as TabState });
    expect(document.activeElement).toBe(link('Home'));
  });

  it('does not pull focus onto the awaited tab if it only becomes active after the claim expired', () => {
    vi.useFakeTimers();
    const { setTabs, rerender } = strip();
    link('Home').focus();
    fireEvent.contextMenu(link('Home'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    const next = setTabs.mock.calls[0][0] as TabState;
    rerender({ state: next, activeTab: 'home' });
    vi.setSystemTime(Date.now() + REFOCUS_WINDOW + 1);
    rerender({ state: next, activeTab: 'studio' });
    expect(document.activeElement).not.toBe(link('Studio'));
  });

  it('puts focus back in the page at once when that is where it was', () => {
    const { setTabs, rerender } = strip({}, <input aria-label="prompt" />);
    const prompt = screen.getByLabelText('prompt');
    prompt.focus();
    fireEvent.contextMenu(link('Home'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab' }));
    rerender({ state: setTabs.mock.calls[0][0] as TabState, activeTab: 'home' });
    expect(document.activeElement).toBe(screen.getByLabelText('prompt'));
  });
});

describe('TabStrip menu keys', () => {
  const press = (key: string, shiftKey: boolean, withContextMenuEvent: boolean) => {
    const el = link('Home');
    fireEvent.keyDown(el, { key, shiftKey });
    if (withContextMenuEvent) fireEvent.contextMenu(el);
    fireEvent.keyUp(el, { key, shiftKey });
    act(() => { vi.advanceTimersByTime(100); });
  };
  const one = (key: string, shiftKey: boolean) => {
    vi.useFakeTimers();
    strip();
    press(key, shiftKey, true);
    expect(screen.getAllByRole('menu', { name: 'Tabs' })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Tabs' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Tabs' })).toBeNull();
    press(key, shiftKey, false);
    expect(screen.getAllByRole('menu', { name: 'Tabs' })).toHaveLength(1);
  };
  it('opens one menu from Shift+F10 whether or not the browser follows with a contextmenu event', () => one('F10', true));
  it('opens one menu from the Menu key', () => one('ContextMenu', false));
});

describe('TabStrip screen-reader details and the narrow-window note', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Main' });
  it('puts no aria-orientation on the nav, in a strip or a rail', () => {
    strip();
    expect(nav().hasAttribute('aria-orientation')).toBe(false);
    cleanup();
    useUi.setState({ tabPlacement: 'left' });
    strip({ placement: 'left' });
    expect(nav().hasAttribute('aria-orientation')).toBe(false);
  });
  it('names the rail toggle once and lets aria-expanded carry the state', () => {
    useUi.setState({ tabPlacement: 'left' });
    strip({ placement: 'left' });
    expect(screen.getByRole('button', { name: 'Tabs', exact: true }).getAttribute('aria-expanded')).toBe('true');
    cleanup();
    useUi.setState({ tabRail: { width: 210, collapsed: true } });
    strip({ placement: 'left' });
    expect(screen.getByRole('button', { name: 'Tabs', exact: true }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('separator')).toBeNull();
  });
  it('explains a rail drawn at the top in the menu', () => {
    useUi.setState({ tabPlacement: 'left' });
    strip();
    fireEvent.contextMenu(link('Home'));
    expect(within(screen.getByRole('menu', { name: 'Tabs' })).getByText(/too narrow for a side rail.*Left is saved/)).toBeTruthy();
  });
  it('adds nothing to the menu when the tabs are where they were saved', () => {
    strip();
    fireEvent.contextMenu(link('Home'));
    expect(document.querySelector('.tab-menu-note')).toBeNull();
    cleanup();
    useUi.setState({ tabPlacement: 'left' });
    strip({ placement: 'left' });
    fireEvent.contextMenu(link('Home'));
    expect(document.querySelector('.tab-menu-note')).toBeNull();
  });
});
