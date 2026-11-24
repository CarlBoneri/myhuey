// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test/dom';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { Studio3D } from './Studio3D';

// The 3D stage draws with the browser's layout; only the panes around it are tested here.
vi.mock('./Room3DStage', () => ({ Room3DStage: () => <div>stage</div> }));

const room = { name: 'Office', units: 'metric', outline: [[0, 0], [300, 0], [300, 300], [0, 300]], ceiling: 250, furniture: [], openings: [],
  lights: [{ light_id: 'l1', label: 'Lamp', x: 10, y: 10, rotation: 0 }] } as never;
const glare = {
  scene: { eye: [0, 0, 120] },
  posed: { lights: [] },
  report: { hazards: 1, lights: [{ light_id: 'l1', label: 'Lamp', status: 'peripheral_warn', angle: 40, cap: { brightness: 35, kelvin: null }, hazards: [] }] },
} as never;
const light = (brightness: number) => ({ id: 'l1', name: 'Lamp', on: true, reachable: true, brightness, color: '#ffffff' });
const mount = () => render(<Studio3D room={room} glare={glare} selection={null} onSelect={() => {}} onLight={() => {}} onLightCommit={() => {}}
  onRoom={() => {}} onRigCommit={() => {}}><p>panels</p></Studio3D>);
const badge = () => document.querySelector('.pane-badge')!;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ lights: {}, profiles: null });
  useUi.setState({ showing: null, lightingOpen: false, posture: 'seated', glareMode: 'code' });
});

describe('Studio3D', () => {
  it('flags the badge only when a light is over its limit, not for lights merely to watch', () => {
    useStore.setState({ lights: { l1: light(50) } as never }); // 20%, under the 35% limit
    mount();
    expect(badge().textContent).toBe('0 over the limit · 1 to watch');
    expect(badge().className).not.toContain('flagged');
  });

  it('flags the badge when a light is over its limit', () => {
    useStore.setState({ lights: { l1: light(254) } as never });
    mount();
    expect(badge().textContent).toBe('1 over the limit · 0 to watch');
    expect(badge().className).toContain('flagged');
  });

  it('unfolds a folded inspector when the lighting panel opens', () => {
    localStorage.setItem('myhuey.studio3d', JSON.stringify({ collapsed: { inspector: true } }));
    mount();
    expect(screen.queryByText('panels')).toBeNull();
    act(() => useUi.getState().setLightingOpen(true));
    expect(screen.getByText('panels')).toBeTruthy();
  });

  it('sums up a screen in the item list', () => {
    const withScreens = { ...(room as object), furniture: [
      { id: 'g9', kind: 'monitor-49', label: 'G9', x: 150, y: 40, width: 119.8, depth: 12, rotation: 0, shape: 'rect', height: 33.7, curve: 1000 },
      { id: 'dell', kind: 'monitor-27', label: 'Dell', x: 60, y: 40, width: 33.6, depth: 20, rotation: 30, shape: 'rect', height: 59.8 },
    ] } as never;
    render(<Studio3D room={withScreens} glare={glare} selection={null} onSelect={() => {}} onLight={() => {}} onLightCommit={() => {}}
      onRoom={() => {}} onRigCommit={() => {}}><p>panels</p></Studio3D>);
    expect(screen.getByText('screen · 49" 32:9 · 1000R')).toBeTruthy();
    expect(screen.getByText('screen · 27" portrait')).toBeTruthy();
  });

  it('leaves resizing its inspector to its own bar, with no sidebar bar inside it', () => {
    mount();
    expect(screen.queryByRole('separator', { name: 'Resize the sidebar' })).toBeNull();
    expect(screen.getByRole('separator', { name: 'Resize the inspector' })).toBeTruthy();
  });

  describe('your eyes', () => {
    const prefs = { eye_sitting: 69, eye_standing: 155, screen_distance: 60 };
    const mountWith = (furniture: object[] = []) => render(<Studio3D room={{ ...(room as object), units: 'metric', furniture } as never} glare={glare} selection={null}
      onSelect={() => {}} onLight={() => {}} onLightCommit={() => {}} onRoom={() => {}} onRigCommit={() => {}}><p>panels</p></Studio3D>);

    it('labels each posture with your own eye height', () => {
      useStore.setState({ preferences: { ...useStore.getState().preferences, ...prefs, eye_sitting: 75, eye_standing: 160 } });
      mountWith();
      expect(screen.getByRole('radio', { name: 'Seated · eyes 1.21 m' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Standing · eyes 1.60 m' })).toBeTruthy();
    });
    it('shows the seat and your sitting eye height when a chair is your seat', () => {
      useStore.setState({ preferences: { ...useStore.getState().preferences, ...prefs } });
      mountWith([{ id: 'c', kind: 'chair', label: 'Chair', x: 100, y: 100, width: 50, depth: 50, rotation: 0, shape: 'rect', seat: 50 }]);
      expect(screen.getByRole('radio', { name: 'Seated · eyes 1.19 m (seat 50 cm + 69 cm)' })).toBeTruthy();
    });
    it('saves a new sitting eye height', () => {
      const setPreferences = vi.fn(async () => {});
      useStore.setState({ preferences: { ...useStore.getState().preferences, ...prefs }, setPreferences });
      mountWith();
      const field = screen.getByLabelText('Sitting eye height');
      fireEvent.change(field, { target: { value: '72cm' } });
      fireEvent.blur(field);
      expect(setPreferences).toHaveBeenCalledWith({ eye_sitting: 72 });
    });
  });
});
