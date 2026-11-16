import type { Feature, Terrain } from "./types";
import { rng } from "./terrain";
import { massGeoid } from "./geoid";
import { makeNoise } from "./noise";

export const SIZE = 1200,
  N = 257,
  CELL = SIZE / (N - 1);
export const Cover = {
  Grass: 0,
  Forest: 1,
  Water: 2,
  Urban: 3,
  Road: 4,
  Rock: 5,
} as const;
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pctl = (a: ArrayLike<number>, q: number) =>
  Float32Array.from(a).sort()[Math.floor(q * (a.length - 1))];

/**
 * Stochastic terrain from a seed:
 *  1. domain-warped fBm hills + ridged mountains - ridged valley lines, normalised to 0..170 m
 *  2. rivers: steepest descent from high sources on a smoothed DEM; a lake forms where a river hits a pit
 *  3. standing water: everything below the 7th height percentile becomes a flat lake
 *  4. cities: flattest low-lying spots are levelled, with rotated street grids, buildings and an arterial road
 *     (bridges where the road crosses water)
 *  5. land cover: forest from clustered noise + elevation/slope limits, rock on steep or high ground; trees scattered in forest
 */
export function generateTerrain(seed: number): Terrain {
  const r = rng(seed * 7919 + 13),
    nz = makeNoise(seed),
    n = N;
  const h = new Float32Array(n * n),
    cov = new Uint8Array(n * n),
    features: Feature[] = [];
  const W = (i: number) => i * CELL - SIZE / 2;
  const cell = (v: number) =>
    Math.min(n - 1, Math.max(0, Math.round((v + SIZE / 2) / CELL)));
  const at = (x: number, z: number) => cell(z) * n + cell(x);
  /** Bilinear sampler for an n x n grid over the tile. */
  const sampler = (a: Float32Array) => (x: number, z: number) => {
    const fx = Math.min(n - 1.001, Math.max(0, (x + SIZE / 2) / CELL)),
      fz = Math.min(n - 1.001, Math.max(0, (z + SIZE / 2) / CELL));
    const i = fx | 0,
      j = fz | 0,
      tx = fx - i,
      tz = fz - j,
      k = j * n + i;
    return (
      (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) +
      (a[k + n] * (1 - tx) + a[k + n + 1] * tx) * tz
    );
  };
  const height = sampler(h);

  // 1. base relief
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = W(i),
        z = W(j);
      const wx = x + 70 * nz.fbm(x * 0.004 + 5, z * 0.004, 3),
        wz = z + 70 * nz.fbm(x * 0.004, z * 0.004 + 9, 3);
      const mount = nz.ridged(wx * 0.0022 + 20, wz * 0.0022, 4),
        vall = nz.ridged(wx * 0.003 + 60, wz * 0.003 + 30, 3);
      h[j * n + i] =
        70 +
        55 * nz.fbm(wx * 0.0035, wz * 0.0035, 5) +
        60 * mount * mount -
        50 * vall ** 3 +
        5 * nz.fbm(x * 0.03, z * 0.03, 2);
    }
  let lo = Infinity,
    hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let k = 0; k < h.length; k++) h[k] = ((h[k] - lo) / (hi - lo)) * 170;
  const wl = pctl(h, 0.07);

  // 2. rivers and pit lakes
  const blur = (a: Float32Array) => {
    const o = Float32Array.from(a);
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) s += a[(j + dj) * n + i + di];
        o[j * n + i] = s / 9;
      }
    return o;
  };
  const hs = blur(blur(blur(h)));
  const carve = (ci: number, cj: number, rad: number, lvl: number) => {
    const R = Math.ceil(rad);
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = ci + di,
          j = cj + dj,
          d = Math.hypot(di, dj);
        if (d > rad || i < 0 || j < 0 || i >= n || j >= n) continue;
        const t = d / rad,
          k = j * n + i,
          bed = lvl - 4 + 8 * t * t;
        if (h[k] > bed) h[k] = bed;
        if (t < 0.55) cov[k] = Cover.Water;
      }
  };
  const lake = (ci: number, cj: number, R: number, lvl: number) => {
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = ci + di,
          j = cj + dj,
          d = Math.hypot(di, dj);
        if (d > R || i < 0 || j < 0 || i >= n || j >= n) continue;
        const t = d / R,
          k = j * n + i;
        if (t < 0.8) {
          h[k] = Math.min(h[k], lvl - 2);
          cov[k] = Cover.Water;
        } else h[k] = Math.min(h[k], lvl + (t - 0.8) * 40);
      }
  };
  const high = pctl(hs, 0.7),
    sources: [number, number][] = [];
  for (let t = 0; t < 600 && sources.length < 3; t++) {
    const i = 10 + Math.floor(r() * (n - 20)),
      j = 10 + Math.floor(r() * (n - 20));
    if (
      hs[j * n + i] >= high &&
      sources.every(([a, b]) => Math.hypot(a - i, b - j) > 50)
    )
      sources.push([i, j]);
  }
  for (let [i, j] of sources) {
    let lvl = hs[j * n + i];
    for (let step = 0; step < 1500; step++) {
      lvl = Math.min(lvl, hs[j * n + i]);
      carve(i, j, 2 + Math.min(2, step / 300), lvl);
      if (i <= 1 || j <= 1 || i >= n - 2 || j >= n - 2 || hs[j * n + i] <= wl)
        break;
      let bi = i,
        bj = j,
        bh = hs[j * n + i];
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const v = hs[(j + dj) * n + i + di];
          if ((di || dj) && v < bh) {
            bh = v;
            bi = i + di;
            bj = j + dj;
          }
        }
      if (bi === i && bj === j) {
        lake(i, j, 9, lvl);
        break;
      }
      i = bi;
      j = bj;
    }
  }

  // 3. standing water
  for (let k = 0; k < h.length; k++)
    if (h[k] <= wl) {
      h[k] = wl;
      cov[k] = Cover.Water;
    }
  const slope = (i: number, j: number) =>
    Math.hypot(
      h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)],
      h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i],
    ) /
    (2 * CELL);

  // 4. cities
  const rough = (x: number, z: number) => {
    let s = 0,
      s2 = 0;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const v = height(x + a * 40, z + b * 40);
        s += v;
        s2 += v * v;
      }
    const mu = s / 25;
    return { mu, sd: Math.sqrt(Math.max(0, s2 / 25 - mu * mu)) };
  };
  const cand: { x: number; z: number; mu: number; sd: number }[] = [];
  for (let t = 0; t < 500; t++) {
    const x = (r() - 0.5) * 800,
      z = (r() - 0.5) * 800;
    if (cov[at(x, z)] === Cover.Water) continue;
    const q = rough(x, z);
    if (q.mu > wl + 4 && q.mu < wl + 70) cand.push({ x, z, ...q });
  }
  cand.sort((a, b) => a.sd - b.sd);
  const cities: { x: number; z: number; R: number; e: number; a: number }[] =
    [];
  for (const c of cand) {
    if (cities.length >= 2) break;
    if (cities.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 350))
      cities.push({
        x: c.x,
        z: c.z,
        R: 130 + r() * 50,
        e: c.mu,
        a: (r() * Math.PI) / 2,
      });
  }
  const S = 30;
  for (const c of cities) {
    const ca = Math.cos(c.a),
      sa = Math.sin(c.a);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = W(i),
          z = W(j),
          d = Math.hypot(x - c.x, z - c.z),
          k = j * n + i;
        if (d > c.R * 1.6 || cov[k] === Cover.Water) continue;
        const w = sstep(c.R * 0.85, c.R * 1.6, d);
        h[k] = c.e * (1 - w) + h[k] * w;
        if (d < c.R * (0.8 + 0.3 * nz.perlin(x * 0.02, z * 0.02))) {
          const u = (x - c.x) * ca + (z - c.z) * sa,
            v = -(x - c.x) * sa + (z - c.z) * ca;
          cov[k] =
            ((u % S) + S) % S < CELL || ((v % S) + S) % S < CELL
              ? Cover.Road
              : Cover.Urban;
        }
      }
    for (let u = -c.R; u < c.R; u += S)
      for (let v = -c.R; v < c.R; v += S) {
        const uu = u + S / 2,
          vv = v + S / 2,
          x = c.x + uu * ca - vv * sa,
          z = c.z + uu * sa + vv * ca;
        if (cov[at(x, z)] !== Cover.Urban) continue;
        const core = 1 - Math.min(1, Math.hypot(uu, vv) / c.R);
        features.push({
          kind: "building",
          x,
          z,
          y: height(x, z),
          w: 12 + r() * 8,
          hgt: 6 + core * 40 * r() + r() * 6,
          rot: c.a,
        });
      }
  }
  if (cities.length === 2) {
    const [A, B] = cities,
      L = Math.hypot(B.x - A.x, B.z - A.z);
    let start: [number, number] | null = null,
      prev: [number, number] = [A.x, A.z];
    for (let s = 0; s <= L; s += 3) {
      const x = A.x + ((B.x - A.x) * s) / L,
        z = A.z + ((B.z - A.z) * s) / L,
        k = at(x, z);
      if (cov[k] === Cover.Water) {
        start ??= prev;
        continue;
      }
      if (start) {
        features.push({
          kind: "bridge",
          x: (start[0] + x) / 2,
          z: (start[1] + z) / 2,
          y: Math.max(height(...start), height(x, z)) + 2,
          w: Math.hypot(x - start[0], z - start[1]),
          hgt: 1.5,
          rot: Math.atan2(z - start[1], x - start[0]),
        });
        start = null;
      }
      if (cov[k] === Cover.Grass) cov[k] = Cover.Road;
      prev = [x, z];
    }
  }

  // 5. forest, rock, trees
  const rockH = pctl(h, 0.94);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (cov[k] !== Cover.Grass) continue;
      const s = slope(i, j),
        f = nz.fbm(W(i) * 0.008 + 40, W(j) * 0.008, 4);
      if (h[k] > rockH || s > 1.3) cov[k] = Cover.Rock;
      else if (f > 0.02 && h[k] > wl + 2 && s < 0.7) cov[k] = Cover.Forest;
    }
  let trees = 0;
  for (let t = 0; t < 9000 && trees < 1800; t++) {
    const x = (r() - 0.5) * SIZE,
      z = (r() - 0.5) * SIZE;
    if (cov[at(x, z)] !== Cover.Forest) continue;
    features.push({
      kind: "tree",
      x,
      z,
      y: height(x, z),
      w: 6 + r() * 4,
      hgt: 9 + r() * 9,
      rot: 0,
    });
    trees++;
  }

  // 6. true surface (DSM): the bare terrain plus the exact objects (sharp roof edges, cone crowns, bridge decks).
  //    A spatial hash keeps the lookup cheap: each object is listed in every 16 m bucket its bounding box overlaps.
  const BUCKET = 16,
    nb = Math.ceil(SIZE / BUCKET),
    buckets: number[][] = Array.from({ length: nb * nb }, () => []);
  const objs = features.map((f) => ({
    f,
    ca: Math.cos(f.rot),
    sa: Math.sin(f.rot),
    reach:
      f.kind === "building"
        ? f.w * 0.71
        : f.kind === "tree"
          ? f.w / 2
          : f.w / 2 + 4,
  }));
  const bk = (v: number) =>
    Math.min(nb - 1, Math.max(0, Math.floor((v + SIZE / 2) / BUCKET)));
  objs.forEach((o, k) => {
    for (let j = bk(o.f.z - o.reach); j <= bk(o.f.z + o.reach); j++)
      for (let i = bk(o.f.x - o.reach); i <= bk(o.f.x + o.reach); i++)
        buckets[j * nb + i].push(k);
  });
  const surfaceHeight = (x: number, z: number) => {
    let top = height(x, z);
    for (const k of buckets[bk(z) * nb + bk(x)]) {
      const { f, ca, sa } = objs[k],
        dx = x - f.x,
        dz = z - f.z;
      let t = -Infinity;
      if (f.kind === "tree") {
        const d = Math.hypot(dx, dz),
          R = f.w / 2;
        if (d < R) t = f.y + f.hgt * (1 - d / R);
      } // cone crown
      else if (
        Math.abs(dx * ca + dz * sa) <= f.w / 2 &&
        Math.abs(-dx * sa + dz * ca) <= (f.kind === "building" ? f.w / 2 : 4)
      )
        t = f.kind === "building" ? f.y + f.hgt : f.y + f.hgt / 2; // roof / bridge deck
      if (t > top) top = t;
    }
    return top;
  };
  const maxOf = (a: Float32Array) =>
    a.reduce((m, v) => Math.max(m, v), -Infinity);
  let topMax = maxOf(h);
  for (const f of features)
    topMax = Math.max(topMax, f.y + (f.kind === "bridge" ? f.hgt / 2 : f.hgt));
  const dsm = {
    height: surfaceHeight,
    geoidN: massGeoid(h, n, SIZE),
    maxHeight: topMax,
  };

  // geoid from the finished terrain's mass distribution: bulges over hills, dips over valleys and lakes
  return {
    seed,
    size: SIZE,
    n,
    wl,
    heights: h,
    cover: cov,
    features,
    dsm,
    height,
    maxHeight: maxOf(h),
    geoidN: dsm.geoidN,
    coverAt: (x, z) => cov[at(x, z)],
  };
}
