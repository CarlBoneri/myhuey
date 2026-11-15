// The bridge setup wizard as a pure state machine, so every path through it is testable
// without a bridge: welcome → find → confirm → press (link button) → connected → done.

export interface BridgeInfo {
  bridge_ip: string;
  name: string;
  model: string;
  bridge_id: string;
  software: string;
  api_version: string;
  /** This is the bridge MyHuey is already paired with. */
  paired: boolean;
}

export type SetupStep = 'welcome' | 'find' | 'confirm' | 'press' | 'connected' | 'done';

export interface SetupState {
  step: SetupStep;
  address: string;
  bridge: BridgeInfo | null;
  error: string;
  /** Pairing attempts started; the press step starts a new one whenever this changes. */
  attempts: number;
  lights: number;
  imported: string[] | null;
}

/** Why pairing failed, from the API's status: 409 = link button not pressed in time, 502 = bridge unreachable. */
export type PairFailure = 'timeout' | 'unreachable' | 'rejected';

export type SetupEvent =
  | { type: 'start' }
  | { type: 'checked'; bridge: BridgeInfo }
  | { type: 'checkFailed'; message: string }
  | { type: 'pressNow' }
  | { type: 'paired'; lights: number }
  | { type: 'pairFailed'; reason: PairFailure; message: string }
  | { type: 'imported'; added: string[] }
  | { type: 'finish' }
  | { type: 'back' };

export const SETUP_STEPS: { step: SetupStep; label: string }[] = [
  { step: 'welcome', label: 'Welcome' },
  { step: 'find', label: 'Find' },
  { step: 'confirm', label: 'Confirm' },
  { step: 'press', label: 'Link button' },
  { step: 'connected', label: 'Connected' },
];

export function initialSetup(): SetupState {
  return { step: 'welcome', address: '', bridge: null, error: '', attempts: 0, lights: 0, imported: null };
}

const BACK: Partial<Record<SetupStep, SetupStep>> = { find: 'welcome', confirm: 'find', press: 'confirm' };

export function setupReducer(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case 'start':
      return { ...state, step: 'find', error: '' };
    case 'checked':
      return { ...state, step: 'confirm', bridge: event.bridge, address: event.bridge.bridge_ip, error: '' };
    case 'checkFailed':
      return { ...state, step: 'find', bridge: null, error: event.message };
    case 'pressNow':
      return { ...state, step: 'press', error: '', attempts: state.attempts + 1 };
    case 'paired':
      return { ...state, step: 'connected', lights: event.lights, error: '' };
    case 'pairFailed':
      // TODO(human): decide where each kind of pairing failure sends the person.
      return state;
    case 'imported':
      return { ...state, step: 'done', imported: event.added };
    case 'finish':
      return { ...state, step: 'done', imported: null };
    case 'back':
      return BACK[state.step] ? { ...state, step: BACK[state.step]!, error: '' } : state;
  }
}
