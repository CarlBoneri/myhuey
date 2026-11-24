// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '../test/dom';
import { glareScene, traceGlare } from '../lib/glareMath';
import type { Furniture, Room } from '../types';
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
