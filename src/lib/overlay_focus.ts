/** A point in the scene (m). */
export interface Pt {
  x: number;
  y: number;
  z: number;
}
/** What the orbit camera should do after the DEM overlay was handled. */
export type CameraAction = "home" | Pt | null;

/**
 * Remembers what the DEM overlay and the orbit camera were last doing, so the overlay effect only has to say what is
 * currently picked. The rules:
 *  - a newly picked point (a clicked pixel's ground point, a GCP candidate, a stereo pick) flies the camera to that point;
 *  - the same point again (e.g. the error sliders recompute it) does not;
 *  - while nothing is picked, the last point is remembered, so the window does not jump back to the middle of the terrain;
 *  - a new picture forgets the point;
 *  - changing the DEM flies to the remembered point, or else to the middle of the window;
 *  - a whole-tile overlay, or switching the overlay off, sends the camera home once.
 */
export class OverlayFocus {
  private point: Pt | null = null;
  private frame = NaN;
  private dem: unknown = null;
  private key = "";
  private spacing = NaN;
  private focused = "";
  private flown = false;

  /** The point of interest: the freshly picked one, else the last one (forgotten when a new picture is taken). */
  pointOfInterest(picked: Pt | null, frame: number): Pt | null {
    if (frame !== this.frame) {
      this.frame = frame;
      this.point = null;
      this.focused = "";
    }
    if (picked) this.point = { x: picked.x, y: picked.y, z: picked.z };
    return this.point;
  }
  /** Is this window of this DEM already built? */
  isBuilt(dem: unknown, key: string) {
    return this.dem === dem && this.key === key;
  }
  markBuilt(dem: unknown, key: string) {
    this.dem = dem;
    this.key = key;
  }

  cameraAction(
    full: boolean,
    spacing: number,
    picked: Pt | null,
    poi: Pt | null,
    centre: Pt,
  ): CameraAction {
    const changed = spacing !== this.spacing;
    this.spacing = spacing;
    if (full) {
      const was = this.flown;
      this.flown = false;
      return was ? "home" : null;
    }
    const pk = picked ? `${picked.x.toFixed(3)}|${picked.z.toFixed(3)}` : "";
    const newPick = !!picked && pk !== this.focused;
    if (!changed && !newPick) return null;
    if (picked) this.focused = pk;
    this.flown = true;
    return poi ?? centre;
  }
  /** The overlay was switched off. Returns true if the camera should go home. */
  hide(): boolean {
    const was = this.flown;
    this.dem = null;
    this.key = "";
    this.spacing = NaN;
    this.focused = "";
    this.flown = false;
    return was;
  }
}
