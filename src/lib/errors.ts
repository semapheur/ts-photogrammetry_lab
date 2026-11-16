import type { Params, PositionError } from "./types";

/** Standard-normal sample (Box–Muller) from a uniform generator. */
export const randn = (r: () => number) =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

export const pct = (a: number[], q: number) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(q * a.length))
      ]
    : 0;

/** 1σ of a linear error from its 90 % bound (normal distribution: LE90 = 1.645 σ). */
export const sigmaLinear = (le90: number) => le90 / 1.645;

/** 1σ of the platform position error in world axes (x = East, y = Up, z = North), from the per-axis 90 % errors. */
export const posSigma = (p: PositionError): [number, number, number] => [
  sigmaLinear(p.east),
  sigmaLinear(p.up),
  sigmaLinear(p.north),
];

/**
 * Platform position uncertainty. The inputs are the 90 % errors along East, North and Up; they are the semi-axes of the
 * ellipsoid that is drawn. The derived figures are the usual summaries: CEP90 (≈, from the rms horizontal sigma),
 * LEP90 (= the Up error) and SEP90 (≈ 2.5 σ_rms: the radius of a sphere holding 90 % of the 3D probability).
 */
export function uncertainty(p: PositionError) {
  const [sx, sy, sz] = posSigma(p),
    sh = Math.sqrt((sx * sx + sz * sz) / 2);
  return {
    cep: 2.146 * sh,
    lep: p.up,
    sep: 2.5 * Math.sqrt((sx * sx + sy * sy + sz * sz) / 3),
    axes: [p.east, p.north, p.up] as const,
  };
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix (tiny floor if it is only semi-definite). */
export function cholesky(A: number[][]): number[][] {
  const n = A.length,
    L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  return L;
}
