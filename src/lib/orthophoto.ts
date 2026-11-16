import { Vector3, type PerspectiveCamera } from "three";
import type { Frame, TerrainSource } from "./types";
import { intersect } from "./terrain";
import { pixelRay } from "./sensor";

/** Square, north-up map window (centre and width in metres). */
export interface OrthoWindow {
  cx: number;
  cz: number;
  size: number;
}

/** The smallest square window around the image footprint (on the DEM), with a small margin. null if a corner misses the DEM. */
export function footprintWindow(
  cam: PerspectiveCamera,
  dem: TerrainSource,
): OrthoWindow | null {
  const pts = (
    [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ] as const
  ).map(([x, y]) => intersect(dem, cam.position, pixelRay(cam, x, y)));
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x),
    zs = pts.map((p) => p!.z),
    x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  return {
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    size: Math.max(x1 - x0, z1 - z0) * 1.04,
  };
}

export interface WarpStats {
  n: number; // cells with a valid comparison
  rmse: number;
  p50: number;
  p90: number;
  max: number; // total positional error of the orthophoto (m)
  shiftE: number;
  shiftN: number;
  shift: number; // its mean (a uniform offset), E / N / magnitude (m)
  warpRmse: number;
  warpP50: number;
  warpP90: number; // what is left after removing the best-fit affine part (shift, rotation, scale, shear)
}
export interface WarpField {
  G: number;
  total: Float32Array;
  warp: Float32Array;
  stats: WarpStats;
}

const percentile = (a: number[], q: number) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(q * a.length))
      ]
    : 0;

/** Solve the 3x3 normal equations A c = b by Cramer's rule. */
function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A) || 1e-12;
  return [0, 1, 2].map(
    (c) => det(A.map((row, r) => row.map((v, k) => (k === c ? b[r] : v)))) / d,
  );
}

/**
 * How wrong is the orthophoto, cell by cell? Orthorectification places the content of image pixel p at the ground
 * position (x, z) where the estimated camera + DEM say it belongs. The true camera + true surface say where that
 * content really is. The difference is the positional error of the orthophoto at (x, z). A uniform part of it is just a
 * shift (navigation error); what remains after fitting an affine transform is warping, e.g. from a DEM that lacks
 * buildings, or is too coarse.
 */
export function warpField(
  f: Frame,
  cam: PerspectiveCamera,
  dem: TerrainSource,
  truth: TerrainSource,
  win: OrthoWindow,
  G = 128,
): WarpField {
  const dx = new Float32Array(G * G).fill(NaN),
    dz = new Float32Array(G * G).fill(NaN),
    U = new Float32Array(G * G),
    V = new Float32Array(G * G);
  const tc = f.truth.cam,
    o = tc.position,
    camSpace = new Vector3();
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const k = j * G + i,
        u = (i + 0.5) / G - 0.5,
        v = (j + 0.5) / G - 0.5,
        x = win.cx + u * win.size,
        z = win.cz + v * win.size;
      U[k] = u;
      V[k] = v;
      const p = new Vector3(x, dem.height(x, z), z);
      if (camSpace.copy(p).applyMatrix4(cam.matrixWorldInverse).z >= 0)
        continue; // behind the camera
      const q = p.project(cam);
      if (q.x < -1 || q.x > 1 || q.y < -1 || q.y > 1) continue; // outside the picture
      const hit = intersect(truth, o, pixelRay(tc, q.x, q.y));
      if (hit) {
        dx[k] = hit.x - x;
        dz[k] = hit.z - z;
      }
    }
  const ok: number[] = [];
  for (let k = 0; k < G * G; k++) if (!Number.isNaN(dx[k])) ok.push(k);
  const total = new Float32Array(G * G).fill(NaN),
    warp = new Float32Array(G * G).fill(NaN);
  if (ok.length < 8)
    return {
      G,
      total,
      warp,
      stats: {
        n: ok.length,
        rmse: 0,
        p50: 0,
        p90: 0,
        max: 0,
        shiftE: 0,
        shiftN: 0,
        shift: 0,
        warpRmse: 0,
        warpP50: 0,
        warpP90: 0,
      },
    };

  // affine fit of the displacement field: d = a + b u + c v, separately for the x and z components
  const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    bx = [0, 0, 0],
    bz = [0, 0, 0];
  for (const k of ok) {
    const r = [1, U[k], V[k]];
    for (let a = 0; a < 3; a++) {
      bx[a] += r[a] * dx[k];
      bz[a] += r[a] * dz[k];
      for (let b = 0; b < 3; b++) A[a][b] += r[a] * r[b];
    }
  }
  const cx = solve3(A, bx),
    cz = solve3(A, bz);
  const mags: number[] = [],
    res: number[] = [];
  let sx = 0,
    sz = 0;
  for (const k of ok) {
    total[k] = Math.hypot(dx[k], dz[k]);
    mags.push(total[k]);
    sx += dx[k];
    sz += dz[k];
    warp[k] = Math.hypot(
      dx[k] - (cx[0] + cx[1] * U[k] + cx[2] * V[k]),
      dz[k] - (cz[0] + cz[1] * U[k] + cz[2] * V[k]),
    );
    res.push(warp[k]);
  }
  const rms = (a: number[]) =>
    Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  return {
    G,
    total,
    warp,
    stats: {
      n: ok.length,
      rmse: rms(mags),
      p50: percentile(mags, 0.5),
      p90: percentile(mags, 0.9),
      max: Math.max(...mags),
      shiftE: sx / ok.length,
      shiftN: -sz / ok.length,
      shift: Math.hypot(sx, sz) / ok.length,
      warpRmse: rms(res),
      warpP50: percentile(res, 0.5),
      warpP90: percentile(res, 0.9),
    },
  };
}

/** G x G canvas colouring `values` from blue (0) through green and yellow to red (`scale`); NaN cells are transparent. */
export function heatCanvas(
  values: Float32Array,
  G: number,
  scale: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = G;
  const ctx = c.getContext("2d")!;
  for (let k = 0; k < values.length; k++) {
    if (Number.isNaN(values[k])) continue;
    ctx.fillStyle = `hsl(${240 * (1 - Math.min(1, values[k] / scale))} 90% 50%)`;
    ctx.fillRect(k % G, Math.floor(k / G), 1, 1);
  }
  return c;
}
