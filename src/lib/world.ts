import * as THREE from "three";
import type { Terrain } from "./types";
import { N0, rng } from "./terrain";

/** `land`: terrain mesh, buildings, trees, bridges. `geo`: the geoid and ellipsoid surfaces. Each can be hidden on its own. */
export interface World {
  group: THREE.Group;
  land: THREE.Group;
  geo: THREE.Group;
  updateGeoid(exag: number): void;
  dispose(): void;
}

const COL: Record<number, [number, number, number]> = {
  0: [0.38, 0.58, 0.27],
  1: [0.15, 0.36, 0.19],
  2: [0.2, 0.45, 0.72],
  3: [0.62, 0.6, 0.57],
  4: [0.22, 0.22, 0.25],
  5: [0.55, 0.5, 0.46],
};

/** Renders a generated Terrain. Replace the mesh construction here to support DEMs, point clouds or splats. */
export function buildWorld(t: Terrain): World {
  const group = new THREE.Group(),
    land = new THREE.Group(),
    n = t.n,
    S = t.size,
    r = rng(t.seed + 1);
  group.add(land);

  // Terrain mesh: one vertex per grid cell, coloured by land cover
  const g = new THREE.PlaneGeometry(S, S, n - 1, n - 1).rotateX(-Math.PI / 2);
  const p = g.attributes.position,
    col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    p.setY(k, t.heights[k]);
    const c = COL[t.cover[k]],
      e =
        (t.cover[k] === 0 ? 1 + (t.heights[k] - t.wl) / 600 : 1) *
        (0.92 + r() * 0.16);
    col.set([c[0] * e, c[1] * e, c[2] * e], k * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  land.add(
    new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })),
  );

  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    c = new THREE.Color();
  const inst = (
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    list: typeof t.features,
    place: (f: (typeof t.features)[0], i: number) => void,
  ) => {
    const im = new THREE.InstancedMesh(geom, mat, Math.max(1, list.length));
    im.count = list.length;
    list.forEach((f, i) => {
      place(f, i);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c);
    });
    land.add(im);
  };
  const of = (k: string) => t.features.filter((f) => f.kind === k);

  // Buildings (ground-truth footprints in t.features)
  inst(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    of("building"),
    (f) => {
      m.compose(
        new THREE.Vector3(f.x, f.y + f.hgt / 2, f.z),
        q.setFromEuler(new THREE.Euler(0, -f.rot, 0)),
        new THREE.Vector3(f.w, f.hgt, f.w),
      );
      c.setHSL(0.1, 0.05, 0.55 + 0.3 * r());
    },
  );
  // Trees
  inst(
    new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial(),
    of("tree"),
    (f) => {
      m.compose(
        new THREE.Vector3(f.x, f.y, f.z),
        q.identity(),
        new THREE.Vector3(f.w / 2, f.hgt, f.w / 2),
      );
      c.setHSL(0.33, 0.5, 0.14 + 0.1 * r());
    },
  );
  // Bridges
  const bmat = new THREE.MeshLambertMaterial({ color: 0x9a9a96 });
  for (const f of of("bridge")) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.hgt, 8), bmat);
    b.position.set(f.x, f.y, f.z);
    b.rotation.y = -f.rot;
    land.add(b);
  }

  // Geoid / ellipsoid reference surfaces
  const geo = new THREE.Group(),
    gg = new THREE.PlaneGeometry(S, S, 60, 60).rotateX(-Math.PI / 2);
  geo.add(
    new THREE.Mesh(
      gg,
      new THREE.MeshBasicMaterial({
        color: 0x3b82d9,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    ),
  );
  const ell = new THREE.Mesh(
    new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xd9a441,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  ell.position.y = -N0;
  geo.add(ell);
  group.add(geo);

  return {
    group,
    land,
    geo,
    updateGeoid(exag) {
      const a = gg.attributes.position;
      for (let i = 0; i < a.count; i++)
        a.setY(i, (t.geoidN(a.getX(i), a.getZ(i)) - N0) * exag);
      a.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        ([] as THREE.Material[])
          .concat(mesh.material ?? [])
          .forEach((x) => x.dispose());
      });
    },
  };
}
