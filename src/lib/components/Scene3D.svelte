<script lang="ts">
  import { untrack } from "svelte";
  import * as THREE from "three";
  import {
    params,
    session,
    frameStore,
    env,
    ground,
    dem,
    gcp,
    resetGcp,
    stereo,
    stereoStore,
    stereoPt,
  } from "../contexts/state.svelte";
  import {
    makeCam,
    setPose,
    navPose,
    frustumLines,
    baselineVec,
    pixelRay,
    IMG_W,
    IMG_H,
  } from "../sensor";
  import { realizePose, realizePair, navFromTruth } from "../georef";
  import { buildWorld, type World } from "../world";
  import { strokeCompass, compassLetter } from "../compass";
  import type { DemSource, Frame, Pose, TerrainSource } from "../types";
  import type { Attachment } from "svelte/attachments";
  import { STEREO } from "../colors";
  import { intersect } from "../terrain";
  import { OverlayFocus, type Pt } from "../overlay_focus";

  // Reactive switches
  const mono = $derived(params.imageryMode === "mono");
  const stereoMode = $derived(params.imageryMode === "stereo");
  const sphere = $derived(params.umode === "sep"); // SEP90 sphere instead of the CEP90 x LEP90 cylinder

  // Scene
  const ORANGE = 0xf08a24,
    ORANGE_LIGHT = 0xffb066,
    BLUE = 0x4fc3f7,
    GREEN = 0x5ce08a,
    VIOLET = 0xc77dff,
    GREY = 0x9aa5ad;

  const FULL_MAX = 241, // a DEM with at most this many posts per side is drawn whole
    WINDOW_N = 161; // finer DEMs: a window of this many posts per side

  let ready = $state(false);
  let world: World,
    r2: THREE.WebGLRenderer,
    r3: THREE.WebGLRenderer,
    worldN = 0;
  const scene = new THREE.Scene();
  /** Everything that is not part of the scene itself. It is hidden while taking pictures and rendering the map. */
  const helpers = new THREE.Group();
  scene.background = new THREE.Color(0x9fc3dc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 0.9), helpers);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const sc = makeCam(),
    sc2 = makeCam(), // current pose, and current pose + baseline (stereo preview)
    scF = makeCam(); // where the sensor looks (centre of the DEM window when nothing is picked)

  // Overlay building blocks
  const dotGeo = new THREE.SphereGeometry(1, 12, 8),
    sphereGeo = new THREE.SphereGeometry(1, 24, 16);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 48),
    cylEdges = new THREE.EdgesGeometry(cylGeo, 20);

  /** Add an overlay object. Frustum culling is off: their geometry is rewritten in place, so a stale bounding sphere must not hide them. */
  const track = <T extends THREE.Object3D>(
    o: T,
    parent: THREE.Object3D = helpers,
  ): T => {
    o.frustumCulled = false;
    parent.add(o);
    return o;
  };
  const lineSegs = (color: number) =>
    track(
      new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color }),
      ),
    );
  const polyline = (color: number, parent: THREE.Object3D) =>
    track(
      new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color }),
      ),
      parent,
    );
  const dot = (color: number, radius: number, parent?: THREE.Object3D) => {
    const m = track(
      new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color })),
      parent,
    );
    m.scale.setScalar(radius);
    return m;
  };

  /** Frustum outline + apex marker for one camera. */
  const frustumLayer = (color: number, apexRadius: number) => {
    const lines = lineSegs(color),
      apex = dot(color, apexRadius);
    lines.visible = apex.visible = false;
    return {
      show(v: boolean) {
        lines.visible = apex.visible = v;
      },
      update(cam: THREE.PerspectiveCamera, terrain: TerrainSource) {
        lines.geometry.setFromPoints(frustumLines(cam, terrain));
        apex.position.copy(cam.position);
      },
    };
  };

  /** Uncertainty region at a point: CEP90 radius x +-LEP90 height cylinder (translucent fill + rims), or a SEP90 sphere. */
  const region = (
    color: number,
    fill: number,
    sphereOpacity: number,
    parent: THREE.Object3D,
  ) => {
    const cyl = new THREE.Group();
    if (fill)
      cyl.add(
        new THREE.Mesh(
          cylGeo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: fill,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
    cyl.add(
      new THREE.LineSegments(cylEdges, new THREE.LineBasicMaterial({ color })),
    );
    const ball = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: sphereOpacity,
      }),
    );
    parent.add(cyl, ball);
    return {
      set(
        at: THREE.Vector3,
        e: { cep: number; lep: number; sep: number },
        asSphere: boolean,
        minHeight = 0.01,
      ) {
        cyl.visible = !asSphere;
        ball.visible = asSphere;
        cyl.position.copy(at);
        cyl.scale.set(
          e.cep || 0.01,
          Math.max(2 * e.lep, minHeight),
          e.cep || 0.01,
        );
        ball.position.copy(at);
        ball.scale.setScalar(e.sep || 0.01);
      },
    };
  };

  /** Ellipsoid with semi-axes (East, North, Up): translucent fill + its three principal ellipses. Unit-size, rescaled on update. */
  const ellipsoid = (color: number, fill: number, parent: THREE.Object3D) => {
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        sphereGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: fill,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    );
    const ring = (f: (a: number) => [number, number, number]) =>
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from(
            { length: 64 },
            (_, i) => new THREE.Vector3(...f((i / 64) * Math.PI * 2)),
          ),
        ),
        new THREE.LineBasicMaterial({ color }),
      );
    g.add(
      ring((a) => [Math.cos(a), Math.sin(a), 0]),
      ring((a) => [Math.cos(a), 0, Math.sin(a)]),
      ring((a) => [0, Math.cos(a), Math.sin(a)]),
    );
    g.visible = false;
    parent.add(g);
    return {
      show(v: boolean) {
        g.visible = v;
      },
      set(at: THREE.Vector3, [e, n, u]: readonly [number, number, number]) {
        g.position.copy(at);
        g.scale.set(e || 0.01, u || 0.01, n || 0.01);
      },
    };
  };

  // Layers
  // Frusta
  const live = frustumLayer(ORANGE, 9),
    live2 = frustumLayer(ORANGE_LIGHT, 6); // flight path (+ second exposure in stereo mode)
  const captured = frustumLayer(BLUE, 6),
    corrected = frustumLayer(GREEN, 6); // mono image: original / after GCP correction
  const pairL = frustumLayer(STEREO.left, 6),
    pairR = frustumLayer(STEREO.right, 6); // captured stereo pair

  // Error region at the sensor
  const platformRoot = track(new THREE.Group());
  const platformEllipsoid = ellipsoid(ORANGE, 0.18, platformRoot),
    platformEllipsoid2 = ellipsoid(ORANGE_LIGHT, 0.12, platformRoot);

  // Clicked ground point (mono): ray, point, flat-datum point; grey = sensor-only error, orange = sensor + DEM
  const groundRoot = track(new THREE.Group()),
    groundRay = polyline(ORANGE, groundRoot);
  const groundDot = dot(ORANGE, 5, groundRoot),
    flatDot = dot(GREY, 5, groundRoot),
    trueDot = dot(0xffffff, 5, groundRoot);
  const groundSensor = region(GREY, 0, 0.3, groundRoot),
    groundTotal = region(ORANGE, 0.28, 0.45, groundRoot);
  groundRoot.visible = false;

  // Stereo point: both rays, the epipolar plane (camera centres + point), the point and its error region
  const stereoRoot = track(new THREE.Group()),
    rayL = polyline(STEREO.left, stereoRoot),
    rayR = polyline(STEREO.right, stereoRoot);
  const planeGeo = new THREE.BufferGeometry();
  planeGeo.setIndex([0, 1, 2]);
  track(
    new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        color: VIOLET,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
    stereoRoot,
  );
  const stereoDot = dot(VIOLET, 5, stereoRoot),
    stereoRegion = region(VIOLET, 0.28, 0.45, stereoRoot);
  stereoRoot.visible = false;

  // Orbit camera
  const HOME = { dist: 1500, tgt: new THREE.Vector3(0, 80, 0) };
  const orbit = {
    az: 0.8,
    el: 0.55,
    dist: HOME.dist,
    minDist: 200,
    tgt: HOME.tgt.clone(),
  };
  // close zoom (down to 1.5 m) is only allowed while a fine DEM window is being inspected; otherwise the original 200 m limit applies
  const focusOn = (x: number, y: number, z: number, dist: number) => {
    orbit.tgt.set(x, y, z);
    orbit.dist = Math.max(2, dist);
    orbit.minDist = 1.5;
  };
  const focusHome = () => {
    orbit.tgt.copy(HOME.tgt);
    orbit.dist = HOME.dist;
    orbit.minDist = 200;
  };

  // DEM overlay
  // The DEM drawn at its true post spacing. A DEM with at most FULL_MAX posts per side is drawn whole. Finer DEMs have millions of posts, so a window of WINDOW_N x WINDOW_N posts is drawn around the point of interest, and the orbit camera flies to it (the rules are in OverlayFocus). Unchecking the overlay brings the camera back.
  let demMesh: THREE.LineSegments | null = null;
  const focus = new OverlayFocus();

  /** The lines joining neighbouring posts of a DEM window (no diagonals): a third of the lines of a triangulated wireframe. */
  const demGrid = (
    m: number,
    step: number,
    heights: Float32Array,
    lift: number,
    depthTest: boolean,
  ) => {
    const pos = new Float32Array(m * m * 3),
      idx = new Uint32Array(4 * m * (m - 1)),
      half = ((m - 1) * step) / 2;
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m; i++) {
        const k = j * m + i;
        pos[k * 3] = i * step - half;
        pos[k * 3 + 1] = heights[k] + lift;
        pos[k * 3 + 2] = j * step - half;
      }
    let o = 0;
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m - 1; i++) {
        idx[o++] = j * m + i; // along x
        idx[o++] = j * m + i + 1;
      }
    for (let j = 0; j < m - 1; j++)
      for (let i = 0; i < m; i++) {
        idx[o++] = j * m + i; // along z
        idx[o++] = (j + 1) * m + i;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        depthTest,
      }),
    );
  };
  const clearDemMesh = () => {
    if (demMesh) {
      helpers.remove(demMesh);
      demMesh.geometry.dispose();
      (demMesh.material as THREE.Material).dispose();
      demMesh = null;
    }
  };

  /** What the user has just picked, if anything: a GCP candidate, the clicked pixel's ground point, or a stereo pick. */
  function pickedPoint(d: DemSource): Pt | null {
    if (gcp.mode && gcp.pending) return gcp.pending.proj; // image point awaiting its map position
    if (mono) return ground.value?.p ?? null; // clicked pixel
    if (stereoMode) {
      const s = stereoPt.value?.p,
        L = stereoStore.left,
        R = stereoStore.right;
      if (s) return s; // triangulated point
      if (L && stereo.pL)
        return intersect(
          d,
          L.nominal.cam.position,
          pixelRay(L.nominal.cam, stereo.pL[0], stereo.pL[1]),
        ); // first pick
      if (R && stereo.pR)
        return intersect(
          d,
          R.nominal.cam.position,
          pixelRay(R.nominal.cam, stereo.pR[0], stereo.pR[1]),
        );
    }
    return null;
  }

  /** Centre of the window to draw: the point of interest, else where the sensor looks.
   *  Snapped, so the window moves in quarter-window jumps. */
  function windowCentre(d: DemSource, poi: Pt | null): [number, number] {
    const at =
      poi ??
      (setPose(scF, navPose(params)),
      intersect(d, scF.position, pixelRay(scF, 0, 0)));
    const q = d.spacing * ((WINDOW_N - 1) / 4);
    return [Math.round((at?.x ?? 0) / q) * q, Math.round((at?.z ?? 0) / q) * q];
  }

  // Orientation gizmo
  /** Compass ring (circle + chevron pointing north) on the ground plane, with an upright "N". */
  function createGizmo() {
    const group = new THREE.Group(),
      gScene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
    camera.position.set(0, 0, 4);
    gScene.add(group);
    const tex = (
      size: number,
      paint: (c: CanvasRenderingContext2D) => void,
    ) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      paint(cv.getContext("2d")!);
      return new THREE.CanvasTexture(cv);
    };
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: tex(256, (c) => strokeCompass(c, 128, 128, 70, -Math.PI / 2)),
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    const letter = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex(128, (c) => compassLetter(c, 64, 64, 84)),
        transparent: true,
        depthTest: false,
      }),
    );
    letter.scale.setScalar(0.9);
    letter.renderOrder = 2;
    group.add(ring, letter);
    return { group, scene: gScene, camera };
  }
  const gizmo = createGizmo();

  // Taking pictures
  /** Render one exposure from the hidden true pose; the frame keeps the navigation solution as its working estimate. */
  const shoot = (nominal: Pose, truthPose: Pose): Frame => {
    const nomCam = makeCam();
    setPose(nomCam, nominal);
    const truthCam = makeCam();
    setPose(truthCam, truthPose);
    const hv = helpers.visible,
      gv = world.geo.visible,
      lv = world.land.visible;

    helpers.visible = false;
    world.geo.visible = false;
    world.land.visible = true; // pictures always show the terrain

    r2.render(scene, truthCam);
    helpers.visible = hv;
    world.geo.visible = gv;
    world.land.visible = lv;
    const snap = document.createElement("canvas");
    snap.width = IMG_W;
    snap.height = IMG_H;
    snap.getContext("2d")!.drawImage(r2.domElement, 0, 0);
    return {
      cam: nomCam,
      pose: nominal,
      snap,
      nominal: { cam: nomCam, pose: nominal },
      truth: { cam: truthCam, pose: truthPose },
      cov: null,
    };
  };

  /**
   * Take a picture. The camera that actually takes it is a random realisation of the true pose (navigation solution
   * + errors drawn from the stated uncertainties); that pose is hidden and used only to score the geocorrection.
   */
  export function capture() {
    if (!world) return;
    const nominal = navPose(params);
    frameStore.frame = shoot(
      nominal,
      realizePose(nominal, params, session.frameId + 1),
    );
    resetGcp();
    session.hasFrame = true;
    session.pixel = null;
    session.frameId++;
  }

  /** Take a stereo pair: the second exposure is one baseline further along the look azimuth. */
  export function captureStereo() {
    if (!world) return;
    const L = navPose(params),
      R: Pose = { ...L, position: L.position.clone().add(baselineVec(params)) };
    const [tl, tr] = realizePair(
      L,
      R,
      params,
      5000 + stereo.id,
      params.stereoCorr,
    );
    stereoStore.left = shoot(L, tl);
    stereoStore.right = shoot(R, tr);
    stereo.pL = null;
    stereo.pR = null;
    stereo.has = true;
    stereo.id++;
  }

  /** Orthographic top view of the true terrain: the reference map. Window centre/size in metres; `rot` = bearing (rad) shown at the top. */
  export function renderMap(
    cx: number,
    cz: number,
    size: number,
    px: number,
    rot: number,
  ): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = out.height = px;
    if (!world) return out;
    const rot_ = Number.isFinite(rot) ? rot : 0;
    const oc = new THREE.OrthographicCamera(
      -size / 2,
      size / 2,
      size / 2,
      -size / 2,
      1,
      3000,
    );
    oc.up.set(Math.sin(rot_), 0, -Math.cos(rot_));
    oc.position.set(cx, 1500, cz);
    oc.lookAt(cx, 0, cz);
    const hv = helpers.visible,
      gv = world.geo.visible,
      lv = world.land.visible;

    helpers.visible = false;
    world.geo.visible = false;
    world.land.visible = true;
    r3.setSize(px, px);
    r3.render(scene, oc);
    helpers.visible = hv;
    world.geo.visible = gv;
    world.land.visible = lv;
    out.getContext("2d")!.drawImage(r3.domElement, 0, 0);
    return out;
  }

  // Reactive layers (each effect owns one layer)
  // World: rebuilt whenever a new terrain is generated
  $effect(() => {
    const t = env.terrain;
    if (!ready) return;
    if (world) {
      scene.remove(world.group);
      world.dispose();
    }
    world = buildWorld(t);
    scene.add(world.group);
    session.world = ++worldN;
  });

  // Geoid / ellipsoid surfaces, and the terrain on/off switch
  $effect(() => {
    void env.terrain;
    if (!ready) return;
    world.updateGeoid(params.geoidExag);
    world.geo.visible = params.showGeo;
    world.land.visible = params.showTerrain;
  });

  // Current platform: frustum, error region and, in stereo mode, the preview of the second exposure
  $effect(() => {
    if (!ready) return;
    const pose = navPose(params),
      terrain = dem.value,
      showLive = params.showLive;
    setPose(sc, pose);
    live.show(showLive);
    platformRoot.visible = showLive;
    live2.show(showLive && stereoMode);
    if (!showLive) return;
    live.update(sc, terrain);
    const axes = [
      params.positionError.east,
      params.positionError.north,
      params.positionError.up,
    ] as const;
    platformEllipsoid.show(true);
    platformEllipsoid.set(pose.position, axes);
    platformEllipsoid2.show(stereoMode);
    if (stereoMode) {
      setPose(sc2, {
        ...pose,
        position: pose.position.clone().add(baselineVec(params)),
      });
      live2.update(sc2, terrain);
      platformEllipsoid2.set(sc2.position, axes);
    }
  });

  // Sliders after capture: the picture and the true pose stay fixed; the navigation solution is re-derived from them
  $effect(() => {
    void session.frameId;
    void [
      params.positionError.east,
      params.positionError.north,
      params.positionError.up,
      params.attitudeError.roll,
      params.attitudeError.pitch,
      params.attitudeError.yaw,
    ];
    const f = frameStore.frame;
    if (!f || !ready) return;

    const nav = navFromTruth(f.truth.pose, params, session.frameId);
    untrack(() => {
      const cam = makeCam();
      setPose(cam, nav);
      f.nominal = { cam, pose: nav };
      if (!gcp.result) {
        // keep GCP-corrected frames as they are
        f.cam = cam;
        f.pose = nav;
      }
      session.rev++;
    });
  });

  // Mono: clicked ground point
  $effect(() => {
    void session.rev;
    const groundPoint = ground.value,
      frame = frameStore.frame,
      px = session.pixel,
      asSphere = sphere;
    if (!ready) return;
    const on = !!groundPoint && !!frame && mono;
    groundRoot.visible = on;
    if (!on || !groundPoint || !frame || !px) return;

    const groundTruth = intersect(
      env.terrain.dsm,
      frame.truth.cam.position,
      pixelRay(frame.truth.cam, px[0], px[1]),
    );

    trueDot.visible = !!groundTruth;

    groundRay.geometry.setFromPoints([frame.cam.position, groundPoint.p]);
    groundDot.position.copy(groundPoint.p);
    flatDot.position.copy(groundPoint.pf);

    if (!groundTruth) return;
    trueDot.position.copy(groundTruth);
    groundSensor.set(
      groundTruth,
      { cep: groundPoint.cepS, lep: groundPoint.lepS, sep: groundPoint.sepS },
      asSphere,
      0.4,
    );
    groundTotal.set(groundTruth, groundPoint, asSphere, 0.4);
  });

  // Mono: frustum of the captured image (blue) and, after GCP correction, the reprojected one (green)
  $effect(() => {
    void session.frameId;
    void session.rev;
    const f = frameStore.frame,
      terrain = dem.value,
      corr = gcp.result,
      showFrame = params.showFrame,
      showCorr = params.showCorr;
    if (!ready) return;
    const a = !!f && mono && showFrame,
      b = !!f && mono && !!corr && showCorr;
    captured.show(a);
    corrected.show(b);
    if (a && f) captured.update(f.nominal.cam, terrain);
    if (b && f) corrected.update(f.cam, terrain);
  });

  // Stereo: frusta of the captured pair
  $effect(() => {
    void stereo.id;
    const L = stereoStore.left,
      R = stereoStore.right,
      terrain = dem.value,
      showPair = params.showStereo;
    if (!ready) return;
    const on = !!L && !!R && stereoMode && showPair;
    pairL.show(on);
    pairR.show(on);
    if (on && L && R) {
      pairL.update(L.nominal.cam, terrain);
      pairR.update(R.nominal.cam, terrain);
    }
  });

  // Stereo: triangulated point
  $effect(() => {
    const s = stereoPt.value,
      L = stereoStore.left,
      R = stereoStore.right,
      showPair = params.showStereo,
      asSphere = sphere;
    if (!ready) return;
    const on = !!s && !!L && !!R && stereoMode && showPair;
    stereoRoot.visible = on;
    if (!on || !s || !L || !R) return;
    const a = L.nominal.cam.position,
      b = R.nominal.cam.position;
    rayL.geometry.setFromPoints([a, s.p]);
    rayR.geometry.setFromPoints([b, s.p]);
    planeGeo.setFromPoints([a, b, s.p]);
    stereoDot.position.copy(s.p);
    stereoRegion.set(s.p, s, asSphere, 0.4);
  });

  // DEM overlay and the camera flying to what is picked
  $effect(() => {
    const d = dem.value,
      show = params.showDem,
      model = params.demModel,
      frame = session.frameId;
    const picked = show ? pickedPoint(d) : null;
    if (!ready) return;

    if (!show) {
      clearDemMesh();
      if (focus.hide()) focusHome();
      return;
    }

    const full = d.n <= FULL_MAX,
      poi = focus.pointOfInterest(picked, frame);
    const [cx, cz] = full ? [0, 0] : windowCentre(d, poi);
    const p = d.patch(cx, cz, full ? FULL_MAX : WINDOW_N);
    const key = `${p.x0}|${p.z0}|${p.n}|${p.step}|${model}`;
    const w = (p.n - 1) * p.step,
      mx = p.x0 + w / 2,
      mz = p.z0 + w / 2;

    if (!(demMesh && focus.isBuilt(d, key))) {
      // build the window unless it is already there
      clearDemMesh();
      // a small window is drawn over the terrain (depthTest off): the rendered terrain is a 4.7 m triangulation and could hide centimetre detail
      demMesh = demGrid(
        p.n,
        p.step,
        p.heights,
        Math.max(0.02, Math.min(0.5, p.step * 0.25)),
        full,
      );
      demMesh.position.set(mx, 0, mz);
      demMesh.renderOrder = 5;
      demMesh.frustumCulled = false;
      helpers.add(demMesh);
      focus.markBuilt(d, key);
    }

    // camera: fly to a newly picked point (or to the window after a DEM change); go home for a whole-tile overlay
    const act = focus.cameraAction(full, d.spacing, picked, poi, {
      x: mx,
      y: d.height(mx, mz),
      z: mz,
    });
    if (act === "home") focusHome();
    else if (act) focusOn(act.x, act.y, act.z, w * 1.2);
  });

  // Renderer, orbit input, render loop
  // Runs when the <div> is mounted; the returned function is the cleanup. untrack: never re-run on state reads.
  const setup: Attachment<HTMLDivElement> = (host) =>
    untrack(() => {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      host.append(renderer.domElement);
      r2 = new THREE.WebGLRenderer({
        preserveDrawingBuffer: true,
        antialias: true,
      });
      r2.setSize(IMG_W, IMG_H);
      r3 = new THREE.WebGLRenderer({
        preserveDrawingBuffer: true,
        antialias: true,
      });

      const cam = new THREE.PerspectiveCamera(50, 1, 1, 8000);

      // input is collected between frames and applied once per frame
      let drag: [number, number] | null = null,
        raf = 0,
        dAz = 0,
        dEl = 0,
        dZoom = 0;
      const dom = renderer.domElement;
      dom.style.touchAction = "none";
      dom.onpointerdown = (e) => {
        drag = [e.clientX, e.clientY];
        dom.setPointerCapture(e.pointerId);
      };
      dom.onpointerup = () => (drag = null);
      dom.onpointermove = (e) => {
        if (!drag) return;
        dAz -= (e.clientX - drag[0]) * 0.005;
        dEl += (e.clientY - drag[1]) * 0.005;
        drag = [e.clientX, e.clientY];
      };
      dom.onwheel = (e) => {
        e.preventDefault();
        const d = e.deltaY * (e.deltaMode === 1 ? 33 : 1); // lines -> pixels
        dZoom = Math.max(
          -0.5,
          Math.min(0.5, dZoom + Math.max(-120, Math.min(120, d)) * 0.001),
        ); // one flick can't build up an unbounded zoom
      };
      const ro = new ResizeObserver(() => {
        const w = host.clientWidth,
          h = host.clientHeight;
        renderer.setSize(w, h);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      });
      ro.observe(host);

      const loop = () => {
        if (dAz || dEl) {
          orbit.az += dAz;
          orbit.el = Math.max(0.05, Math.min(1.5, orbit.el + dEl));
          dAz = dEl = 0;
        }
        if (dZoom) {
          const step = Math.max(-0.12, Math.min(0.12, dZoom));
          dZoom -= step; // eased: at most 12 % per frame
          orbit.dist = Math.max(
            orbit.minDist,
            Math.min(3500, orbit.dist * Math.exp(step)),
          );
        }
        const { az, el, dist, tgt } = orbit; // read every frame: focusOn() moves orbit.tgt
        cam.position.set(
          tgt.x + dist * Math.cos(el) * Math.sin(az),
          tgt.y + dist * Math.sin(el),
          tgt.z + dist * Math.cos(el) * Math.cos(az),
        );
        const near = Math.max(0.01, dist * 0.02);
        if (Math.abs(near - cam.near) > cam.near * 0.05) {
          cam.near = near; // keeps close-ups from being clipped
          cam.updateProjectionMatrix();
        }
        cam.lookAt(tgt);
        renderer.render(scene, cam);
        // gizmo pass: bottom-right corner, drawn over the main view
        gizmo.group.quaternion.copy(cam.quaternion).invert();
        const w = host.clientWidth,
          h = host.clientHeight,
          s = Math.round(Math.min(130, w * 0.3, h * 0.3));
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.setScissorTest(true);
        renderer.setViewport(w - s - 12, 12, s, s);
        renderer.setScissor(w - s - 12, 12, s, s);
        renderer.render(gizmo.scene, gizmo.camera);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.autoClear = true;
        raf = requestAnimationFrame(loop);
      };
      loop();
      ready = true;
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.dispose();
        r2.dispose();
        r3.dispose();
      };
    });
</script>

<div class="host" {@attach setup}></div>

<style>
  .host {
    position: absolute;
    inset: 0;
  }
</style>
