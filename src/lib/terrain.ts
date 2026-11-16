import type { Vector3 } from "three";
import type { TerrainSource } from "./types";

export const N0 = 41;

/**
 * Ray / surface intersection: march + bisection. The 1 m step is fine enough not to tunnel through narrow roofs or
 * ridges at oblique angles. Where the surface model knows its highest point, the empty air above it is skipped, so
 * the fine step is only spent near the ground.
 */
export function intersect(
  t: TerrainSource,
  o: Vector3,
  d: Vector3,
  step = 1,
  max = 5000,
): Vector3 | null {
  const below = (s: number) =>
    o.y + d.y * s <= t.height(o.x + d.x * s, o.z + d.z * s);
  let start = step;
  if (t.maxHeight !== undefined && o.y > t.maxHeight && d.y < 0)
    start = Math.max(step, (o.y - t.maxHeight) / -d.y - 2 * step);
  for (let s = start; s < max; s += step) {
    if (!below(s)) continue;
    let lo = s - step,
      hi = s;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (below(m)) hi = m;
      else lo = m;
    }
    return o.clone().addScaledVector(d, hi);
  }
  return null;
}

export const rng = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
