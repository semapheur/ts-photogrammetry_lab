/** Zoom/pan state for a picture drawn on a canvas: picture pixel p appears at p * z + (ox, oy). */
export class View {
  z = $state(1);
  ox = $state(0);
  oy = $state(0);
  W: number;
  H: number;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
  }

  get centre(): [number, number] {
    return this.fromS(this.W / 2, this.H / 2);
  }

  clamp() {
    this.ox = Math.min(0, Math.max(this.W * (1 - this.z), this.ox));
    this.oy = Math.min(0, Math.max(this.H * (1 - this.z), this.oy));
  }
  zoom(x: number, y: number, f: number, max = 16) {
    const z = Math.min(max, Math.max(1, this.z * f)),
      r = z / this.z;
    this.ox = x - (x - this.ox) * r;
    this.oy = y - (y - this.oy) * r;
    this.z = z;
    this.clamp();
  }
  pan(dx: number, dy: number) {
    this.ox += dx;
    this.oy += dy;
    this.clamp();
  }
  reset() {
    this.z = 1;
    this.ox = 0;
    this.oy = 0;
  }
  centerOn(ix: number, iy: number) {
    this.ox = this.W / 2 - ix * this.z;
    this.oy = this.H / 2 - iy * this.z;
    this.clamp();
  }
  toS(u: number, v: number): [number, number] {
    return [u * this.z + this.ox, v * this.z + this.oy];
  } // picture px -> canvas px
  fromS(x: number, y: number): [number, number] {
    return [(x - this.ox) / this.z, (y - this.oy) / this.z];
  } // canvas px -> picture px
  nToS(nx: number, ny: number) {
    return this.toS(((nx + 1) / 2) * this.W, ((1 - ny) / 2) * this.H);
  } // normalised coords -> canvas px
}
