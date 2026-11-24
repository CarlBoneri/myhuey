// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../test/dom';
import { useStore } from '../store';
import { SettingsView } from './SettingsView';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { bridge: vi.fn(() => new Promise(() => {})), setupStatus: vi.fn(() => new Promise(() => {})), cliInfo: vi.fn(() => new Promise(() => {})) },
}));

describe('Settings', () => {
  it('sets your own eye heights under You', () => {
    const setPreferences = vi.fn(async () => {});
    useStore.setState({ setPreferences, preferences: { ...useStore.getState().preferences, default_units: 'metric' } });
    render(<SettingsView />);
    expect(screen.getByRole('heading', { name: 'You' })).toBeTruthy();
    const field = screen.getByLabelText('Standing eye height');
    fireEvent.change(field, { target: { value: '160cm' } });
    fireEvent.blur(field);
    expect(setPreferences).toHaveBeenCalledWith({ eye_standing: 160 });
  });
});
