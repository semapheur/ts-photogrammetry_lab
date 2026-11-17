import { Vector3, type PerspectiveCamera } from "three";
import type { GroundPoint, Params, Pose, Sigma, TerrainSource } from "./types";
import { intersect, rng } from "./terrain";
import { makeCam, pixelRay, setPose } from "./sensor";
import { cholesky, pct, randn, posSigma } from "./errors";

export const ORIGIN = { lat: 59.4138, lon: 5.268, E: 300000, N: 6590000 };
const D = Math.PI / 180;
export const latLon = (x: number, z: number) =>
  [
    ORIGIN.lat - z / 111320,
    ORIGIN.lon + x / (111320 * Math.cos(ORIGIN.lat * D)),
  ] as const;

/**
 * Geolocate one pixel and propagate errors to the ground point.
 * The estimate is the nominal pixel ray intersected with the DEM. Each Monte Carlo draw perturbs the platform
 * position (sigma_h per horizontal axis, sigma_v vertical) and attitude, then intersects the perturbed ray with
 * (a) the TRUTH terrain -> total error, sensor + DEM, and (b) the DEM -> sensor-only error. The 90th percentiles of
 * the displacement from the estimate give CEP90 / LEP90 / SEP90. Slant range, look angle and terrain are included exactly.
 * Pose errors come from the navigation prior (sigmas `s`), or, once a frame has been adjusted to GCPs, from the posterior
 * covariance `cov` of that adjustment (which is much tighter).
 */
export function locate(
  truth: TerrainSource,
  dem: TerrainSource,
  s: Sigma,
  pose: Pose,
  cam: PerspectiveCamera,
  nx: number,
  ny: number,
  cov: number[][] | null = null,
  n = 300,
): GroundPoint | null {
  const d = pixelRay(cam, nx, ny),
    p = intersect(dem, cam.position, d);
  if (!p) return null;
  const pf = cam.position.clone().addScaledVector(d, -cam.position.y / d.y); // flat-datum assumption
  const r = rng(1337),
    [sx, sy, sz] = posSigma(s.positionError),
    sa = s.attitudeError,
    tmp = makeCam(),
    L = cov ? cholesky(cov) : null;
  const mk = () => ({
      hz: [] as number[],
      dz: [] as number[],
      d3: [] as number[],
    }),
    T = mk(),
    S = mk();
  const add = (o: ReturnType<typeof mk>, q: Vector3) => {
    o.hz.push(Math.hypot(q.x - p.x, q.z - p.z));
    o.dz.push(Math.abs(q.y - p.y));
    o.d3.push(q.distanceTo(p));
  };
  for (let i = 0; i < n; i++) {
    const z = Array.from({ length: 6 }, () => randn(r));
    const d = L
      ? L.map((row) => row.reduce((a, v, k) => a + v * z[k], 0))
      : [
          sx * z[0],
          sy * z[1],
          sz * z[2],
          sa.roll * z[3],
          sa.pitch * z[4],
          sa.yaw * z[5],
        ];
    setPose(tmp, {
      ...pose,
      position: pose.position.clone().add(new Vector3(d[0], d[1], d[2])),
      roll: pose.roll + d[3],
      pitch: pose.pitch + d[4],
      yaw: pose.yaw + d[5],
    });
    const dir = pixelRay(tmp, nx, ny),
      qt = intersect(truth, tmp.position, dir),
      qs = intersect(dem, tmp.position, dir);
    if (qt) add(T, qt);
    if (qs) add(S, qs);
  }
  return {
    p,
    pf,
    slant: p.distanceTo(cam.position),
    off: Math.acos(Math.min(1, -d.y)) / D,
    rel: Math.hypot(pf.x - p.x, pf.z - p.z),
    cep: pct(T.hz, 0.9),
    lep: pct(T.dz, 0.9),
    sep: pct(T.d3, 0.9),
    cepS: pct(S.hz, 0.9),
    lepS: pct(S.dz, 0.9),
    sepS: pct(S.d3, 0.9),
    demErr: truth.height(p.x, p.z) - p.y,
  };
}

/** One random realisation of the true pose: the navigation solution plus errors drawn from the stated uncertainties. */
export function realizePose(nominal: Pose, s: Sigma, seed: number): Pose {
  const r = rng(seed * 104729 + 7);
  const [sx, sy, sz] = posSigma(s.positionError),
    sa = s.attitudeError;
  return {
    ...nominal,
    position: nominal.position
      .clone()
      .add(new Vector3(sx * randn(r), sy * randn(r), sz * randn(r))),
    roll: nominal.roll + sa.roll * randn(r),
    pitch: nominal.pitch + sa.pitch * randn(r),
    yaw: nominal.yaw + sa.yaw * randn(r),
  };
}

/** The navigation solution that, with the error drawn for `seed` and the current sigmas, corresponds to this fixed truth. */
export function navFromTruth(truth: Pose, s: Sigma, seed: number): Pose {
  const t0 = realizePose(truth, s, seed); // truth + e
  return {
    ...truth,
    position: truth.position.clone().multiplyScalar(2).sub(t0.position), // truth - e
    roll: 2 * truth.roll - t0.roll,
    pitch: 2 * truth.pitch - t0.pitch,
    yaw: 2 * truth.yaw - t0.yaw,
  };
}

/**
 * True poses for the two exposures of a stereo pair. Each error is a standard-normal draw that is part common to both
 * exposures (weight `corr`) and part independent, so corr = 1 shifts the whole pair together and corr = 0 makes
 * the exposures fully independent.
 */
export function realizePair(
  a: Pose,
  b: Pose,
  s: Sigma,
  seed: number,
  corr: number,
): [Pose, Pose] {
  const r = rng(seed * 104729 + 11),
    [sx, sy, sz] = posSigma(s.positionError),
    sa = s.attitudeError,
    k = Math.sqrt(Math.max(0, 1 - corr * corr));
  const z = () => Array.from({ length: 6 }, () => randn(r)),
    zc = z(),
    za = z(),
    zb = z();
  const mk = (n: Pose, zi: number[]): Pose => {
    const e = zc.map((v, i) => corr * v + k * zi[i]);
    return {
      ...n,
      position: n.position
        .clone()
        .add(new Vector3(sx * e[0], sy * e[1], sz * e[2])),
      roll: sa.roll * e[3],
      pitch: sa.pitch * e[4],
      yaw: sa.yaw * e[5],
    };
  };
  return [mk(a, za), mk(b, zb)];
}
