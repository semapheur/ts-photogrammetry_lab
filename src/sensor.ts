import * as THREE from 'three';
import type { Params, Pose, TerrainSource } from './types';
import { intersect } from './terrain';

const D = Math.PI / 180;
const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // nadir, image-up = north

export const makeCam = () => new THREE.PerspectiveCamera(40, 4 / 3, 1, 6000);

export const truePose = (p: Params): Pose => ({ pos: new THREE.Vector3(p.px, p.alt, p.pz), az: p.az, look: p.look, r: 0, p: 0, y: 0 });
export const estPose = (p: Params): Pose => ({
	...truePose(p), pos: truePose(p).pos.add(new THREE.Vector3(p.ex, p.ez, -p.ey)), r: p.rr, p: p.pp, y: p.yy
});

const axis = (x: number, y: number, z: number, a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z), a);

export function setPose(c: THREE.PerspectiveCamera, q: Pose) {
	c.position.copy(q.pos);
	// azimuth about vertical (clockwise from north) -> tilt off-nadir toward the look direction -> attitude error -> nadir camera
	const err = new THREE.Quaternion().setFromEuler(new THREE.Euler(q.p * D, q.y * D, q.r * D, 'YXZ'));
	c.quaternion.copy(axis(0, 1, 0, -q.az * D)).multiply(axis(1, 0, 0, q.look * D)).multiply(err).multiply(base);
	c.updateProjectionMatrix();
	c.updateMatrixWorld(true);
}

/** World-space direction of the ray through normalised image coords (nx, ny in [-1,1]). */
export const pixelRay = (c: THREE.PerspectiveCamera, nx: number, ny: number) =>
	new THREE.Vector3(nx, ny, .5).unproject(c).sub(c.position).normalize();

/**
 * Pixel-space unit direction (x right, y down) of a world horizontal direction as seen in the image,
 * evaluated at the ground point under the image centre. Used for the north arrow on captured images.
 */
export function groundDir(c: THREE.PerspectiveCamera, t: TerrainSource, dir: THREE.Vector3, w: number, h: number): [number, number] {
	const d = pixelRay(c, 0, 0);
	const p = intersect(t, c.position, d) ?? c.position.clone().addScaledVector(d, 1000);
	const a = p.clone().project(c), b = p.clone().addScaledVector(dir, 50).project(c);
	const dx = ((b.x - a.x) * w) / 2, dy = (-(b.y - a.y) * h) / 2, L = Math.hypot(dx, dy) || 1;
	return [dx / L, dy / L];
}

/** Line segments for frustum edges + ground footprint outline. */
export function frustumLines(c: THREE.PerspectiveCamera, t: TerrainSource): THREE.Vector3[] {
	const k = ([[-1, 1], [1, 1], [1, -1], [-1, -1]] as const).map(([x, y]) => {
		const d = pixelRay(c, x, y);
		return intersect(t, c.position, d) ?? c.position.clone().addScaledVector(d, 1500);
	});
	return k.flatMap((q, i) => [c.position, q, q, k[(i + 1) % 4]]);
}
