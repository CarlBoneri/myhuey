// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import type { RefreshPlan, RoomRefresh } from '../types';
import { RefreshRoomsPanel } from './RefreshRoomsPanel';

const row = (over: Partial<RoomRefresh>): RoomRefresh => ({ room: 'Office', hue_room: 'Office', status: 'unchanged', arrive: [], leave: [], link: false, ...over });
const plan = (...rooms: RoomRefresh[]): RefreshPlan => ({ rooms, fingerprint: 'fp' });
const setup = (p: RefreshPlan, busy = false) => {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(<RefreshRoomsPanel plan={p} busy={busy} onApply={onApply} onCancel={onCancel} />);
  return { onApply, onCancel };
};

describe('RefreshRoomsPanel', () => {
  it('lists arrivals and departures, with and without the other room', () => {
    setup(plan(row({
      room: 'Bedroom', status: 'changed',
      arrive: [{ light_id: '1', label: 'Desk strip', other: 'Office' }, { light_id: '2', label: 'Lamp', other: null }],
      leave: [{ light_id: '3', label: 'Bulb', other: 'Hall' }, { light_id: '4', label: 'Spot', other: null }],
    })));
    expect(screen.getByText('Bedroom')).toBeTruthy();
    expect(screen.getByLabelText('Desk strip arrives from Office').textContent).toBe('+ Desk strip (from Office)');
    expect(screen.getByLabelText('Lamp arrives').textContent).toBe('+ Lamp');
    expect(screen.getByLabelText('Bulb leaves to Hall').textContent).toBe('− Bulb (to Hall)');
    expect(screen.getByLabelText('Spot leaves').textContent).toBe('− Spot');
  });

  it('counts the lights of a new room', () => {
    setup(plan(
      row({ room: 'Den', status: 'new', arrive: [{ light_id: '1', label: 'A', other: null }] }),
      row({ room: 'Hall', status: 'new', arrive: [{ light_id: '2', label: 'B', other: null }, { light_id: '3', label: 'C', other: null }] }),
    ));
    expect(screen.getByText('Den: new room, 1 light')).toBeTruthy();
    expect(screen.getByText('Hall: new room, 2 lights')).toBeTruthy();
  });

  it('names a room left alone', () => {
    setup(plan(row({ room: 'Attic', status: 'left_alone' }), row({ room: 'Den', status: 'new' })));
    expect(screen.getByText('Attic: not on the bridge, left alone')).toBeTruthy();
  });

  it('counts the rooms that already match', () => {
    setup(plan(row({ room: 'A' }), row({ room: 'B' }), row({ room: 'Den', status: 'new' })));
    expect(screen.getByText('2 rooms already match')).toBeTruthy();
  });

  it('says 1 room already matches', () => {
    setup(plan(row({ room: 'A' }), row({ room: 'Den', status: 'new' })));
    expect(screen.getByText('1 room already matches')).toBeTruthy();
  });

  it('Apply calls onApply, Cancel calls onCancel', () => {
    const { onApply, onCancel } = setup(plan(row({ status: 'new' })));
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy', () => {
    setup(plan(row({ status: 'new' })), true);
    expect((screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Cancel/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('when nothing changed, Done applies the links if a room has one', () => {
    const { onApply, onCancel } = setup(plan(row({ link: true })));
    expect(screen.getByText('Your rooms already match Hue.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('when nothing changed and nothing to link, Done cancels', () => {
    const { onApply, onCancel } = setup(plan(row({})));
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
