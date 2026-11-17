// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test/dom';
import { waitFor } from '@testing-library/react';
import { api } from '../api';
import { saveTry, loadTry } from '../lib/tryLook';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { RoomLighting } from './RoomLighting';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: {
    suggest: vi.fn(), captureLook: vi.fn(), applyLook: vi.fn(), applySuggestion: vi.fn(), createScene: vi.fn(), palettes: vi.fn(),
  },
}));
const reflection = { light_id: 'l1', status: 'screen_reflection', cap: { brightness: 10, kelvin: 2700 }, label: 'Lamp' };
let hasDesk = true;
vi.mock('../lib/roomGlare', () => ({
  roomGlare: vi.fn(() => ({ scene: { eye: hasDesk ? [0, 0, 1] : null }, report: { lights: [reflection], hazards: 1 } })),
}));

const room = { name: 'Office', units: 'imperial', outline: [[0, 0], [4, 0], [4, 4], [0, 4]], furniture: [], lights: [] } as never;
const item = (name: string, id: string) => ({
  scene: { id, name: `Scene ${name}` }, palette: { id: `p${id}`, name, colors: ['#fff'], tags: [], source: 'generated', credit: {} },
  roles: {}, preview: [{ light_id: 'l1', label: 'Lamp', on: true }], white: 'x', kelvin: 3000,
  guide: { time: 'Mid-morning light, 4000 K.', glare: ['Lamp is held to 10%.'], checked: true },
});
const look = { l1: { on: true, bri: 50 } };
const api_ = vi.mocked(api, true);

beforeEach(() => {
  localStorage.clear();
  hasDesk = true;
  vi.clearAllMocks();
  api_.suggest.mockResolvedValue([item('Dune', 'a'), item('Fern', 'b')] as never);
  api_.palettes.mockResolvedValue([]);
  api_.captureLook.mockResolvedValue({ look, skipped: [], at: '09:41' } as never);
  api_.applyLook.mockResolvedValue({ results: [], failed: 0 } as never);
  api_.applySuggestion.mockResolvedValue({ scene: 's', results: [] } as never);
  useStore.setState({ layout: null, layouts: [], lights: {}, profiles: null, refreshScenes: vi.fn() as never });
  useUi.setState({ showing: null, posture: 'seated' } as never);
});

const mount = async () => { render(<RoomLighting room={room} />); await screen.findAllByText('Mid-morning light, 4000 K.'); };
const tryFirst = async () => { fireEvent.click(screen.getAllByRole('button', { name: /Try on lights/ })[0]); };
const mode = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

describe('RoomLighting', () => {
  it('sends the glare limits for the desk presets only', async () => {
    await mount();
    expect(api_.suggest.mock.calls.at(-1)![1].glare).toEqual({ checked: true, caps: { l1: { brightness: 10, kelvin: 2700, reason: 'reflection' } } });
    mode('Read');
    await waitFor(() => expect(api_.suggest.mock.calls.at(-1)![1].mode).toBe('read'));
    expect(api_.suggest.mock.calls.at(-1)![1]).not.toHaveProperty('glare');
    mode('Chill');
    await waitFor(() => expect(api_.suggest.mock.calls.at(-1)![1].mode).toBe('relax'));
    expect(api_.suggest.mock.calls.at(-1)![1]).not.toHaveProperty('glare');
  });

  it('shows every card its time and glare lines, and the header the time line once', async () => {
    await mount();
    expect(screen.getAllByText('Lamp is held to 10%.')).toHaveLength(2);
    expect(screen.getAllByText('Mid-morning light, 4000 K.')).toHaveLength(3);
    expect(screen.getAllByTestId('lighting-time')).toHaveLength(1);
  });

  it('shows a card without touching the lights, and Show live clears it', async () => {
    await mount();
    const show = screen.getAllByRole('button', { name: 'Show' })[0];
    fireEvent.click(show);
    expect(useUi.getState().showing).toEqual({ room: 'Office', title: 'Code · Dune', results: item('Dune', 'a').preview });
    fireEvent.click(screen.getByRole('button', { name: 'Showing' }));
    expect(useUi.getState().showing).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Show live' }));
    expect(useUi.getState().showing).toBeNull();
    expect(api_.applySuggestion).not.toHaveBeenCalled();
    expect(api_.applyLook).not.toHaveBeenCalled();
    expect(api_.captureLook).not.toHaveBeenCalled();
  });

  it('tries a card: captures, saves the record, applies, and names the try', async () => {
    await mount();
    await tryFirst();
    expect(await screen.findByText('Trying Code · Dune on Office')).toBeTruthy();
    expect(api_.captureLook).toHaveBeenCalledWith('Office');
    expect(api_.applySuggestion).toHaveBeenCalledWith('Office', item('Dune', 'a').scene);
    expect(loadTry('Office')!.look).toEqual(look);
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('names the sandbox and the skipped planned lights', async () => {
    useStore.setState({ layout: 'sb1', layouts: [{ id: 'sb1', name: 'Plan B' }] as never });
    api_.captureLook.mockResolvedValue({ look, skipped: ['a', 'b'], at: '09:41' } as never);
    await mount();
    await tryFirst();
    expect(await screen.findByText(/\(as drawn in sandbox Plan B\)/)).toBeTruthy();
    expect(screen.getByText(/2 planned lights skipped/)).toBeTruthy();
  });

  it('does not capture again on a second try, so Undo goes back to the first state', async () => {
    await mount();
    await tryFirst();
    await screen.findByText('Trying Code · Dune on Office');
    fireEvent.click(screen.getAllByRole('button', { name: /Try on lights/ })[1]);
    await screen.findByText('Trying Code · Fern on Office');
    expect(api_.captureLook).toHaveBeenCalledTimes(1);
    expect(api_.applySuggestion).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api_.applyLook).toHaveBeenCalledWith('Office', look));
  });

  it('puts the room back on Undo and says when it was', async () => {
    await mount();
    await tryFirst();
    await screen.findByText('Trying Code · Dune on Office');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Put back how Office was at 09:41')).toBeTruthy();
    expect(api_.applyLook).toHaveBeenCalledWith('Office', look);
    expect(loadTry('Office')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it('keeps the try without any light call', async () => {
    await mount();
    await tryFirst();
    await screen.findByText('Trying Code · Dune on Office');
    api_.applySuggestion.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(loadTry('Office')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(api_.applyLook).not.toHaveBeenCalled();
    expect(api_.applySuggestion).not.toHaveBeenCalled();
  });

  it('refuses the try when the bridge does not answer', async () => {
    api_.captureLook.mockRejectedValue(new Error('The bridge did not answer, so nothing was changed.'));
    await mount();
    await tryFirst();
    expect((await screen.findByRole('alert')).textContent).toContain('The bridge did not answer, so nothing was changed.');
    expect(api_.applySuggestion).not.toHaveBeenCalled();
    expect(loadTry('Office')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('brings the bar back after a reload within 12 hours', async () => {
    saveTry('Office', { at: Date.now() - 60_000, look, skipped: [], title: 'Code · Dune', layout: null, capturedAt: '09:41' });
    const expected = new Date(Date.now() - 60_000);
    const hhmm = `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`;
    await mount();
    expect(screen.getByText(`You tried a scene on Office at ${hhmm}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('saves a card as a scene', async () => {
    api_.createScene.mockResolvedValue({ name: 'Mine' } as never);
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: /Save as scene/ })[0]);
    fireEvent.change(screen.getByLabelText('Scene name'), { target: { value: 'Mine' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api_.createScene).toHaveBeenCalledWith({ ...item('Dune', 'a').scene, name: 'Mine' });
  });
});
