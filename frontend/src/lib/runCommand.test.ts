import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { runCommand } from './runCommand';

describe('room glare --fix while a scene is shown', () => {
  beforeEach(() => {
    useStore.setState({ rooms: [{ name: 'Office', lights: [], units: 'metric', furniture: [] }] as never, lights: {} });
    useUi.setState({ showing: null } as never);
  });
  it('refuses, and sends nothing, until the person shows live', async () => {
    useUi.setState({ showing: { id: 'a', room: 'Office', title: 'Code', results: [] } } as never);
    const entry = await runCommand('room glare Office --fix');
    expect(entry.output).toBe('A scene is being shown for Office. Show live first, then fix glare.');
    expect(entry.ok).toBe(false);
  });
  it('is unchanged when the shown scene is for another room', async () => {
    useUi.setState({ showing: { id: 'a', room: 'Den', title: 'Code', results: [] } } as never);
    const entry = await runCommand('room glare Office --fix');
    expect(entry.output).not.toMatch(/being shown/);
  });
});
