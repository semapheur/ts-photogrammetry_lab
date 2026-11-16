import type { PerspectiveCamera, Vector3 } from "three";

export interface SelectOption<T> {
  label: string;
  value: T;
}

/** DTM = bare terrain only; DSM = terrain plus the objects on it (buildings, trees, bridges). */
export const demModels = ["DTM", "DSM"] as const;
export type DemModel = Lowercase<(typeof demModels)[number]>;

export const demResolutions = [0.5, 1, 5, 10, 25, 50, 100] as const;

export const uncertaintyModes = [
  { label: "CEP90 + LEP90", value: "cep" },
  { label: "SEP90", value: "sep" },
] as const;
export type UncertaintyMode = (typeof uncertaintyModes)[number]["value"];

export const imageryModes = ["Mono", "Stereo"] as const;
export type ImageryMode = Lowercase<(typeof imageryModes)[number]>;

/** Platform position in the scene (m): x = East, z = world z (positive towards the south), altitude above the geoid. */
export type PlatformPosition = { x: number; z: number; altitude: number };
/** Platform position error: 90 % linear error along each axis (m). */
export type PositionError = { east: number; north: number; up: number };
/** Attitude error, 1σ (deg). */
export type AttitudeError = { roll: number; pitch: number; yaw: number };

export interface Params {
  platformPosition: PlatformPosition;
  lookAzimuth: number; // look azimuth (deg clockwise from north),
  lookAngle: number; //look angle (deg off-nadir)
  positionError: PositionError;
  attitudeError: AttitudeError;
  imageryMode: ImageryMode;
  geoidExag: number; // geoid exaggeration (visual only)
  seed: number;
  umode: UncertaintyMode;
  showGeo: boolean;
  demModel: DemModel;
  demRes: number; // DEM post spacing used for georeferencing (m)
  showTerrain: boolean;
  showDem: boolean;
  showLive: boolean;
  showFrame: boolean;
  showCorr: boolean; // frusta: current flight path / captured image / GCP-corrected
  baseline: number; // stereo: distance between the two exposures along the look azimuth (m)
  stereoCorr: number; // stereo: share of the position/attitude error common to both exposures (0..1)
  matchPx: number; // stereo: 1-sigma error when placing the same feature in both images (px)
  showStereo: boolean;
}
export type NumKey = Exclude<
  keyof Params,
  | "imageryMode"
  | "umode"
  | "showGeo"
  | "showDem"
  | "showLive"
  | "showFrame"
  | "showCorr"
  | "showStereo"
>;

export type GroupKey = {
  [K in keyof Params]: Params[K] extends Record<string, number> ? K : never;
}[keyof Params];

export type Sigma = Pick<Params, "positionError" | "attitudeError">;

export interface TerrainSource {
  height(x: number, z: number): number; // orthometric height H
  geoidN(x: number, z: number): number; // geoid separation N
  maxHeight?: number; // highest point (lets ray marching skip the empty air
}
export interface Feature {
  kind: "building" | "tree" | "bridge";
  x: number;
  z: number;
  y: number;
  w: number;
  hgt: number;
  rot: number;
}
/** Grid terrain with land cover and ground-truth features. */
export interface Terrain extends TerrainSource {
  seed: number;
  size: number;
  n: number;
  wl: number;
  heights: Float32Array;
  cover: Uint8Array;
  features: Feature[];
  dsm: TerrainSource;
  coverAt(x: number, z: number): number;
}
export interface Pose {
  position: Vector3;
  azimuth: number;
  look: number;
  roll: number;
  pitch: number;
  yaw: number;
}
export interface Cam {
  cam: PerspectiveCamera;
  pose: Pose;
}
/**
 * A captured image. `cam`/`pose` is the current best estimate (starts as the navigation solution, replaced after
 * GCP correction). `truth` is the hidden pose the picture was actually taken from: never displayed, only used for scoring.
 */
export interface Frame extends Cam {
  snap: HTMLCanvasElement;
  nominal: Cam;
  truth: Cam;
  /** Covariance of the current pose estimate (order: x, y(up), z in m; roll, pitch, yaw in deg). null = the navigation prior. */
  cov: number[][] | null;
}
/** Ground control point: an image pixel (normalised coords) matched to a map position chosen by the user. */
export interface GCP {
  nx: number;
  ny: number;
  map: Vector3;
  truePt: Vector3;
}
export interface ErrorStats {
  rmse: number;
  cep90: number;
  lep90: number;
}
export interface Correction {
  dPos: [number, number, number];
  dAtt: [number, number, number]; // estimated pose correction: E,N,U (m); roll,pitch,yaw (deg)
  rms0: number;
  rms1: number; // GCP image residual before / after (px)
  before: ErrorStats;
  after: ErrorStats; // image-wide ground error vs. truth
  rows: { click: number; before: number; after: number }[]; // per-GCP horizontal errors (m)
}
/** Ground point under a clicked pixel, with its propagated 90 % uncertainty. */
export interface GroundPoint {
  p: Vector3;
  pf: Vector3; // terrain intersection; flat-datum intersection
  slant: number;
  off: number; // slant range (m), off-nadir angle of the pixel ray (deg)
  rel: number; // relief displacement if terrain were ignored (m)
  cep: number;
  lep: number;
  sep: number; // 90 % horizontal radius, vertical half-height, spherical radius (m)
  cepS: number;
  lepS: number;
  sepS: number; // same, from sensor errors only (i.e. with a perfect DEM)
  demErr: number; // true terrain height minus DEM height at the point (m)
}

/** Coarse elevation model used for georeferencing (the truth terrain is what the camera actually sees). */
export interface DemSource extends TerrainSource {
  spacing: number;
  n: number;
  size: number;
  stored: boolean;
  grid(maxNodes: number): { n: number; heights: Float32Array };
  patch(
    cx: number,
    cz: number,
    maxNodes: number,
  ): { n: number; x0: number; z0: number; step: number; heights: Float32Array };
}

/** Ground point from a stereo pair: ray intersection of two clicked image points. */
export interface StereoPoint {
  p: Vector3; // triangulated ground point (navigation-solution poses)
  gap: number; // closest approach of the two rays (m): residual y-parallax
  dpx: number; // parallax along the flight direction (px)
  B: number;
  H: number; // baseline (m), mean camera height above the point (m)
  hClassic: number; // height from the classic parallax equation (valid near nadir)
  demH: number; // DEM height at the same position, for comparison
  cep: number;
  lep: number;
  sep: number; // 90 % horizontal radius, vertical half-height, spherical radius (m)
  truthErr: { hz: number; dz: number } | null; // simulation check against the hidden truth
}
