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
// A test can set `drag.play` to replay a drag through the handlers a piece passes to useDrag.
type DragHandlers = { move: (point: number[], delta: number[], event: object) => void; end: (moved: boolean) => void };
const drag: { play: ((handlers: DragHandlers) => void) | null } = { play: null };
vi.mock('../components/PlanCanvas', () => ({
  PlanCanvas: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  usePlan: () => ({ cmPerPx: 1, toPlan: () => [0, 0] }),
  useDrag: () => (_event: unknown, handlers: DragHandlers) => drag.play?.(handlers),
}));
vi.mock('../components/Studio3D', () => ({ Studio3D: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./PhotoView', () => ({ PhotoView: () => <div>photo</div> }));
vi.mock('../lib/roomGlare', () => ({
  roomGlare: vi.fn(() => ({ scene: { eye: null }, report: { lights: [], hazards: 0 }, posed: { lights: [] } })),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: {
    suggest: vi.fn(async () => []), palettes: vi.fn(async () => []), catalog: vi.fn(async () => []), updateRoom: vi.fn(() => new Promise(() => {})),
    placeLight: vi.fn(async () => ({})), desks: vi.fn(async () => [{ id: 'dz', name: 'Coding desk', items: [], lights: [] }]),
    placeDesk: vi.fn(() => new Promise(() => {})), moveDeskSet: vi.fn(() => new Promise(() => {})), releaseDeskSet: vi.fn(() => new Promise(() => {})),
    deskFromSet: vi.fn(() => new Promise(() => {})),
  },
}));

const office = {
  name: 'Office', units: 'imperial', outline: [[0, 0], [400, 0], [400, 300], [0, 300]], width: 400, height: 300, ceiling: 250,
  furniture: [{ id: 'd1', kind: 'desk', label: 'Desk', x: 100, y: 100, width: 120, depth: 60, rotation: 0, shape: 'rect' }],
  openings: [], lights: [], photo: null,
} as never;

beforeEach(() => {
  localStorage.clear();
  drag.play = null;
  vi.mocked(api.updateRoom).mockClear();
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

  it('flattens a curved screen made taller than wide in the Height field, so the save is not refused', () => {
    const g9 = { id: 'g9', kind: 'monitor-49', label: 'G9', x: 200, y: 60, width: 119.8, depth: 12, rotation: 0, shape: 'rect', elevation: 80, height: 33.7, curve: 1000 };
    useStore.setState({ rooms: [{ ...(office as object), furniture: [g9] } as never] });
    const { container } = render(<RoomDesigner name="Office" tab="plan" />);
    fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
    const height = screen.getByLabelText('Height');
    fireEvent.change(height, { target: { value: '130cm' } });
    fireEvent.blur(height);
    const saved = vi.mocked(api.updateRoom).mock.calls.at(-1)![1].furniture!;
    expect(saved.at(-1)).toMatchObject({ height: 130, curve: null });
  });

  describe('desk sets, mounts, and chairs', () => {
    const member = (id: string, kind: string, x: number, more: object = {}) =>
      ({ id, kind, label: id, x, y: 100, width: 60, depth: 20, rotation: 0, shape: 'rect', elevation: 75, height: 40, set: 's1', ...more });
    const withSet = (lights: object[] = []) => useStore.setState({ rooms: [{ ...(office as object),
      furniture: [member('d1', 'desk', 100, { width: 140, depth: 70, elevation: 0, height: 75 }), member('m1', 'monitor-27', 100)],
      lights, desk_sets: [{ id: 's1', name: 'Coding desk', base: 'd1' }] } as never] });

    it('moves the whole set when a member is dragged, and saves it in one call', () => {
      withSet();
      drag.play = (h) => { h.move([0, 0], [30, 0], {}); h.end(true); };
      const { container } = render(<RoomDesigner name="Office" tab="plan" />);
      fireEvent.pointerDown(container.querySelectorAll('.placed-furniture')[1]);
      expect(api.moveDeskSet).toHaveBeenCalledTimes(1);
      // The dragged screen snaps to whole inches (an imperial room): 130 cm lands at 129.5 (and y 100 at 99.1), and the desk moves the same.
      expect(vi.mocked(api.moveDeskSet).mock.calls[0]).toEqual(['Office', 's1', { x: 129.5, y: 99.1, rotation: 0 }]);
    });

    it('shows a member the set panel instead of its size fields', () => {
      withSet();
      const { container } = render(<RoomDesigner name="Office" tab="plan" />);
      fireEvent.pointerDown(container.querySelectorAll('.placed-furniture')[1]);
      expect(screen.queryByLabelText('Width')).toBeNull();
      expect(screen.getByText(/Part of Coding desk/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Release' }));
      expect(api.releaseDeskSet).toHaveBeenCalledWith('Office', 's1');
    });

    it('mounts a light on a screen', () => {
      useStore.setState({ rooms: [{ ...(office as object), furniture: [member('tv', 'tv', 200, { set: null })],
        lights: [{ light_id: 'l9', label: 'Strip', x: 10, y: 10, rotation: 0, length: 200, product: {}, metadata: {} }] } as never] });
      const { container } = render(<RoomDesigner name="Office" tab="plan" />);
      fireEvent.pointerDown(container.querySelector('.placed-light')!);
      fireEvent.change(screen.getByLabelText('Mounted on'), { target: { value: 'tv' } });
      expect(vi.mocked(api.placeLight).mock.calls.at(-1)![1]).toMatchObject({ light_id: 'l9', mount: { screen: 'tv' } });
    });

    it('marks a chair as your seat', () => {
      useStore.setState({ rooms: [{ ...(office as object), furniture: [member('c1', 'chair', 200, { set: null, elevation: 0 })] } as never] });
      const { container } = render(<RoomDesigner name="Office" tab="plan" />);
      fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
      fireEvent.click(screen.getByRole('checkbox', { name: 'I sit here' }));
      const saved = vi.mocked(api.updateRoom).mock.calls.at(-1)![1].furniture!;
      expect(saved[0]).toMatchObject({ id: 'c1', seat: 46 });
    });

    it('places a desk design in the middle of the room', async () => {
      render(<RoomDesigner name="Office" tab="plan" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Place Coding desk' }));
      expect(api.placeDesk).toHaveBeenCalledWith('Office', { design: 'dz', x: 200, y: 150, rotation: 0 });
    });
  });
});
