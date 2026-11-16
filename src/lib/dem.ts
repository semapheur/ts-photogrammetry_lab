import type { DemSource, TerrainSource } from "./types";

const STORE_MAX = 300_000;

/**
 * The elevation model a surveyor would deliver: the surface `t` sampled on a regular grid of posts `spacing` metres
 * apart, bilinear in between. Coarse DEMs are stored; fine ones (down to 1 cm) are evaluated on demand from the same
 * posts: each query samples the four surrounding posts, which gives exactly the same values as a stored grid.
 * Detail finer than the surface itself has (the terrain grid is 4.7 m; object edges are exact) cannot be recovered.
 */
export function makeDem(
  t: TerrainSource,
  size: number,
  spacing: number,
): DemSource {
  const n = Math.max(2, Math.round(size / spacing) + 1),
    step = size / (n - 1),
    stored = n * n <= STORE_MAX;
  const h = stored ? new Float32Array(n * n) : null;
  if (h)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        h[j * n + i] = t.height(i * step - size / 2, j * step - size / 2);

  const height = h
    ? (x: number, z: number) => {
        const fx = Math.min(n - 1.001, Math.max(0, (x + size / 2) / step)),
          fz = Math.min(n - 1.001, Math.max(0, (z + size / 2) / step));
        const i = fx | 0,
          j = fz | 0,
          tx = fx - i,
          tz = fz - j,
          k = j * n + i;
        return (
          (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) +
          (h[k + n] * (1 - tx) + h[k + n + 1] * tx) * tz
        );
      }
    : (x: number, z: number) => {
        const fx = Math.min(n - 1.001, Math.max(0, (x + size / 2) / step)),
          fz = Math.min(n - 1.001, Math.max(0, (z + size / 2) / step));
        const i = Math.floor(fx),
          j = Math.floor(fz),
          tx = fx - i,
          tz = fz - j,
          x0 = i * step - size / 2,
          z0 = j * step - size / 2;
        return (
          (t.height(x0, z0) * (1 - tx) + t.height(x0 + step, z0) * tx) *
            (1 - tz) +
          (t.height(x0, z0 + step) * (1 - tx) +
            t.height(x0 + step, z0 + step) * tx) *
            tz
        );
      };

  return {
    spacing: step,
    n,
    size,
    stored,
    height,
    geoidN: t.geoidN,
    maxHeight: t.maxHeight,
    patch(cx, cz, maxNodes) {
      const m = Math.min(n, maxNodes),
        clampI = (v: number) => Math.max(0, Math.min(n - m, v));
      const i0 = clampI(Math.round((cx + size / 2) / step) - (m >> 1)),
        j0 = clampI(Math.round((cz + size / 2) / step) - (m >> 1));
      const g = new Float32Array(m * m);
      for (let j = 0; j < m; j++)
        for (let i = 0; i < m; i++)
          g[j * m + i] = height(
            (i0 + i) * step - size / 2,
            (j0 + j) * step - size / 2,
          );
      return {
        n: m,
        x0: i0 * step - size / 2,
        z0: j0 * step - size / 2,
        step,
        heights: g,
      };
    },
    grid(maxNodes) {
      if (h && n <= maxNodes) return { n, heights: h };
      const m = Math.min(n, maxNodes),
        s = size / (m - 1),
        g = new Float32Array(m * m);
      for (let j = 0; j < m; j++)
        for (let i = 0; i < m; i++)
          g[j * m + i] = height(i * s - size / 2, j * s - size / 2);
      return { n: m, heights: g };
    },
  };
}
