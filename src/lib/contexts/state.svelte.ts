import { Vector3 } from "three";
import type {
  Correction,
  DemSource,
  Frame,
  GCP,
  GroundPoint,
  Params,
  StereoPoint,
  Terrain,
} from "../types";
import { makeDem } from "../dem";
import { correct } from "../gcp";
import { generateTerrain } from "../generate";
import { locate, navFromTruth } from "../georef";
import { makeCam, pixelRay, setPose } from "../sensor";
import { stereoSolve } from "../stereo";
import { intersect } from "../terrain";

export const params: Params = $state({
  platformPosition: { x: 0, z: 0, altitude: 600 },
  lookAzimuth: 0,
  lookAngle: 0,
  positionError: { east: 6, north: 10, up: 8 },
  attitudeError: { roll: 0.5, pitch: 0.3, yaw: 0.8 },
  geoidExag: 8,
  seed: 21,
  umode: "cep",
  showGeo: true,
  demModel: "dtm",
  demRes: 5,
  showTerrain: true,
  showDem: false,
  showLive: true,
  showFrame: true,
  showCorr: true,
  baseline: 150,
  stereoCorr: 0.9,
  matchPx: 1,
  showStereo: true,
  imageryMode: "mono",
});

class Env {
  terrain = $state.raw<Terrain>(generateTerrain(21));
}
/** Current terrain; assigning `env.terrain` rebuilds the scene. */
export const env = new Env();

/** `pixel` is the clicked image position in normalised coords [-1,1]; `frameId` bumps on each capture. */
export const session = $state({
  frameId: 0,
  rev: 0,
  world: 0,
  hasFrame: false,
  pixel: null as [number, number] | null,
});
/** Non-reactive holder for heavy objects (camera, snapshot canvas). */
export const frameStore: { frame: Frame | null } = { frame: null };

class Dem {
  /** DEM used for georeferencing; rebuilt when the terrain or the post spacing changes. */
  // DTM: bare terrain; DSM: terrain plus objects
  value = $derived.by<DemSource>(() =>
    makeDem(
      params.demModel === "dsm" ? env.terrain.dsm : env.terrain,
      env.terrain.size,
      params.demRes,
    ),
  );
}
export const dem = new Dem();

class Ground {
  /** Re-evaluated live when the clicked pixel or any error input changes. */
  value = $derived.by<GroundPoint | null>(() => {
    void session.frameId;
    void session.rev;
    const px = session.pixel,
      f = frameStore.frame;
    return px && f
      ? locate(
          env.terrain,
          dem.value,
          params,
          f.pose,
          f.cam,
          px[0],
          px[1],
          f.cov,
        )
      : null;
  });
}
export const ground = new Ground();

export function regenerate(seed: number) {
  params.seed = seed;
  env.terrain = generateTerrain(seed);
  frameStore.frame = null;
  session.hasFrame = false;
  session.pixel = null;
  session.frameId++;
  resetGcp();
  stereoStore.left = stereoStore.right = null;
  stereo.has = false;
  stereo.pL = stereo.pR = null;
  stereo.id++;
}

// Ground control points / geocorrection
export const gcp = $state({
  mode: false,
  pending: null as { nx: number; ny: number; proj: Vector3 } | null, // image point awaiting its map counterpart
  list: [] as GCP[],
  overlay: "none" as "none" | "before" | "after", // reprojected image drawn over the map
  result: null as Correction | null,
});

export function resetGcp() {
  gcp.list = [];
  gcp.pending = null;
  gcp.result = null;
  gcp.overlay = "none";
  gcp.mode = false;
}

/** Step 1: click on the image. Shows where the current solution projects that pixel on the map. */
export function gcpAddImage(nx: number, ny: number) {
  const f = frameStore.frame;
  if (!f) return;
  const proj = intersect(dem.value, f.cam.position, pixelRay(f.cam, nx, ny));
  if (proj) gcp.pending = { nx, ny, proj };
}
/** Step 2: click the same feature on the map. The simulation records the true ground position only for scoring. */
export function gcpAddMap(x: number, z: number) {
  const f = frameStore.frame,
    pd = gcp.pending;
  if (!f || !pd) return;
  const truePt = intersect(
    env.terrain,
    f.truth.cam.position,
    pixelRay(f.truth.cam, pd.nx, pd.ny),
  );
  if (!truePt) return;
  gcp.list = [
    ...gcp.list,
    {
      nx: pd.nx,
      ny: pd.ny,
      map: new Vector3(x, dem.value.height(x, z), z),
      truePt,
    },
  ];
  gcp.pending = null;
}
export function gcpReproject() {
  const f = frameStore.frame;
  if (!f || gcp.list.length < 3) return;
  gcp.result = correct(f, gcp.list, env.terrain, dem.value, params);
  gcp.overlay = "after";
  gcp.pending = null;
  session.rev++;
}
export function gcpReset() {
  const f = frameStore.frame;
  if (f) {
    f.cam = f.nominal.cam;
    f.pose = f.nominal.pose;
    f.cov = null;
  }
  gcp.result = null;
  if (gcp.overlay === "after") gcp.overlay = "none";
  session.rev++;
}
export function gcpClear() {
  gcp.list = [];
  gcp.pending = null;
  gcpReset();
}

// Stereo pair
/** The two exposures (heavy objects, non-reactive). */
export const stereoStore: { left: Frame | null; right: Frame | null } = {
  left: null,
  right: null,
};
/** `pL` / `pR` are the clicked points (normalised image coords) in the left / right image. */
export const stereo = $state({
  id: 0,
  has: false,
  pL: null as [number, number] | null,
  pR: null as [number, number] | null,
  showTruth: false,
});

/** Error sliders moved: the truth stays fixed, the navigation solution is re-derived from it. */
export function renavigate() {
  const f = frameStore.frame;
  if (!f) return;
  const nav = navFromTruth(f.truth.pose, params, session.frameId);
  const cam = makeCam();
  setPose(cam, nav);
  f.nominal = { cam, pose: nav };
  if (!gcp.result) {
    // a GCP-corrected camera is left alone
    f.cam = cam;
    f.pose = nav;
  }
  session.rev++;
}

class StereoCalc {
  /** Re-evaluated live when either click or any error / matching input changes. */
  value = $derived.by<StereoPoint | null>(() => {
    void stereo.id;
    const L = stereoStore.left,
      R = stereoStore.right,
      a = stereo.pL,
      b = stereo.pR;

    const sigma = {
      positionError: params.positionError,
      attitudeError: params.attitudeError,
    };
    const stereoError = {
      stereoCorr: params.stereoCorr,
      matchPx: params.matchPx,
    };
    return L && R && a && b
      ? stereoSolve(L, R, a, b, sigma, stereoError, dem.value, env.terrain)
      : null;
  });
}
export const stereoPt = new StereoCalc();
