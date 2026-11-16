import { Vector3 } from "three";
import type { Frame, Params, Sigma, StereoPoint, TerrainSource } from "./types";
import { intersect } from "./terrain";
import { IMG_H, IMG_W, makeCam, pixelRay, setPose } from "./sensor";
import { pct, randn } from "./errors";
import { realizePair } from "./georef";
import { rng } from "./terrain";

type Point = [number, number];
type StereoError = Pick<Params, "stereoCorr" | "matchPx">;

/** Closest approach of two rays; returns the midpoint and the gap between them (null if parallel or behind a camera). */
export function triangulate(
  c1: Vector3,
  d1: Vector3,
  c2: Vector3,
  d2: Vector3,
) {
  const w = c1.clone().sub(c2),
    b = d1.dot(d2),
    d = d1.dot(w),
    e = d2.dot(w),
    den = 1 - b * b;
  if (den < 1e-9) return null;
  const s = (b * e - d) / den,
    t = (e - b * d) / den;
  if (s < 0 || t < 0) return null;
  const p1 = c1.clone().addScaledVector(d1, s),
    p2 = c2.clone().addScaledVector(d2, t);
  return { p: p1.clone().add(p2).multiplyScalar(0.5), gap: p1.distanceTo(p2) };
}

/**
 * Ground coordinates from the same feature clicked in both images of a pair (no DEM needed).
 * Estimate: intersect the two pixel rays from the navigation-solution poses.
 * Uncertainty (Monte Carlo): draw both true poses from the stated errors (partly shared, see realizePair), add matching
 * noise to the two clicks, re-intersect, and take the 90th percentiles of the displacement from the estimate.
 */
export function stereoSolve(
  leftFrame: Frame,
  rightFrame: Frame,
  pointLeft: Point,
  pointRight: Point,
  sigma: Sigma,
  stereoError: StereoError,
  dem: TerrainSource,
  truth: TerrainSource,
  n = 300,
): StereoPoint | null {
  const cl = leftFrame.nominal.cam,
    cr = rightFrame.nominal.cam;
  const t = triangulate(
    cl.position,
    pixelRay(cl, pointLeft[0], pointLeft[1]),
    cr.position,
    pixelRay(cr, pointRight[0], pointRight[1]),
  );
  if (!t) return null;
  const p = t.p,
    B = cl.position.distanceTo(cr.position),
    H = (cl.position.y + cr.position.y) / 2 - p.y;
  const dpx = (pointLeft[1] - pointRight[1]) * (IMG_H / 2),
    fpx = IMG_H / 2 / Math.tan((cl.fov * Math.PI) / 360);

  const r = rng(2024),
    a = makeCam(),
    b = makeCam(),
    hz: number[] = [],
    dz: number[] = [],
    d3: number[] = [];
  const noisy = (v: number, half: number) =>
    v + (stereoError.matchPx * randn(r)) / half;
  for (let i = 0; i < n; i++) {
    const [qa, qb] = realizePair(
      leftFrame.nominal.pose,
      rightFrame.nominal.pose,
      sigma,
      9000 + i,
      stereoError.stereoCorr,
    );
    setPose(a, qa);
    setPose(b, qb);
    const q = triangulate(
      a.position,
      pixelRay(
        a,
        noisy(pointLeft[0], IMG_W / 2),
        noisy(pointLeft[1], IMG_H / 2),
      ),
      b.position,
      pixelRay(
        b,
        noisy(pointRight[0], IMG_W / 2),
        noisy(pointRight[1], IMG_H / 2),
      ),
    );
    if (!q) continue;
    hz.push(Math.hypot(q.p.x - p.x, q.p.z - p.z));
    dz.push(Math.abs(q.p.y - p.y));
    d3.push(q.p.distanceTo(p));
  }
  const tp = intersect(
    truth,
    leftFrame.truth.cam.position,
    pixelRay(leftFrame.truth.cam, pointLeft[0], pointLeft[1]),
  );
  return {
    p,
    gap: t.gap,
    dpx,
    B,
    H,
    hClassic: dpx > 0 ? cl.position.y - (B * fpx) / dpx : NaN,
    demH: dem.height(p.x, p.z),
    cep: pct(hz, 0.9),
    lep: pct(dz, 0.9),
    sep: pct(d3, 0.9),
    truthErr: tp
      ? { hz: Math.hypot(p.x - tp.x, p.z - tp.z), dz: p.y - tp.y }
      : null,
  };
}
