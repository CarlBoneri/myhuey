import { describe, expect, it } from 'vitest';
import { applyHomography, solveHomography } from './homography';

describe('four-point homography', () => {
  const photo: [number, number][] = [[0.1, 0.9], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]];
  const plan: [number, number][] = [[0, 400], [400, 400], [400, 0], [0, 0]];

  it('maps the four points exactly', () => {
    const h = solveHomography(photo, plan)!;
    photo.forEach((p, i) => {
      const [x, y] = applyHomography(h, p);
      expect(x).toBeCloseTo(plan[i][0], 6);
      expect(y).toBeCloseTo(plan[i][1], 6);
    });
  });

  it('round-trips through the inverse', () => {
    const forward = solveHomography(photo, plan)!;
    const back = solveHomography(plan, photo)!;
    const [x, y] = applyHomography(forward, [0.5, 0.7]);
    const [u, v] = applyHomography(back, [x, y]);
    expect(u).toBeCloseTo(0.5, 6);
    expect(v).toBeCloseTo(0.7, 6);
  });

  it('puts the far half of the floor in the upper part of the photo (perspective, not a plain scale)', () => {
    const h = solveHomography(photo, plan)!;
    const nearMiddle = applyHomography(h, [0.5, 0.8]);
    const farMiddle = applyHomography(h, [0.5, 0.55]);
    expect(nearMiddle[1]).toBeGreaterThan(farMiddle[1]);
    expect(nearMiddle[0]).toBeCloseTo(200, 3);
  });

  it('gives null for degenerate points', () => {
    expect(solveHomography([[0, 0], [1, 1], [2, 2], [3, 3]], plan)).toBeNull();
  });
});

import { floorMapper } from './homography';

describe('floor mapper guards', () => {
  const photo: [number, number][] = [[0.1, 0.9], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]];
  const plan: [number, number][] = [[0, 400], [400, 400], [400, 0], [0, 0]];
  const mapper = floorMapper(photo, plan)!;

  it('maps floor points both ways', () => {
    const [x, y] = mapper.toPlan([0.5, 0.7])!;
    const [u, v] = mapper.toPhoto([x, y])!;
    expect(u).toBeCloseTo(0.5, 6);
    expect(v).toBeCloseTo(0.7, 6);
  });

  it('refuses photo points beyond the horizon (they are not on the floor)', () => {
    expect(mapper.toPlan([0.5, 0.05])).toBeNull();
  });

  it('refuses plan points behind the camera', () => {
    expect(mapper.toPhoto([200, 5000])).toBeNull();
  });
});
