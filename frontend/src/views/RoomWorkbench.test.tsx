// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '../test/dom';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { RoomWorkbench } from './RoomWorkbench';

const room = (name: string) => ({ name, units: 'metric', outline: [[0, 0], [300, 0], [300, 300], [0, 300]], furniture: [], openings: [], lights: [] });
const shown = (name: string) => ({ room: name, id: 'code|p1|0|', title: 'Code · Dune', results: [] });

beforeEach(() => {
  useStore.setState({ rooms: [room('Office'), room('Den')] as never, lights: {}, scenes: [] });
  useUi.setState({ showing: null });
});

describe('RoomWorkbench', () => {
  it('drops the shown card when the room changes and when the workbench goes', () => {
    useUi.setState({ showing: shown('Office') });
    const view = render(<RoomWorkbench name="Office" />);
    expect(useUi.getState().showing).not.toBeNull();
    view.rerender(<RoomWorkbench name="Den" />);
    expect(useUi.getState().showing).toBeNull();
    useUi.setState({ showing: shown('Den') });
    view.unmount();
    expect(useUi.getState().showing).toBeNull();
  });
});
