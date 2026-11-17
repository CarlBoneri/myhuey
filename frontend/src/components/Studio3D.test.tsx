// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '../test/dom';
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
});
