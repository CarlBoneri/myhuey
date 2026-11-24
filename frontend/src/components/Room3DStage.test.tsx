// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '../test/dom';
import { glareScene, traceGlare } from '../lib/glareMath';
import type { Furniture, Placement, Room } from '../types';
import { useStore } from '../store';
import { Room3DStage } from './Room3DStage';

const screen = (id: string, curve: number | null, x: number): Furniture => ({
  id, kind: 'monitor-49', label: id, x, y: 60, width: 119.8, depth: 10, rotation: 0, shape: 'rect', elevation: 75, height: 33.7, curve,
});
const room = (furniture: Furniture[]): Room => ({
  name: 'Office', x: 0, y: 0, units: 'metric', outline: [[0, 0], [400, 0], [400, 400], [0, 400]], width: 400, height: 400,
  ceiling: 250, lights: [], furniture, photo: null, openings: [],
});

const mount = (furniture: Furniture[]) => {
  const r = room(furniture);
  const scene = glareScene(r, 'seated', 'code', () => 0);
  render(<Room3DStage room={r} posed={r} view="orbit" selection={null} onSelect={() => {}} onLight={() => {}} onLightCommit={() => {}}
    onRoom={() => {}} onRigCommit={() => {}} scene={scene} report={traceGlare(scene)} />);
};

describe('Room3DStage screens', () => {
  it('draws a curved screen as its strips and a flat one as one panel', () => {
    mount([screen('g9', 1000, 120), screen('flat', null, 280)]);
    expect(document.querySelectorAll('[data-screen="g9"] polygon')).toHaveLength(12);
    expect(document.querySelectorAll('[data-screen="flat"] polygon')).toHaveLength(1);
  });
});

describe('Room3DStage mounted bias lights', () => {
  const tv: Furniture = { id: 'tv', kind: 'tv', label: 'TV', x: 200, y: 30, width: 145, depth: 8, rotation: 0, shape: 'rect', elevation: 100, height: 84 };
  const strip = { light_id: '9', label: 'Strip', x: 200, y: 26, rotation: 0, length: 300, product: { archetype: 'huelightstriptv' }, metadata: {},
    role: 'bias', mount: { screen: 'tv' }, elevation: 142, resolved_elevation: 142 } as Placement;
  const lit = (on: boolean) => useStore.setState({ lights: { 9: { id: '9', name: 'Strip', on, reachable: true, brightness: 200, color: '#ffeedd' } } as never });
  const show = () => {
    const r = { ...room([tv]), lights: [strip] };
    const scene = glareScene(r, 'seated', 'code', () => 0);
    render(<Room3DStage room={r} posed={r} view="orbit" selection={null} onSelect={() => {}} onLight={() => {}} onLightCommit={() => {}}
      onRoom={() => {}} onRigCommit={() => {}} scene={scene} report={traceGlare(scene)} />);
  };
  it('throws a halo on the wall behind its screen while it is on', () => {
    lit(true);
    show();
    expect(document.querySelectorAll('[data-halo="9"]')).toHaveLength(1);
    expect(document.querySelector('[data-light="9"] polyline.v3-loop')).toBeTruthy();
  });
  it('throws none while it is off', () => {
    lit(false);
    show();
    expect(document.querySelectorAll('[data-halo]')).toHaveLength(0);
  });
});
