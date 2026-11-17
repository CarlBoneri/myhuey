// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import { useUi } from '../uiStore';
import { LightToggle } from './LightToggle';

beforeEach(() => useUi.setState({ lightingOpen: false }));

describe('the Light button', () => {
  it('says whether the lighting panel is open and toggles it', () => {
    render(<LightToggle />);
    const button = screen.getByRole('button', { name: 'Light' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(useUi.getState().lightingOpen).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(useUi.getState().lightingOpen).toBe(false);
  });
});
