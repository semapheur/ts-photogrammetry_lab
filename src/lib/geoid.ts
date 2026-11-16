import { N0 } from "./terrain";

/**
 * Geoid undulation N from the terrain's mass distribution.
 * The topography is treated as a thin layer of rock whose gravitational potential at a point is the single-layer
 * integral  T(x) = G·rho · SUM h'(x') / r  (a softened 1/r kernel), and N = T / gamma. Terrain above the mean (hills) is
 * a mass excess and raises the geoid; terrain below it (valleys, lakes) is a deficit and lowers it. Using the height
 * anomaly h' = h - mean(h) keeps a finite tile from sagging at its edges.
 * A 1 km tile gives centimetres in reality, so the result is scaled to a peak-to-peak range of `range` metres around
 * N0 (visualisation scale; the "geoid exaggeration" slider scales it further for display only).
 *
 * @param h     terrain heights, n x n grid (row-major) covering `size` metres
 * @param range peak-to-peak undulation in metres
 * @param G     nodes per side of the coarse grid the potential is computed on (cost ~ G^4)
 */
export function massGeoid(
  h: Float32Array,
  n: number,
  size: number,
  range = 8,
  G = 65,
): (x: number, z: number) => number {
  const cell = size / (G - 1),
    step = (n - 1) / (G - 1),
    rad = Math.max(1, Math.round(step / 2));
  // 1. mass per coarse node: mean height around it
  const m = new Float64Array(G * G);
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      let s = 0,
        c = 0;
      for (let dj = -rad; dj <= rad; dj++)
        for (let di = -rad; di <= rad; di++) {
          const fi = Math.round(i * step) + di,
            fj = Math.round(j * step) + dj;
          if (fi >= 0 && fj >= 0 && fi < n && fj < n) {
            s += h[fj * n + fi];
            c++;
          }
        }
      m[j * G + i] = s / c;
    }
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  for (let k = 0; k < m.length; k++) m[k] -= mean; // anomaly

  // 2. potential: convolve with the softened 1/r kernel (it depends only on the node offset)
  const W = 2 * G - 1,
    eps = 1.5 * cell,
    K = new Float64Array(W * W);
  for (let dj = -(G - 1); dj <= G - 1; dj++)
    for (let di = -(G - 1); di <= G - 1; di++)
      K[(dj + G - 1) * W + (di + G - 1)] =
        1 / Math.sqrt((di * cell) ** 2 + (dj * cell) ** 2 + eps * eps);
  const phi = new Float64Array(G * G);
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      let s = 0;
      for (let l = 0; l < G; l++) {
        const row = (j - l + G - 1) * W + (i + G - 1),
          base = l * G;
        for (let k = 0; k < G; k++) s += m[base + k] * K[row - k];
      }
      phi[j * G + i] = s;
    }

  // 3. normalise to the requested range around N0
  let lo = Infinity,
    hi = -Infinity,
    avg = 0;
  for (const v of phi) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    avg += v;
  }
  avg /= phi.length;
  const scale = hi > lo ? range / (hi - lo) : 0,
    N = new Float64Array(G * G);
  for (let k = 0; k < N.length; k++) N[k] = N0 + (phi[k] - avg) * scale;

  return (x, z) => {
    // bilinear interpolation
    const fx = Math.min(G - 1.001, Math.max(0, (x + size / 2) / cell)),
      fz = Math.min(G - 1.001, Math.max(0, (z + size / 2) / cell));
    const i = fx | 0,
      j = fz | 0,
      tx = fx - i,
      tz = fz - j,
      k = j * G + i;
    return (
      (N[k] * (1 - tx) + N[k + 1] * tx) * (1 - tz) +
      (N[k + G] * (1 - tx) + N[k + G + 1] * tx) * tz
    );
  };
}
