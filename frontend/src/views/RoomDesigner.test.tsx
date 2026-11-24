// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '../test/dom';
import { waitFor } from '@testing-library/react';
import { api } from '../api';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { RoomDesigner } from './RoomDesigner';

// The plan canvas measures itself and the 3D stage needs WebGL; neither matters to what is tested here.
vi.mock('../components/PlanCanvas', () => ({
  PlanCanvas: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  usePlan: () => ({ cmPerPx: 1, toPlan: () => [0, 0] }),
  useDrag: () => () => {},
}));
vi.mock('../components/Studio3D', () => ({ Studio3D: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./PhotoView', () => ({ PhotoView: () => <div>photo</div> }));
vi.mock('../lib/roomGlare', () => ({
  roomGlare: vi.fn(() => ({ scene: { eye: null }, report: { lights: [], hazards: 0 }, posed: { lights: [] } })),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { suggest: vi.fn(async () => []), palettes: vi.fn(async () => []), catalog: vi.fn(async () => []), updateRoom: vi.fn(() => new Promise(() => {})), placeLight: vi.fn(async () => ({})) },
}));

const office = {
  name: 'Office', units: 'imperial', outline: [[0, 0], [400, 0], [400, 300], [0, 300]], width: 400, height: 300, ceiling: 250,
  furniture: [{ id: 'd1', kind: 'desk', label: 'Desk', x: 100, y: 100, width: 120, depth: 60, rotation: 0, shape: 'rect' }],
  openings: [], lights: [], photo: null,
} as never;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.suggest).mockClear();
  useStore.setState({ rooms: [office], lights: {}, profiles: null, layout: null, layouts: [], replaceRoom: vi.fn() as never, refreshRooms: vi.fn() as never });
  useUi.setState({ showing: null, lightingOpen: false, posture: 'seated', glareMode: 'code' } as never);
});

