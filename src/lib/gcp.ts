import { Vector3, type PerspectiveCamera } from "three";
import type {
  Correction,
  ErrorStats,
  Frame,
  GCP,
  Pose,
  Sigma,
  TerrainSource,
} from "./types";
import { intersect, rng } from "./terrain";
import { makeCam, pixelRay, setPose, IMG_W, IMG_H } from "./sensor";
import { pct, posSigma } from "./errors";

const HALF = [IMG_W / 2, IMG_H / 2]; // half image size (px)
const SIGMA_OBS = 3; // assumed GCP measurement noise (px)

function solveLin(A: number[][], b: number[]): number[] {
  const n = b.length,
    M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function invert(A: number[][]): number[][] {
  const n = A.length,
    M = A.map((r, i) => [
      ...r,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    ]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i];
    for (let j = 0; j < 2 * n; j++) M[i][j] /= d;
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const f = M[k][i];
        for (let j = 0; j < 2 * n; j++) M[k][j] -= f * M[i][j];
      }
  }
  return M.map((r) => r.slice(n));
}

/**
 * Single-image resection (simplified bundle adjustment): Levenberg-Marquardt over platform position (3) and attitude (3).
 * Observations are the GCP pixels vs. the projected map points; the navigation uncertainties act as priors, which
 * keeps position/attitude from trading off wildly when there are few points.
 * Also returns the posterior covariance of the pose, (J'J)^-1 at the solution: the GCPs tighten it below the prior.
 */
export function resect(
  obs: { nx: number; ny: number; X: Vector3 }[],
  pose0: Pose,
  s: Sigma,
) {
  const tmp = makeCam();
  const sigma = [
    ...posSigma(s.positionError),
    s.attitudeError.roll,
    s.attitudeError.pitch,
    s.attitudeError.yaw,
  ].map((v) => Math.max(v, 1e-3)); // x, y(up), z, roll, pitch, yaw
  const pose = (t: number[]): Pose => ({
    ...pose0,
    position: pose0.position.clone().add(new Vector3(t[0], t[1], t[2])),
    roll: t[3],
    pitch: t[4],
    yaw: t[5],
  });
  const pix = (t: number[]) => {
    setPose(tmp, pose(t));
    const out: number[] = [];
    for (const o of obs) {
      const q = o.X.clone().project(tmp);
      out.push((q.x - o.nx) * HALF[0], (q.y - o.ny) * HALF[1]);
    }
    return out;
  };
  const resid = (t: number[]) => [
    ...pix(t).map((v) => v / SIGMA_OBS),
    ...t.map((v, i) => v / sigma[i]),
  ];
  const rms = (t: number[]) => {
    const p = pix(t);
    let s2 = 0;
    for (let i = 0; i < p.length; i += 2) s2 += p[i] ** 2 + p[i + 1] ** 2;
    return Math.sqrt(s2 / obs.length);
  };
  const cost = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  /** Weighted Jacobian by finite differences, and the normal matrix J'J. */
  const jacobian = (t: number[], r: number[]) => {
    const J = r.map(() => new Array<number>(6).fill(0));
    for (let k = 0; k < 6; k++) {
      const h = k < 3 ? 0.05 : 0.002,
        t2 = [...t];
      t2[k] += h;
      const r2 = resid(t2);
      for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / h;
    }
    const A = Array.from({ length: 6 }, (_, a) =>
      Array.from({ length: 6 }, (_, b) =>
        J.reduce((s2, row) => s2 + row[a] * row[b], 0),
      ),
    );
    return { J, A };
  };

  let t = [0, 0, 0, 0, 0, 0],
    r = resid(t),
    c = cost(r),
    lam = 1e-3;
  const rms0 = rms(t);
  for (let it = 0; it < 50; it++) {
    const { J, A } = jacobian(t, r);
    const g = Array.from({ length: 6 }, (_, a) =>
      J.reduce((s2, row, i) => s2 + row[a] * r[i], 0),
    );
    let moved = false;
    for (let tries = 0; tries < 8 && !moved; tries++) {
      const M = A.map((row, i) =>
        row.map((v, j) => (i === j ? v * (1 + lam) + 1e-9 : v)),
      );
      const t2 = t.map(
          (v, i) =>
            v +
            solveLin(
              M,
              g.map((x) => -x),
            )[i],
        ),
        r2 = resid(t2),
        c2 = cost(r2);
      if (c2 < c) {
        const gain = c - c2;
        t = t2;
        r = r2;
        c = c2;
        lam = Math.max(lam / 3, 1e-9);
        moved = gain > 1e-9 * c + 1e-12;
        if (!moved) it = 99;
        moved = true;
      } else lam *= 5;
    }
    if (!moved) break;
  }
  return { pose: pose(t), rms0, rms1: rms(t), cov: invert(jacobian(t, r).A) };
}

/** Ground error over the image vs. the true terrain positions (needs the hidden truth pose). */
export function evaluate(
  truth: TerrainSource,
  dem: TerrainSource,
  f: Frame,
  cam: PerspectiveCamera,
  n = 200,
): ErrorStats {
  const r = rng(4242),
    hz: number[] = [],
    dz: number[] = [];
  for (let i = 0; i < n; i++) {
    const nx = (r() * 2 - 1) * 0.95,
      ny = (r() * 2 - 1) * 0.95;
    const q = intersect(
        truth,
        f.truth.cam.position,
        pixelRay(f.truth.cam, nx, ny),
      ),
      p = intersect(dem, cam.position, pixelRay(cam, nx, ny));
    if (!q || !p) continue;
    hz.push(Math.hypot(p.x - q.x, p.z - q.z));
    dz.push(Math.abs(p.y - q.y));
  }
  return {
    rmse: Math.sqrt(hz.reduce((a, b) => a + b * b, 0) / Math.max(1, hz.length)),
    cep90: pct(hz, 0.9),
    lep90: pct(dz, 0.9),
  };
}

/** Fit the pose to the GCPs, install it as the frame's current estimate and score before/after against the truth. */
export function correct(
  f: Frame,
  gcps: GCP[],
  truth: TerrainSource,
  dem: TerrainSource,
  s: Sigma,
): Correction {
  const fit = resect(
    gcps.map((g) => ({ nx: g.nx, ny: g.ny, X: g.map })),
    f.nominal.pose,
    s,
  );
  const cam = makeCam();
  setPose(cam, fit.pose);
  const hz = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  const at = (c: PerspectiveCamera, g: GCP) =>
    intersect(dem, c.position, pixelRay(c, g.nx, g.ny));
  const rows = gcps.map((g) => {
    const b = at(f.nominal.cam, g),
      a = at(cam, g);
    return {
      click: hz(g.map, g.truePt),
      before: b ? hz(b, g.truePt) : NaN,
      after: a ? hz(a, g.truePt) : NaN,
    };
  });
  f.cam = cam;
  f.pose = fit.pose;
  f.cov = fit.cov;
  const n = f.nominal.pose.position,
    p = fit.pose.position;
  return {
    dPos: [p.x - n.x, -(p.z - n.z), p.y - n.y],
    dAtt: [fit.pose.roll, fit.pose.pitch, fit.pose.yaw],
    rms0: fit.rms0,
    rms1: fit.rms1,
    before: evaluate(truth, dem, f, f.nominal.cam),
    after: evaluate(truth, dem, f, cam),
    rows,
  };
}
