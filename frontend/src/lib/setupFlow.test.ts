import { describe, expect, it } from 'vitest';
import { initialSetup, setupReducer, type BridgeInfo, type SetupState } from './setupFlow';

const bridge: BridgeInfo = {
  bridge_ip: '10.0.0.77', name: 'Philips hue', model: 'BSB002', bridge_id: 'ECB5FAFFFE000001', software: '1972004020', api_version: '1.72.0', paired: false,
};
const at = (step: SetupState['step'], extra: Partial<SetupState> = {}): SetupState => ({ ...initialSetup(), step, ...extra });

describe('setup wizard steps', () => {
  it('starts at the welcome step and moves on to finding a bridge', () => {
    expect(initialSetup().step).toBe('welcome');
    expect(setupReducer(initialSetup(), { type: 'start' }).step).toBe('find');
  });

  it('confirms a bridge that answered, with its address', () => {
    const next = setupReducer(at('find', { error: 'old' }), { type: 'checked', bridge });
    expect(next).toMatchObject({ step: 'confirm', bridge, address: '10.0.0.77', error: '' });
  });

  it('stays on find with the reason when the address did not answer', () => {
    const next = setupReducer(at('find'), { type: 'checkFailed', message: 'Cannot reach 10.0.0.9' });
    expect(next).toMatchObject({ step: 'find', error: 'Cannot reach 10.0.0.9', bridge: null });
  });

  it('starts a fresh pairing attempt each time the person is ready', () => {
    const pressing = setupReducer(at('confirm', { bridge }), { type: 'pressNow' });
    expect(pressing).toMatchObject({ step: 'press', attempts: 1, error: '' });
    expect(setupReducer({ ...pressing, error: 'timed out' }, { type: 'pressNow' })).toMatchObject({ step: 'press', attempts: 2, error: '' });
  });

  it('reports the lights that answer once paired, then finishes with or without importing', () => {
    const connected = setupReducer(at('press', { bridge }), { type: 'paired', lights: 12 });
    expect(connected).toMatchObject({ step: 'connected', lights: 12 });
    expect(setupReducer(connected, { type: 'imported', added: ['Office'] })).toMatchObject({ step: 'done', imported: ['Office'] });
    expect(setupReducer(connected, { type: 'finish' })).toMatchObject({ step: 'done', imported: null });
  });

  it('goes back one step at a time', () => {
    expect(setupReducer(at('find'), { type: 'back' }).step).toBe('welcome');
    expect(setupReducer(at('confirm', { bridge }), { type: 'back' }).step).toBe('find');
    expect(setupReducer(at('press', { bridge }), { type: 'back' }).step).toBe('confirm');
    expect(setupReducer(at('done'), { type: 'back' }).step).toBe('done');
  });
});