describe('RoomDesigner', () => {
  for (const tab of ['plan', '3d', 'photo'] as const) {
    it(`shows "No room named" when the room goes away under it (${tab})`, () => {
      useUi.setState({ lightingOpen: true });
      const view = render(<RoomDesigner name="Office" tab={tab} />);
      expect(screen.queryByText(/No room named/)).toBeNull();
      useStore.setState({ rooms: [] });
      view.rerender(<RoomDesigner name="Office" tab={tab} />);
      expect(screen.getByText('No room named “Office”')).toBeTruthy();
    });
  }

  it('judges suggestions from the saved room, so editing an unsaved draft sends no new request', async () => {
    useUi.setState({ lightingOpen: true });
    const { container } = render(<RoomDesigner name="Office" tab="plan" />);
    await waitFor(() => expect(api.suggest).toHaveBeenCalled());
    const calls = vi.mocked(api.suggest).mock.calls.length;
    fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
    fireEvent.change(screen.getByDisplayValue('Desk'), { target: { value: 'Standing desk' } });
    expect(screen.getByDisplayValue('Standing desk')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(api.suggest).mock.calls.length).toBe(calls);
  });

  const shown = (room: string) => ({ room, id: 'code|p1|0|', title: 'Code · Dune', results: [] });

  it('keeps the shown card and one lighting panel when switching between the plan and 3D', () => {
    useUi.setState({ lightingOpen: true, showing: shown('Office') });
    const view = render(<RoomDesigner name="Office" tab="plan" />);
    view.rerender(<RoomDesigner name="Office" tab="3d" />);
    expect(useUi.getState().showing).toEqual(shown('Office'));
    expect(view.container.querySelectorAll('.suggest-panel')).toHaveLength(1);
    view.rerender(<RoomDesigner name="Office" tab="plan" />);
    expect(useUi.getState().showing).toEqual(shown('Office'));
    expect(view.container.querySelectorAll('.suggest-panel')).toHaveLength(1);
  });

  it('drops the shown card when the room changes, the panel closes, or the designer goes', () => {
    useStore.setState({ rooms: [office, { ...(office as object), name: 'Den' } as never] });
    useUi.setState({ lightingOpen: true, showing: shown('Office') });
    const view = render(<RoomDesigner name="Office" tab="plan" />);
    view.rerender(<RoomDesigner name="Den" tab="plan" />);
    expect(useUi.getState().showing).toBeNull();
    act(() => useUi.setState({ showing: shown('Den') }));
    act(() => useUi.getState().setLightingOpen(false));
    expect(useUi.getState().showing).toBeNull();
    act(() => useUi.setState({ showing: shown('Den') }));
    view.unmount();
    expect(useUi.getState().showing).toBeNull();
  });
  it('lists lights new from Hue, and pressing one selects it', () => {
    const arrived = { light_id: 'l9', label: 'Desk strip', x: 10, y: 10, rotation: 0, length: null, product: {}, metadata: { arrived: true } };
    useStore.setState({ rooms: [{ ...(office as object), lights: [arrived] } as never] });
    render(<RoomDesigner name="Office" tab="plan" />);
    expect(screen.getByText('New from Hue')).toBeTruthy();
    expect(screen.getByText('Drag these into place.')).toBeTruthy();
    expect(screen.queryByText('Desk strip is not on the bridge right now.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Desk strip' }));
    expect(screen.getByText('Desk strip is not on the bridge right now.')).toBeTruthy();
  });

  it('shows no New from Hue panel when no light arrived', () => {
    render(<RoomDesigner name="Office" tab="plan" />);
    expect(screen.queryByText('New from Hue')).toBeNull();
  });
  it('drops a light from New from Hue once it is moved, and keeps it when it only turns', async () => {
    const arrived = { light_id: 'l9', label: 'Desk strip', x: 10, y: 10, rotation: 0, length: null, product: {}, metadata: { arrived: true } };
    const withLight = { ...(office as object), lights: [arrived] } as never;
    // Like the real store: replaceRoom puts the saved room back in the list.
    useStore.setState({
      rooms: [withLight],
      replaceRoom: ((name: string, next: never) => useStore.setState((st) => ({ rooms: st.rooms.map((r) => (r.name === name ? next : r)) }))) as never,
    });
    render(<RoomDesigner name="Office" tab="plan" />);
    fireEvent.click(screen.getByRole('button', { name: 'Desk strip' }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })); });
    await waitFor(() => expect(api.placeLight).toHaveBeenCalledTimes(1));
    expect(screen.getByText('New from Hue')).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    await waitFor(() => expect(screen.queryByText('New from Hue')).toBeNull());
  });

  it('adds the 49-inch curved, as the Odyssey G9 comes', () => {
    render(<RoomDesigner name="Office" tab="plan" />);
    fireEvent.click(screen.getByRole('button', { name: 'Super ultrawide 49"' }));
    const saved = vi.mocked(api.updateRoom).mock.calls.at(-1)![1].furniture!;
    expect(saved.at(-1)).toMatchObject({ kind: 'monitor-49', width: 119.8, curve: 1000 });
  });

  it('shows the screen fields for a screen and not for a desk', () => {
    const { container } = render(<RoomDesigner name="Office" tab="plan" />);
    fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
    expect(screen.queryByLabelText('Diagonal (in)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Super ultrawide 49"' }));
    expect(screen.getByLabelText('Diagonal (in)')).toBeTruthy();
  });

  it('duplicates a screen with its curve, tilt, and height', () => {
    const g9 = { id: 'g9', kind: 'monitor-49', label: 'G9', x: 200, y: 60, width: 119.8, depth: 12, rotation: 0, shape: 'rect', elevation: 80, height: 33.7, curve: 1800, tilt: -5 };
    useStore.setState({ rooms: [{ ...(office as object), furniture: [g9] } as never] });
    const { container } = render(<RoomDesigner name="Office" tab="plan" />);
    fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const saved = vi.mocked(api.updateRoom).mock.calls.at(-1)![1].furniture!;
    expect(saved.at(-1)).toMatchObject({ kind: 'monitor-49', curve: 1800, tilt: -5, elevation: 80, height: 33.7 });
  });
});
