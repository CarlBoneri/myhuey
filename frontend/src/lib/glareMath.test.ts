import { describe, expect, it } from 'vitest';
import type { Furniture, Placement, Room } from '../types';
import { blocked, capText, dimTo, displayOf, glareScene, seatOf, summary, traceGlare, type GlareStatus } from './glareMath';
import { moveRig, posedRoom, riders } from './rig';

// One upright screen, so the numbers can be checked by hand: the screen plane is y = 101, its
// center (200, 101, 95), the seat (200, 160), the eye (200, 160, 115).
const monitor = (more: Partial<Furniture> = {}): Furniture => ({
  id: 'm', kind: 'monitor-27', label: '27', x: 200, y: 100, width: 60, depth: 2, rotation: 0, shape: 'rect', elevation: 75, height: 40, tilt: 0, ...more,
});
const light = (id: string, x: number, y: number, z: number, more: Partial<Placement> = {}): Placement => ({
  light_id: id, label: id, x, y, rotation: 0, length: null, product: {}, metadata: {}, elevation: z, resolved_elevation: z, role: 'auto', ...more,
});
const room = (lights: Placement[], furniture: Furniture[] = [monitor()]): Room => ({
  name: 'R', x: 0, y: 0, units: 'metric', outline: [[0, 0], [400, 0], [400, 400], [0, 400]], width: 400, height: 400,
  lights, furniture, photo: null, ceiling: 244, openings: [],
});
const lengthOf = (placement: Placement) => placement.length ?? 0;
const trace = (r: Room, mode = 'code') => traceGlare(glareScene(r, 'seated', mode, lengthOf));
const statuses = (r: Room, mode = 'code'): Record<string, GlareStatus> =>
  Object.fromEntries(trace(r, mode).lights.map((l) => [l.light_id, l.status]));

describe('the seat and the screen', () => {
  it('seats you 60 cm in front of the screen, looking at its middle', () => {
    expect(seatOf(room([]))).toEqual({ eye: [200, 160, 115], target: [200, 100, 95] });
    expect(seatOf(room([]), 'standing')!.eye[2]).toBe(155);
    expect(seatOf(room([], []))).toBeNull();
  });
  it('describes the screen plane, tilted back when it leans', () => {
    const upright = displayOf(monitor());
    expect(upright.center).toEqual([200, 101, 95]);
    [0, 1, 0].forEach((value, i) => expect(upright.normal[i]).toBeCloseTo(value, 6));
    const leaning = displayOf(monitor({ tilt: -12 })).normal;
    expect(leaning[1]).toBeCloseTo(0.97815, 4);
    expect(leaning[2]).toBeCloseTo(0.20791, 4);
    expect(displayOf(monitor({ tilt: undefined })).normal[2]).toBeCloseTo(0.20791, 4); // monitors lean back 12° unless told
  });
});

describe('traceGlare', () => {
  it('flags a light behind the seat that bounces off the screen', () => {
    const report = trace(room([light('back', 200, 300, 115)]));
    expect(report.hazards).toBe(1);
    expect(report.lights[0]).toMatchObject({ status: 'screen_reflection', cap: { brightness: 18, kelvin: 2700 } });
    expect(report.lights[0].hazards[0].path).toEqual([[200, 300, 115], [200, 101, 115], [200, 160, 115]]);
  });
  it('clears a ceiling light whose bounce lands above an upright screen', () => {
    expect(statuses(room([light('ceiling', 200, 300, 240)]))).toEqual({ ceiling: 'clear' }); // 48.6 cm above the center
  });
  it('clears a light hidden from the screen by a pillar', () => {
    const pillar: Furniture = { id: 'p', kind: 'pillar-square', label: '', x: 200, y: 230, width: 30, depth: 30, rotation: 0, shape: 'rect', elevation: 0, height: 244 };
    expect(statuses(room([light('back', 200, 300, 115)], [monitor(), pillar]))).toEqual({ back: 'clear' });
  });
  it('tells direct, peripheral, bias, and hidden lights apart', () => {
    const r = room([
      light('ahead', 230, 20, 130), // 27.2° off the gaze, above the screen's top edge
      light('side', 330, 60, 130), // 56.8°
      light('halo', 200, 90, 95), // 11 cm behind the screen
      light('hidden', 200, 20, 100), // straight ahead, behind the monitor itself
      light('pinned', 330, 60, 130, { role: 'bias' }),
    ]);
    expect(statuses(r)).toEqual({ ahead: 'direct_fov', side: 'peripheral_warn', halo: 'bias_ok', hidden: 'clear', pinned: 'bias_ok' });
    const caps = Object.fromEntries(trace(r).lights.map((l) => [l.light_id, l.cap]));
    expect(caps.ahead).toEqual({ brightness: 15, kelvin: null });
    expect(caps.side).toEqual({ brightness: 35, kelvin: null });
    const work = trace(r, 'work').lights.find((l) => l.light_id === 'side')!;
    expect(work.status).toBe('peripheral_warn');
    expect(work.cap).toBeNull();
    expect(trace(r).lights.find((l) => l.light_id === 'ahead')!.angle).toBeCloseTo(27.2, 1);
  });
  it('flags a strip when only its end reflects', () => {
    // Samples at x = 250, 325, 400, 475, 550: the x = 250 end bounces 11.4 cm right of center, the middle 45.7 cm.
    expect(statuses(room([light('bulb', 400, 300, 115)]))).toEqual({ bulb: 'clear' });
    expect(statuses(room([light('strip', 400, 300, 115, { length: 300 })]))).toEqual({ strip: 'screen_reflection' });
  });
  it('finds no seat, and no glare, in an empty room', () => {
    const report = trace(room([light('1', 10, 10, 150)], []));
    expect(report).toEqual({ hazards: 0, lights: [{ light_id: '1', label: '1', status: 'clear', angle: null, cap: null, hazards: [] }] });
  });
  it('survives a light at the eye and one in the screen plane', () => {
    const report = trace(room([light('at_eye', 200, 160, 115), light('in_plane', 300, 101, 95)]));
    for (const l of report.lights) for (const h of l.hazards) expect(h.path.flat().every(Number.isFinite)).toBe(true);
    expect(report.lights[0].angle).toBeNull();
  });
  it('sees no reflection in a screen turned away from the light', () => {
    const r = room([light('back', 200, 300, 180)], [monitor({ rotation: 180 })]);
    expect(seatOf(r)!.eye.map(Math.round)).toEqual([200, 40, 115]);
    expect(trace(r).lights[0].hazards.filter((h) => h.kind === 'screen_reflection')).toEqual([]);
  });
  it('does not let a desk hide the strip lying on it', () => {
    const desk = { id: 'd', x: 200, y: 150, rotation: 0, width: 140, depth: 70, z0: 0, z1: 75 };
    expect(blocked([150, 150, 75], [200, 160, 115], desk)).toBe(false);
    expect(blocked([150, 150, 20], [150, 150, 200], desk)).toBe(true);
  });
});

