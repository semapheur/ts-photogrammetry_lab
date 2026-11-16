<script lang="ts">
  import { stereo, stereoStore, stereoPt, env } from "../contexts/state.svelte";
  import { latLon, ORIGIN } from "../georef";
  import { pixelRay, IMG_W as W, IMG_H as H, groundDir } from "../sensor";
  import { panzoom } from "../panzoom";
  import { View } from "../contexts/view.svelte";
  import type { Frame } from "../types";
  import { bitmapOf } from "../contexts/bitmap.svelte";
  import type { Attachment } from "svelte/attachments";
  import Button from "./Button.svelte";
  import { css, STEREO } from "../colors";
  import Tooltip from "./Tooltip.svelte";
  import StereoCard from "./StereoCard.svelte";
  import { Vector3 } from "three";
  import { compassLetter, strokeCompass } from "../compass";

  type P = [number, number];

  let { capture }: { capture: () => void } = $props();
  const K = W / 480;
  let canvasL = $state<HTMLCanvasElement>();
  let canvasR = $state<HTMLCanvasElement>();
  const viewL = new View(W, H);
  const viewR = new View(W, H);
  const centerL = $derived(viewL.centre);
  const centerR = $derived(viewR.centre);
  const thumbL = bitmapOf(() => {
    void stereo.id;
    return stereoStore.left?.snap;
  });
  const thumbR = bitmapOf(() => {
    void stereo.id;
    return stereoStore.right?.snap;
  });

  /** Epipolar line: where a point seen in `src` can appear in `dst` (from the navigation-solution poses). */
  const epipolar = (src: Frame, dst: Frame, p: P, v: View) => {
    const o = src.nominal.cam.position,
      d = pixelRay(src.nominal.cam, p[0], p[1]),
      out: [number, number][] = [];
    for (let s = 100; s <= 3500; s += 50) {
      const w = o.clone().addScaledVector(d, s);
      if (w.clone().applyMatrix4(dst.nominal.cam.matrixWorldInverse).z >= 0)
        continue; // behind the camera
      const q = w.project(dst.nominal.cam);
      out.push(v.toS(((q.x + 1) / 2) * W, ((1 - q.y) / 2) * H));
    }
    return out;
  };

  const compass = (ctx: CanvasRenderingContext2D, f: Frame) => {
    const [nx, ny] = groundDir(f.cam, env.terrain, new Vector3(0, 0, -1), W, H);
    strokeCompass(ctx, W - 52 * K, 52 * K, 22 * K, Math.atan2(ny, nx));
    compassLetter(ctx, W - 52 * K, 52 * K, 26 * K);
  };

  function paint(
    cv: HTMLCanvasElement,
    f: Frame | null,
    v: View,
    pt: P | null,
    other: { f: Frame; p: P; color: string } | null,
  ) {
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    if (!f) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f.snap, v.ox, v.oy, W * v.z, H * v.z);
    compass(ctx, f);
    if (other) {
      const line = epipolar(other.f, f, other.p, v);
      ctx.save();
      ctx.lineJoin = "round";
      for (const [w, c] of [
        [4 * K, "rgba(0,0,0,.85)"],
        [1.8 * K, other.color],
      ] as const) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.restore();
    }
    if (pt) {
      const [u, w] = v.nToS(pt[0], pt[1]),
        r = 9 * K;
      ctx.save();
      for (const [lw, c] of [
        [4 * K, "rgba(0,0,0,.85)"],
        [1.8 * K, "#ffffff"],
      ] as const) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(u, w, r, 0, Math.PI * 2);
        ctx.moveTo(u - r * 1.8, w);
        ctx.lineTo(u - r * 0.5, w);
        ctx.moveTo(u + r * 0.5, w);
        ctx.lineTo(u + r * 1.8, w);
        ctx.moveTo(u, w - r * 1.8);
        ctx.lineTo(u, w - r * 0.5);
        ctx.moveTo(u, w + r * 0.5);
        ctx.lineTo(u, w + r * 1.8);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.restore();
  }
  // Each image redraws when the pair, either click, or its own zoom/pan changes (tracked through paint())
  $effect(() => {
    void stereo.id;
    paint(
      canvasL,
      stereoStore.left,
      viewL,
      stereo.pL,
      stereo.pR && stereoStore.right
        ? { f: stereoStore.right, p: stereo.pR, color: css(STEREO.right) }
        : null,
    );
  });
  $effect(() => {
    void stereo.id;
    paint(
      canvasR,
      stereoStore.right,
      viewR,
      stereo.pR,
      stereo.pL && stereoStore.left
        ? { f: stereoStore.left, p: stereo.pL, color: css(STEREO.left) }
        : null,
    );
  });
  $effect(() => {
    void stereo.id;
    viewL.reset();
    viewR.reset();
  });

  const attach =
    (v: View, set: (p: P) => void): Attachment<HTMLCanvasElement> =>
    (cv) =>
      panzoom(cv, {
        wheel: (x, y, f) => v.zoom(x, y, f),
        drag: (dx, dy) => v.pan(dx, dy),
        reset: () => v.reset(),
        click(x, y) {
          if (!stereoStore.left) return;
          const [u, w] = v.fromS(x, y);
          set([(u / W) * 2 - 1, -((w / H) * 2 - 1)]);
        },
      });
  const attachL = attach(viewL, (p) => {
    stereo.pL = p;
  });
  const attachR = attach(viewR, (p) => {
    stereo.pR = p;
  });

  const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
  const s = $derived(stereoPt.value);
  const status = $derived(
    !stereo.has
      ? "Capture a stereo pair first."
      : !stereo.pL
        ? "Click a feature in the left image."
        : !stereo.pR
          ? "Now click the same feature in the right image. The violet line is its epipolar line: the match must lie on it."
          : "Refine either click if needed. The 3D view shows both rays, the epipolar plane and the error cylinder.",
  );
  const report = $derived.by(() => {
    if (!s) return "";
    const ll = latLon(s.p.x, s.p.z)
      .map((v) => v.toFixed(6))
      .join(", ");
    const lines = [
      `POINT     E ${f1(ORIGIN.E + s.p.x)}  N ${f1(ORIGIN.N - s.p.z)}  H ${f1(s.p.y)} m`,
      `          lat,lon ${ll}`,
      `90 %      CEP90 ${f1(s.cep)} m  LEP90 ${f1(s.lep)} m  SEP90 ${f1(s.sep)} m`,
      "",
      `PARALLAX  Δy ${f1(s.dpx)} px   baseline ${f1(s.B)} m   B/H ${f1(s.B / s.H, 2)}`,
      `HEIGHT    triangulated ${f1(s.p.y)} m`,
      `          classic h = H − B·f/Δy: ${f1(s.hClassic)} m (valid near nadir)`,
      `          DEM at this position: ${f1(s.demH)} m   (stereo − DEM ${f1(s.p.y - s.demH)} m)`,
      `RAYS      closest approach ${f1(s.gap, 2)} m (residual y-parallax)`,
    ];
    if (stereo.showTruth && s.truthErr)
      lines.push(
        "",
        `CHECK vs truth (simulation): horizontal ${f1(s.truthErr.hz)} m, vertical ${f1(s.truthErr.dz)} m`,
      );
    return lines.join("\n");
  });
