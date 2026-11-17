// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '../test/dom';
import { useStore } from '../store';
import { useUi } from '../uiStore';
import { RoomDesigner } from './RoomDesigner';

// The plan canvas measures itself and the 3D stage needs WebGL; neither matters to what is tested here.
vi.mock('../components/PlanCanvas', () => ({
  PlanCanvas: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  usePlan: () => ({ cmPerPx: 1, toPlan: () => [0, 0] }),
  useDrag: () => () => {},
}));
vi.mock('../components/Studio3D', () => ({ Studio3D: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./PhotoView', () => ({ PhotoView: () => <div>photo</div> }));
vi.mock('../lib/roomGlare', () => ({
  roomGlare: vi.fn(() => ({ scene: { eye: null }, report: { lights: [], hazards: 0 }, posed: { lights: [] } })),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { suggest: vi.fn(async () => []), palettes: vi.fn(async () => []), catalog: vi.fn(async () => []), updateRoom: vi.fn(() => new Promise(() => {})) },
}));

const office = {
  name: 'Office', units: 'imperial', outline: [[0, 0], [400, 0], [400, 300], [0, 300]], width: 400, height: 300, ceiling: 250,
  furniture: [{ id: 'd1', kind: 'desk', label: 'Desk', x: 100, y: 100, width: 120, depth: 60, rotation: 0, shape: 'rect' }],
  openings: [], lights: [], photo: null,
} as never;

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ rooms: [office], lights: {}, profiles: null, layout: null, layouts: [], replaceRoom: vi.fn() as never, refreshRooms: vi.fn() as never });
  useUi.setState({ showing: null, lightingOpen: false, posture: 'seated', glareMode: 'code' } as never);
});

describe('RoomDesigner', () => {
  for (const tab of ['plan', '3d', 'photo'] as const) {
    it(`shows "No room named" when the room goes away under it (${tab})`, () => {
      useUi.setState({ lightingOpen: true });
      const view = render(<RoomDesigner name="Office" tab={tab} />);
      expect(screen.queryByText(/No room named/)).toBeNull();
      useStore.setState({ rooms: [] });
      view.rerender(<RoomDesigner name="Office" tab={tab} />);
      expect(screen.getByText('No room named “Office”')).toBeTruthy();
    });
  }
});