describe('words and dimming', () => {
  it('describes caps and totals', () => {
    expect(capText({ brightness: 18, kelvin: 2700 })).toBe('Keep at 18% or less, 2700 K or warmer');
    expect(capText({ brightness: 15, kelvin: null })).toBe('Keep at 15% or less');
    expect(capText(null)).toBe('');
    expect([0, 1, 3].map((hazards) => summary({ hazards, lights: [] }))).toEqual(['No glare found', '1 light needs attention', '3 lights need attention']);
  });
  it('only ever dims a lit light that is over its cap', () => {
    const cap = { brightness: 18, kelvin: 2700 };
    expect(dimTo(cap, { on: true, brightness: 254 })).toBe(46);
    expect(dimTo(cap, { on: true, brightness: 20 })).toBeNull();
    expect(dimTo(cap, { on: false, brightness: 254 })).toBeNull();
    expect(dimTo(cap, undefined)).toBeNull(); // a planned light: nothing on the bridge
    expect(dimTo(null, { on: true, brightness: 254 })).toBeNull();
  });
});

describe('what rests on a desk', () => {
  const desk: Furniture = { id: 'd', kind: 'desk', label: '', x: 200, y: 150, width: 140, depth: 70, rotation: 0, shape: 'rect', elevation: 0, height: 75 };
  const shelf: Furniture = { id: 'b', kind: 'bookshelf', label: '', x: 30, y: 30, width: 40, depth: 30, rotation: 0, shape: 'rect', elevation: 0, height: 180 };
  const r = room(
    [light('on', 240, 160, 80), light('under', 200, 150, 20), light('far', 380, 380, 80)],
    [desk, monitor({ y: 130 }), shelf],
  );
  it('finds the screens and lights on top, not what is under or elsewhere', () => {
    expect(riders(r, desk)).toEqual({ furniture: ['m'], lights: ['on'] });
  });
  it('carries them when the desk moves or turns', () => {
    const moved = moveRig(r, 'd', 10, -20);
    expect(moved.furniture.map((f) => [f.x, f.y])).toEqual([[210, 130], [210, 110], [30, 30]]);
    expect(moved.lights.map((l) => [l.x, l.y])).toEqual([[250, 140], [200, 150], [380, 380]]);
    const turned = moveRig(r, 'd', 0, 0, 90);
    expect(turned.furniture[1]).toMatchObject({ x: 220, y: 150, rotation: 90 }); // 20 cm behind the desk's middle swings to its side
    expect(r.furniture[1].y).toBe(130); // the room given is not changed
  });
  it('raises a sit-stand desk and its riders when you stand', () => {
    expect(posedRoom(r, 'seated')).toBe(r);
    const up = posedRoom(r, 'standing');
    expect(up.furniture.map((f) => [f.elevation, f.height])).toEqual([[0, 110], [110, 40], [0, 180]]);
    expect(up.lights.map((l) => l.resolved_elevation)).toEqual([115, 20, 80]);
  });
});