</script>

<div class="btns">
  <Button onclick={capture}>Capture stereo pair</Button>
  <Button
    disabled={!stereo.pL && !stereo.pR}
    onclick={() => {
      stereo.pL = null;
      stereo.pR = null;
    }}>Clear points</Button
  >
  <Tooltip>
    Scroll to zoom · drag to pan · double-click to reset (each image
    separately).
  </Tooltip>
</div>
<p class="note">{status}</p>
<div class="viewer-grid">
  <StereoCard
    title="Left image"
    bind:canvas={canvasL}
    width={W}
    height={H}
    borderColor={css(STEREO.left)}
    attach={attachL}
    thumb={thumbL.value}
    cx={centerL[0]}
    cy={centerL[1]}
    zoom={viewL.z}
    onpan={(x, y) => viewL.centerOn(x, y)}
  />
  <StereoCard
    title="Right image"
    bind:canvas={canvasR}
    width={W}
    height={H}
    borderColor={css(STEREO.right)}
    attach={attachR}
    thumb={thumbR.value}
    cx={centerR[0]}
    cy={centerR[1]}
    zoom={viewR.z}
    onpan={(x, y) => viewR.centerOn(x, y)}
  />
</div>

<label class="note"
  ><input type="checkbox" bind:checked={stereo.showTruth} /> Show error vs truth (simulation
  check)</label
>
<pre class="out">{report}</pre>

<style>
  .viewer-grid {
    display: grid;
    grid-template-columns: repeat(
      auto-fit,
      minmax(clamp(280px, 45%, 450px), 1fr)
    );
    gap: 1rem;
    align-items: start;
    margin: 0.5rem 0;
  }
  .btns {
    display: flex;
    gap: var(--size-lg);
    align-items: center;
  }
</style>
