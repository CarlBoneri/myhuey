/**
 * A four-point homography: the perspective map between the floor in a photo and the floor
 * plan. It is exact for points on the floor plane, so a light's photo point should be where
 * it meets the floor (a lamp's base), not its top.
 */
export type Pt2 = [number, number];
export type Homography = number[]; // 9 values, row-major, h[8] = 1

/** The homography taking each `from` point to its `to` point, or null if the points are degenerate. */
export function solveHomography(from: Pt2[], to: Pt2[]): Homography | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-12) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let k = col; k < 9; k++) rows[row][k] -= factor * rows[col][k];
    }
  }
  const h = rows.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function applyHomography(h: Homography, [x, y]: Pt2): Pt2 {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function weight(h: Homography, [x, y]: Pt2): number {
  return h[6] * x + h[7] * y + h[8];
}

/**
 * Both directions between a photo's floor and the plan, refusing points on the wrong side of
 * the horizon (photo) or behind the camera (plan): there the math still gives an answer, but
 * it isn't a point on the floor. Null if the points are degenerate.
 */
export function floorMapper(photo: Pt2[], plan: Pt2[]): { toPlan: (p: Pt2) => Pt2 | null; toPhoto: (p: Pt2) => Pt2 | null } | null {
  const forward = solveHomography(photo, plan);
  const back = solveHomography(plan, photo);
  if (!forward || !back) return null;
  const forwardSign = Math.sign(weight(forward, photo[0]));
  const backSign = Math.sign(weight(back, plan[0]));
  const guarded = (h: Homography, sign: number) => (p: Pt2): Pt2 | null => {
    const w = weight(h, p);
    return Math.sign(w) === sign && Math.abs(w) > 1e-9 ? applyHomography(h, p) : null;
  };
  return { toPlan: guarded(forward, forwardSign), toPhoto: guarded(back, backSign) };
}
