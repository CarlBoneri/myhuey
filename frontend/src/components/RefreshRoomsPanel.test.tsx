// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import type { RefreshPlan, RoomRefresh } from '../types';
import { RefreshRoomsPanel } from './RefreshRoomsPanel';

const row = (over: Partial<RoomRefresh>): RoomRefresh => ({ room: 'Office', hue_room: '1', hue_name: 'Office', status: 'unchanged', arrive: [], leave: [], link: false, ...over });
const move = (light_id: string, label: string, other: string | null, also = false) => ({ light_id, label, other, also });
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
      arrive: [move('1', 'Desk strip', 'Office'), move('2', 'Lamp', null)],
      leave: [move('3', 'Bulb', 'Hall'), move('4', 'Spot', null)],
    })));
    expect(screen.getByText('Bedroom')).toBeTruthy();
    expect(screen.getByLabelText('Desk strip arrives from Office').textContent).toBe('+ Desk strip (from Office)');
    expect(screen.getByLabelText('Lamp arrives').textContent).toBe('+ Lamp');
    expect(screen.getByLabelText('Bulb leaves to Hall').textContent).toBe('− Bulb (to Hall)');
    expect(screen.getByLabelText('Spot leaves').textContent).toBe('− Spot');
  });

  it('counts the lights of a new room', () => {
    setup(plan(
      row({ room: 'Den', hue_name: 'Den', status: 'new', arrive: [move('1', 'A', null)] }),
      row({ room: 'Hall', hue_name: 'Hall', status: 'new', arrive: [move('2', 'B', null), move('3', 'C', null)] }),
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

  it('says a light that arrives from a room left alone stays there too', () => {
    setup(plan(row({ room: 'Bedroom', status: 'changed', arrive: [move('1', 'Desk strip', 'Garage', true)] })));
    expect(screen.getByLabelText('Desk strip arrives, and stays in Garage too').textContent).toBe('+ Desk strip (also in Garage)');
  });

  it('shows the Hue name of a room linked this time under another name', () => {
    setup(plan(
      row({ room: 'Family room', hue_name: 'Den', link: true, status: 'changed', arrive: [move('1', 'Lamp', null)] }),
      row({ room: 'Office', hue_name: 'Den', link: false, status: 'changed', arrive: [move('2', 'Bulb', null)] }),
      row({ room: 'Office 2', hue_name: 'Office', link: true, status: 'new', arrive: [move('3', 'Spot', null)] }),
    ));
    expect(screen.getByText('Family room (Hue: Den)')).toBeTruthy();
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.getByText('Office 2 (Hue: Office): new room, 1 light')).toBeTruthy();
  });

  it('disables Done while busy', () => {
    setup(plan(row({ link: true })), true);
    expect((screen.getByRole('button', { name: /Done/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
