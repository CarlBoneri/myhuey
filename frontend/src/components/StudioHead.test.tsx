// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '../test/dom';
import { go } from '../lib/router';
import { PICK_SETTLE_MS } from '../lib/studio';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { StudioHead } from './StudioHead';

vi.mock('../lib/router', async (original) => ({ ...(await original<typeof import('../lib/router')>()), go: vi.fn() }));

const rooms = ['Office', 'Den', 'Kitchen'].map((name) => ({ name }));
const picker = () => screen.getByRole('combobox') as HTMLSelectElement;
const byKey = (value: string) => { fireEvent.keyDown(picker(), { key: 'ArrowDown' }); fireEvent.change(picker(), { target: { value } }); };
const byPointer = (value: string) => { fireEvent.pointerDown(picker()); fireEvent.change(picker(), { target: { value } }); };
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const radio = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(go).mockClear();
  useStore.setState({ rooms: rooms as never });
  useUi.setState({ currentRoom: null });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('StudioHead', () => {
  it('shows the room name as typed', () => {
    const { rerender } = render(<StudioHead view="3d" room="Office" />);
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('as-typed');
    rerender(<StudioHead view="home" room={null} />);
    const head = screen.getByRole('heading', { level: 1 });
    expect(head.textContent).toBe('Whole home');
    expect(head.className).not.toContain('as-typed');
  });

  it('lists Whole home and every room, and shows the room on screen', () => {
    render(<StudioHead view="3d" room="Office" />);
    expect(within(picker()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Whole home', 'Office', 'Den', 'Kitchen']);
    expect(picker().value).toBe('Office');
  });

  it('opens a room chosen with the pointer at once', () => {
    render(<StudioHead view="3d" room="Office" />);
    byPointer('Den');
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('lets keyboard changes settle and opens only the last one', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    wait(100);
    byKey('Kitchen');
    expect(picker().value).toBe('Kitchen');
    expect(go).not.toHaveBeenCalled();
    wait(PICK_SETTLE_MS - 1);
    expect(go).not.toHaveBeenCalled();
    wait(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Kitchen', tab: '3d' });
  });

  it('opens the pending room at once on Enter', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    fireEvent.keyDown(picker(), { key: 'Enter' });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
    wait(PICK_SETTLE_MS);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('opens the pending room at once when focus leaves the picker', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    fireEvent.blur(picker());
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('drops the pending room on Escape', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    fireEvent.keyDown(picker(), { key: 'Escape' });
    expect(picker().value).toBe('Office');
    wait(PICK_SETTLE_MS);
    expect(go).not.toHaveBeenCalled();
  });

  it('opens nothing when the keyboard comes back to the room on screen', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    byKey('Office');
    wait(PICK_SETTLE_MS);
    expect(go).not.toHaveBeenCalled();
    expect(picker().value).toBe('Office');
  });

  it('still opens a pointer choice at once after keyboard use', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    byPointer('Kitchen');
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Kitchen', tab: '3d' });
    wait(PICK_SETTLE_MS);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('opens a pending room at once on an outside blur once the header press has been released', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.pointerDown(radio('3D'));
    fireEvent.pointerUp(window);
    wait(0);
    fireEvent.blur(picker(), { relatedTarget: null });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: 'plan' });
  });

  it('keeps a pending room for the view switch when a press in the header blurs the picker without focusing anything (Safari, Firefox)', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.pointerDown(radio('3D'));
    fireEvent.blur(picker(), { relatedTarget: null });
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(radio('3D'));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('still opens the pending room after the pause when the press was on the heading, not a control', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.pointerDown(screen.getByRole('heading'));
    fireEvent.blur(picker(), { relatedTarget: null });
    expect(go).not.toHaveBeenCalled();
    wait(PICK_SETTLE_MS);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: 'plan' });
  });

  it('opens the pending room at once when a press outside the header blurs the picker', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.blur(picker(), { relatedTarget: null });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: 'plan' });
  });

  it('opens nothing after it unmounts with a choice pending', () => {
    const { unmount } = render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    unmount();
    wait(PICK_SETTLE_MS);
    expect(go).not.toHaveBeenCalled();
  });

  it('tells onPick when the room opens, not while it is pending', () => {
    const onPick = vi.fn();
    render(<StudioHead view="home" room={null} onPick={onPick} />);
    byKey('Den');
    expect(onPick).not.toHaveBeenCalled();
    wait(PICK_SETTLE_MS);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('Den');
    expect(go).toHaveBeenCalledWith({ view: 'studio', focus: 'Den' });
  });

  it('goes to the whole home from a room', () => {
    render(<StudioHead view="3d" room="Office" />);
    byPointer('');
    expect(go).toHaveBeenCalledWith({ view: 'studio', focus: 'Office' });
  });

  it('keeps the room when the view changes', () => {
    render(<StudioHead view="plan" room="Office" />);
    fireEvent.click(radio('3D'));
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Office', tab: '3d' });
  });

  it('offers only the home plan when there are no rooms', () => {
    useStore.setState({ rooms: [] });
    render(<StudioHead view="home" room={null} />);
    for (const name of ['Room plan', '3D', 'Photo']) expect((radio(name) as HTMLButtonElement).disabled).toBe(true);
    expect((radio('Home plan') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the view switch goes to the room the keyboard just chose', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.click(radio('3D'));
    expect(vi.mocked(go).mock.lastCall).toEqual([{ view: 'design', room: 'Den', tab: '3d' }]);
    fireEvent.blur(picker());
    wait(PICK_SETTLE_MS);
    expect(go).toHaveBeenCalledTimes(1);
    expect(vi.mocked(go).mock.lastCall).toEqual([{ view: 'design', room: 'Den', tab: '3d' }]);
  });

  it('the view switch still goes to the chosen room when blur opened it first', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.blur(picker());
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: 'plan' });
    fireEvent.click(radio('3D'));
    expect(vi.mocked(go).mock.lastCall).toEqual([{ view: 'design', room: 'Den', tab: '3d' }]);
  });

  it('opens a room chosen from the open list at once', () => {
    render(<StudioHead view="3d" room="Office" />);
    fireEvent.keyDown(picker(), { key: 'ArrowDown' });
    wait(500);
    fireEvent.change(picker(), { target: { value: 'Den' } });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('opens at once when Enter chooses in the open list', () => {
    render(<StudioHead view="3d" room="Office" />);
    fireEvent.keyDown(picker(), { key: 'ArrowDown' });
    wait(300);
    fireEvent.keyDown(picker(), { key: 'Enter' });
    fireEvent.change(picker(), { target: { value: 'Den' } });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('Enter never settles', () => {
    render(<StudioHead view="3d" room="Office" />);
    fireEvent.keyDown(picker(), { key: 'Enter' });
    fireEvent.change(picker(), { target: { value: 'Den' } });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('leaves a pending choice alone when focus moves to the view switch', () => {
    render(<StudioHead view="plan" room="Office" />);
    byKey('Den');
    fireEvent.blur(picker(), { relatedTarget: radio('3D') });
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(radio('3D'));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('opens the pending room at once when focus leaves for something outside the header', () => {
    render(<StudioHead view="3d" room="Office" />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    byKey('Den');
    fireEvent.blur(picker(), { relatedTarget: outside });
    outside.remove();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('a key that changes nothing still restarts the pause', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    wait(300);
    fireEvent.keyDown(picker(), { key: 'ArrowDown' });
    wait(300);
    expect(go).not.toHaveBeenCalled();
    wait(50);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ view: 'design', room: 'Den', tab: '3d' });
  });

  it('drops a pending room that has gone', () => {
    render(<StudioHead view="3d" room="Office" />);
    byKey('Den');
    act(() => useStore.setState({ rooms: rooms.filter((room) => room.name !== 'Den') as never }));
    wait(PICK_SETTLE_MS);
    expect(go).not.toHaveBeenCalled();
  });
});
