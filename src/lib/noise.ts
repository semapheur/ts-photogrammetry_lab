import { rng } from "./terrain";

/** Seeded 2D gradient noise with fBm and ridged variants. All outputs: perlin/fbm ~[-1,1], ridged [0,1]. */
export function makeNoise(seed: number) {
  const r = rng(seed),
    a = Array.from({ length: 256 }, (_, i) => i),
    p = new Uint8Array(512);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  const grad = (h: number, x: number, y: number) =>
    [x + y, x - y, -x + y, -x - y, x, -x, y, -y][h & 7];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
    lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const perlin = (x: number, y: number) => {
    const X = Math.floor(x) & 255,
      Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x),
      v = fade(y),
      A = p[X] + Y,
      B = p[X + 1] + Y;
    return (
      1.4 *
      lerp(
        lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
        lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u),
        v,
      )
    );
  };
  const fbm = (x: number, y: number, oct = 5) => {
    let s = 0,
      amp = 1,
      f = 1,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * perlin(x * f, y * f);
      n += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / n;
  };
  const ridged = (x: number, y: number, oct = 4) => {
    let s = 0,
      amp = 1,
      f = 1,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * (1 - Math.min(1, Math.abs(perlin(x * f, y * f)))) ** 2;
      n += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / n;
  };
  return { perlin, fbm, ridged };
}
