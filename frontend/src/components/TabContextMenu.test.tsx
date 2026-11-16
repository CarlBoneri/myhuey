// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import { tabMenuItems } from '../lib/tabs';
import { TabContextMenu } from './TabContextMenu';

const items = (over = {}) => tabMenuItems({ closable: true, tabPlacement: 'top', drawnAsRail: false, rail: { width: 210, collapsed: false }, ...over });
const open = (over = {}, onChoose = vi.fn(), onClose = vi.fn()) => {
  const { unmount } = render(<TabContextMenu items={items(over)} at={{ x: 10, y: 10 }} onChoose={onChoose} onClose={onClose} />);
  return { onChoose, onClose, unmount };
};

describe('TabContextMenu', () => {
  it('opens with focus on its first item', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close tab' }));
  });

  it('offers Close tab only for a closable tab, and the rail rows only for a rail', () => {
    const { unmount } = open({ closable: false, drawnAsRail: true });
    expect(screen.queryByRole('menuitem', { name: 'Close tab' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Collapse rail' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reset rail width' })).toBeTruthy();
    unmount();
    open();
    expect(screen.getByRole('menuitem', { name: 'Close tab' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Collapse rail' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Reset rail width' })).toBeNull();
  });

  it('marks the saved position as checked', () => {
    open({ tabPlacement: 'left' });
    const checked = (name: string) => screen.getByRole('menuitemradio', { name }).getAttribute('aria-checked');
    expect(checked('Left')).toBe('true');
    for (const name of ['Top', 'Bottom', 'Right']) expect(checked(name)).toBe('false');
  });

  it('moves between items with the arrow keys, Home and End, wrapping', () => {
    open();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset the tabs' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close tab' }));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset the tabs' }));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close tab' }));
  });

  it('Escape closes it and asks for focus back', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('Tab and Shift+Tab close it and ask for focus back', () => {
    const { onClose } = open();
    const menu = screen.getByRole('menu');
    // fireEvent returns false when something called preventDefault.
    expect(fireEvent.keyDown(menu, { key: 'Tab' })).toBe(false);
    expect(onClose).toHaveBeenLastCalledWith(true);
    expect(fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenLastCalledWith(true);
  });

  it('a click outside closes it without asking for focus back', () => {
    const { onClose } = open();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('choosing an item reports it', () => {
    const { onChoose } = open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Bottom' }));
    expect(onChoose).toHaveBeenCalledWith({ kind: 'place', placement: 'bottom', checked: false });
  });
});
