// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import { useUi } from '../uiStore';
import { Sidebar } from './ui';

const mount = () => render(<div className="split"><main /><Sidebar name="designer"><p>panels</p></Sidebar></div>);
const grip = () => screen.getByRole('separator', { name: 'Resize the sidebar' });
const aside = () => document.querySelector('aside.inspector') as HTMLElement;

beforeEach(() => useUi.setState({ sidebarWidths: {} }));

describe('Sidebar resizing', () => {
  it('starts at the usual width', () => {
    mount();
    expect(grip().getAttribute('aria-valuenow')).toBe('360');
    expect(aside().style.getPropertyValue('--side-w')).toBe('360px');
  });
  it('uses the width saved for this sidebar', () => {
    useUi.setState({ sidebarWidths: { designer: 540 } });
    mount();
    expect(aside().style.getPropertyValue('--side-w')).toBe('540px');
  });
  it('widens with the left arrow key and narrows with the right, and saves it', () => {
    mount();
    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });
    expect(useUi.getState().sidebarWidths.designer).toBe(376);
    fireEvent.keyDown(grip(), { key: 'ArrowRight' });
    fireEvent.keyDown(grip(), { key: 'ArrowRight' });
    expect(useUi.getState().sidebarWidths.designer).toBe(344);
  });
  it('goes back to the usual width on double-click', () => {
    useUi.setState({ sidebarWidths: { designer: 540 } });
    mount();
    fireEvent.doubleClick(grip());
    expect(useUi.getState().sidebarWidths.designer).toBeUndefined();
    expect(aside().style.getPropertyValue('--side-w')).toBe('360px');
  });
});
