// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { waitFor } from '@testing-library/react';
import { fireEvent, render, screen } from '../test/dom';
import { api } from '../api';
import { useStore } from '../store';
import { DeskDesigner } from './DeskDesigner';

// The plan canvas measures itself and the 3D stage draws with the browser's layout; neither matters here.
vi.mock('../components/PlanCanvas', () => ({
  PlanCanvas: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  usePlan: () => ({ cmPerPx: 1, toPlan: () => [0, 0] }),
  useDrag: () => () => {},
}));
vi.mock('../components/Room3DStage', () => ({ Room3DStage: ({ scene }: { scene: { eye: number[] | null } }) => <div data-eye={scene.eye?.join(',')}>stage</div> }));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: {
    desks: vi.fn(async () => [{ id: 'dz', name: 'Coding desk', items: [{ key: 'desk', kind: 'desk', label: 'Desk', x: 0, y: 0, width: 140, depth: 70, rotation: 0, shape: 'rect' }], lights: [] }]),
    catalog: vi.fn(async () => [{ id: 'play-gradient-tv', label: 'Play gradient strip (TV)', archetype: 'huelightstriptv', productname: 'Hue play gradient lightstrip', color: 'gradient', kind: 'bias' }]),
    createDesk: vi.fn(async (body: { name: string }) => ({ id: 'new1', ...body })),
    updateDesk: vi.fn(async () => ({})),
    deleteDesk: vi.fn(async () => ({})),
    placeDesk: vi.fn(() => new Promise(() => {})),
    deskSet: vi.fn(async () => ({ set: 's1', name: 'My desk', lights: [],
      items: [{ id: 'd1', key: 'd1', kind: 'desk', label: 'Desk', x: 0, y: 0, width: 140, depth: 70, rotation: 0, shape: 'rect' }] })),
    applyDeskSet: vi.fn(() => new Promise(() => {})),
  },
}));

const office = { name: 'Office', units: 'metric', outline: [[0, 0], [400, 0], [400, 300], [0, 300]], width: 400, height: 300, ceiling: 250,
  furniture: [], openings: [], lights: [], photo: null } as never;

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ rooms: [office], lights: {}, profiles: null });
});

describe('DeskDesigner', () => {
  it('designs a new desk and saves it in desk-local cm', async () => {
    render(<DeskDesigner />);
    fireEvent.click(screen.getByRole('button', { name: 'New design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Super ultrawide 49"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Play gradient strip (TV)' }));
    fireEvent.change(screen.getByLabelText('Design name'), { target: { value: 'Battle station' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createDesk).toHaveBeenCalled());
    const body = vi.mocked(api.createDesk).mock.calls[0][0];
    expect(body.name).toBe('Battle station');
    const kinds = body.items.map((item) => item.kind);
    expect(kinds).toEqual(['desk', 'monitor-49', 'chair']);
    expect(body.items[0]).toMatchObject({ x: 0, y: 0 });
    expect(body.items[1]).toMatchObject({ curve: 1000, elevation: 75 });
    expect(body.items[2]).toMatchObject({ seat: 46 });
    // A bias light added with a screen in the design goes on that screen's back.
    expect(body.lights[0]).toMatchObject({ catalog: 'play-gradient-tv', mount: { screen: body.items[1].key } });
  });

  it('opens a placed set and applies it back with its ids', async () => {
    render(<DeskDesigner room="Office" set="s1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to My desk' }));
    expect(api.applyDeskSet).toHaveBeenCalledWith('Office', 's1', { items: [expect.objectContaining({ id: 'd1', kind: 'desk' })], lights: [] });
  });

  it('places a saved design in a room', async () => {
    render(<DeskDesigner design="dz" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Place in Office' }));
    await waitFor(() => expect(api.placeDesk).toHaveBeenCalledWith('Office', { design: 'dz', x: 200, y: 150, rotation: 0 }));
  });

  it('previews from your own eye height', async () => {
    useStore.setState({ preferences: { ...useStore.getState().preferences, eye_sitting: 80 } });
    const { container } = render(<DeskDesigner />);
    fireEvent.click(screen.getByRole('radio', { name: /3D/ }));
    await waitFor(() => expect(container.querySelector('[data-eye]')!.getAttribute('data-eye')!.split(',')[2]).toBe('126'));
  });

  it('shows sizes in your units, and switches between feet and inches and meters', () => {
    localStorage.clear();
    useStore.setState({ preferences: { ...useStore.getState().preferences, default_units: 'imperial' } });
    const { container } = render(<DeskDesigner />);
    fireEvent.pointerDown(container.querySelector('.placed-furniture')!);
    const width = () => (screen.getByLabelText('Width') as HTMLInputElement).value;
    expect(width()).toMatch(/'/); // feet and inches
    fireEvent.click(screen.getByRole('radio', { name: 'Meters' }));
    expect(width()).toMatch(/m$/);
  });
});
