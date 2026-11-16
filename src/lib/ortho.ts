import { Matrix4, type PerspectiveCamera } from "three";
import type { TerrainSource } from "./types";

const cache = new WeakMap<HTMLCanvasElement, ImageData>();

/**
 * Orthorectify (reproject) a captured image onto a map window using the given camera model and DEM.
 * `rot` is the bearing (rad, clockwise from north) shown at the top of the window; 0 = north up.
 * Inverse mapping: for every map pixel take the DEM height, project into the camera, sample the picture.
 */
export function orthoImage(
  snap: HTMLCanvasElement,
  cam: PerspectiveCamera,
  dem: TerrainSource,
  v: { cx: number; cz: number; size: number; rot?: number },
  W: number,
): ImageData {
  let src = cache.get(snap);
  if (!src) {
    src = snap.getContext("2d")!.getImageData(0, 0, snap.width, snap.height);
    cache.set(snap, src);
  }
  const out = new ImageData(W, W),
    M = new Matrix4().multiplyMatrices(
      cam.projectionMatrix,
      cam.matrixWorldInverse,
    ).elements;
  const co = Math.cos(v.rot ?? 0),
    si = Math.sin(v.rot ?? 0);
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const a0 = ((i + 0.5) / W - 0.5) * v.size,
        b0 = ((j + 0.5) / W - 0.5) * v.size; // offset from the window centre (right, down)
      const x = v.cx + a0 * co - b0 * si,
        z = v.cz + a0 * si + b0 * co,
        y = dem.height(x, z);
      const w = M[3] * x + M[7] * y + M[11] * z + M[15];
      if (w <= 0) continue;
      const nx = (M[0] * x + M[4] * y + M[8] * z + M[12]) / w,
        ny = (M[1] * x + M[5] * y + M[9] * z + M[13]) / w;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
      // bilinear sampling of the picture
      const fx = ((nx + 1) / 2) * src.width - 0.5,
        fy = ((1 - ny) / 2) * src.height - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 2, Math.floor(fx))),
        y0 = Math.max(0, Math.min(src.height - 2, Math.floor(fy)));
      const tx = Math.min(1, Math.max(0, fx - x0)),
        ty = Math.min(1, Math.max(0, fy - y0));
      const a = (y0 * src.width + x0) * 4,
        b = a + 4,
        c = a + src.width * 4,
        d = c + 4,
        o = (j * W + i) * 4;
      for (let k = 0; k < 3; k++)
        out.data[o + k] =
          (src.data[a + k] * (1 - tx) + src.data[b + k] * tx) * (1 - ty) +
          (src.data[c + k] * (1 - tx) + src.data[d + k] * tx) * ty;
      out.data[o + 3] = 255;
    }
  return out;
}
