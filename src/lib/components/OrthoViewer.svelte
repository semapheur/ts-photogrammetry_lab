<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import {
    params,
    session,
    frameStore,
    env,
    dem,
    gcp,
  } from "../contexts/state.svelte";
  import { orthoImage } from "../ortho";
  import {
    footprintWindow,
    warpField,
    heatCanvas,
    type OrthoWindow,
    type WarpStats,
  } from "../orthophoto";
  import { panzoom } from "../panzoom";
  import { View } from "../contexts/view.svelte";
  import { bitmapOf } from "../contexts/bitmap.svelte";
  import { strokeCompass, compassLetter } from "../compass";
  import MiniMap from "./MiniMap.svelte";

  let {
    renderMap,
  }: {
    renderMap: (
      cx: number,
      cz: number,
      size: number,
      px: number,
      rot?: number,
    ) => HTMLCanvasElement | undefined;
  } = $props();

  const D = 960,
    K = D / 480; // display canvas size (px); overlay scale
  const GSDS = [0.25, 0.5, 1, 2];
  type Mode = "ortho" | "map" | "blend" | "error" | "warp";
  const MODES: { value: Mode; label: string }[] = [
    { value: "ortho", label: "orthophoto" },
    { value: "map", label: "reference map" },
    { value: "blend", label: "blend" },
    { value: "error", label: "position error" },
    { value: "warp", label: "warping" },
  ];

  interface Result {
    ortho: HTMLCanvasElement;
    ref: HTMLCanvasElement | null;
    error: HTMLCanvasElement;
    warp: HTMLCanvasElement;
    win: OrthoWindow;
    px: number;
    gsd: number;
    stats: WarpStats;
    errScale: number;
    warpScale: number;
    label: string;
    sig: string;
  }
  let result = $state.raw<Result | null>(null);
  let busy = $state(false);
  let gsd = $state(1);
  let useCorrected = $state(true);
  let mode = $state<Mode>("ortho");
  let blend = $state(0.5);
  let canvas: HTMLCanvasElement;

  const view = new View(D, D);
  const centre = $derived(view.centre);
  const thumb = bitmapOf(() => result?.ortho);

  const corrected = $derived(useCorrected && !!gcp.result);
  /** Everything the orthophoto depends on: when it changes, the shown result is out of date. */
  const sig = $derived(
    `${params.demModel}|${params.demRes}|${corrected}|${gsd}|${session.frameId}|${session.rev}`,
  );
  const stale = $derived(!!result && result.sig !== sig);

  async function run() {
    const f = frameStore.frame;
    if (!f || busy) return;
    busy = true;
    await new Promise((r) => setTimeout(r, 30)); // let the "working" state paint before the heavy loop
    try {
      const cam = corrected ? f.cam : f.nominal.cam,
        model = dem.value,
        win = footprintWindow(cam, model);
      if (!win) return;
      // 1. orthorectify: every map pixel -> DEM height -> camera -> picture
      const px = Math.max(64, Math.min(2048, Math.ceil(win.size / gsd)));
      const ortho = document.createElement("canvas");
      ortho.width = ortho.height = px;
      ortho
        .getContext("2d")!
        .putImageData(
          orthoImage(f.snap, cam, model, { ...win, rot: 0 }, px),
          0,
          0,
        );
      // 2. how wrong is it? (true camera + true surface, which only the simulation knows)
      const wf = warpField(f, cam, model, env.terrain.dsm, win, 128),
        s = wf.stats;
      const errScale = Math.max(1, Math.ceil(s.p90 * 1.5)),
        warpScale = Math.max(1, Math.ceil(s.warpP90 * 1.5));
      result = {
        ortho,
        ref: renderMap(win.cx, win.cz, win.size, px, 0) ?? null,
        win,
        px,
        gsd: win.size / px,
        stats: s,
        errScale,
        warpScale,
        sig,
        error: heatCanvas(wf.total, wf.G, errScale),
        warp: heatCanvas(wf.warp, wf.G, warpScale),
        label: `${corrected ? "GCP-corrected" : "navigation-solution"} camera, ${params.demModel.toUpperCase()} ${model.spacing < 1 ? model.spacing.toFixed(2) : model.spacing.toFixed(1)} m`,
      };
    } finally {
      busy = false;
    }
  }

  function save() {
    result?.ortho.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "orthophoto.png";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // drawing
  const outlined = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
  ) => {
    ctx.lineWidth = 3 * K;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y);
  };
  function scaleBar(ctx: CanvasRenderingContext2D, r: Result) {
    const mpp = r.win.size / (D * view.z); // metres per display pixel
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].reduce((a, b) =>
        Math.abs(b / mpp - 100 * K) < Math.abs(a / mpp - 100 * K) ? b : a,
      ),
      len = nice / mpp;
    const x = 14 * K,
      y = D - 16 * K;
    ctx.save();
    ctx.font = `bold ${11 * K}px system-ui,sans-serif`;
    ctx.textBaseline = "bottom";
    for (const [w, c] of [
      [5 * K, "rgba(0,0,0,.85)"],
      [2 * K, "#fff"],
    ] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    outlined(ctx, `${nice} m`, x, y - 4 * K);
    ctx.restore();
  }
  function legend(ctx: CanvasRenderingContext2D, r: Result) {
    const scale = mode === "warp" ? r.warpScale : r.errScale,
      x = 14 * K,
      y = D - 48 * K,
      w = 140 * K,
      h = 9 * K;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    for (let i = 0; i <= 4; i++)
      g.addColorStop(i / 4, `hsl(${240 * (1 - i / 4)} 90% 50%)`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = K;
    ctx.strokeRect(x, y, w, h);
    ctx.font = `bold ${11 * K}px system-ui,sans-serif`;
    ctx.textBaseline = "bottom";
    outlined(
      ctx,
      `${mode === "warp" ? "warping" : "position error"}: 0`,
      x,
      y - 3 * K,
    );
    ctx.textAlign = "right";
    outlined(ctx, `≥ ${scale} m`, x + w, y - 3 * K);
    ctx.restore();
  }
  function draw() {
    const ctx = canvas.getContext("2d")!,
      r = result;
    ctx.fillStyle = "#15171a";
    ctx.fillRect(0, 0, D, D);
    if (!r) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const put = (c: HTMLCanvasElement, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(c, view.ox, view.oy, D * view.z, D * view.z);
      ctx.globalAlpha = 1;
    };
    if (mode === "map") {
      if (r.ref) put(r.ref);
    } else if (mode === "blend") {
      if (r.ref) put(r.ref);
      put(r.ortho, blend);
    } else {
      put(r.ortho);
      if (mode === "error") put(r.error, 0.65);
      else if (mode === "warp") put(r.warp, 0.65);
    }
    scaleBar(ctx, r);
    if (mode === "error" || mode === "warp") legend(ctx, r);
    strokeCompass(ctx, D - 52 * K, 52 * K, 22 * K, -Math.PI / 2);
    compassLetter(ctx, D - 52 * K, 52 * K, 26 * K); // north is up
  }
  $effect(() => {
    void result;
    void mode;
    void blend;
    draw();
  });
  $effect(() => {
    void session.frameId;
    result = null;
    view.reset();
  }); // new picture: start over

  const pz: Attachment<HTMLCanvasElement> = (el) =>
    panzoom(el, {
      wheel: (x, y, f) => view.zoom(x, y, f),
      drag: (dx, dy) => view.pan(dx, dy),
      reset: () => view.reset(),
      click() {},
    });

  const f1 = (n: number, d = 1) => n.toFixed(d);
  const report = $derived.by(() => {
    const r = result;
    if (!r) return "";
    const s = r.stats;
    return [
      `${r.px} × ${r.px} px · GSD ${f1(r.gsd, 2)} m · ${r.label}`,
      `POSITION ERROR vs truth (${s.n} cells): median ${f1(s.p50)} m · 90 % ${f1(s.p90)} m · max ${f1(s.max)} m · RMSE ${f1(s.rmse)} m`,
      `   of which a uniform shift: ${f1(s.shift)} m (E ${f1(s.shiftE)}, N ${f1(s.shiftN)}), from the navigation error`,
      `WARPING, i.e. what an affine fit cannot remove: median ${f1(s.warpP50)} m · 90 % ${f1(s.warpP90)} m · RMSE ${f1(s.warpRmse)} m`,
    ].join("\n");
  });
</script>

<div class="btns">
  <button class="p" disabled={!session.hasFrame || busy} onclick={run}
    >{busy ? "Working…" : "Orthorectify"}</button
  >
  <button disabled={!result} onclick={save}>Save PNG</button>
  <label
    >GSD <select bind:value={gsd}
      >{#each GSDS as g}<option value={g}>{g} m</option>{/each}</select
    ></label
  >
  <label
    ><input
      type="checkbox"
      bind:checked={useCorrected}
      disabled={!gcp.result}
    /> GCP-corrected camera</label
  >
</div>
{#if stale}<p class="note">
    Settings changed since this result: press Orthorectify to update.
  </p>{/if}
<div class="stage">
  <canvas bind:this={canvas} width={D} height={D} {@attach pz}></canvas>
  {#if thumb.value}
    <MiniMap
      bitmap={thumb.value}
      imgW={D}
      imgH={D}
      cx={centre[0]}
      cy={centre[1]}
      zoom={view.z}
      viewW={D}
      viewH={D}
      maxW={90}
      maxH={90}
      onpan={(x, y) => view.centerOn(x, y)}
    />
  {/if}
</div>
<div class="btns radios">
  {#each MODES as m}<label
      ><input
        type="radio"
        bind:group={mode}
        value={m.value}
        disabled={!result}
      />
      {m.label}</label
    >{/each}
  {#if mode === "blend"}<input
      type="range"
      min="0"
      max="1"
      step="0.05"
      bind:value={blend}
      aria-label="Orthophoto opacity"
    />{/if}
</div>
<pre class="out">{report}</pre>
<p class="note">
  Each map pixel takes its height from the elevation model and its colour from
  the picture. Where the model is wrong (no buildings in a DTM, posts that are
  too coarse) content lands at the wrong place, which shows as lean, smear and
  warping. Strong local errors behind tall objects are occlusions: the camera
  never saw that ground.
</p>

<style>
  .stage {
    position: relative;
  }
  canvas {
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: #15171a;
    display: block;
    cursor: crosshair;
  }
  .btns {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 8px 0;
    align-items: center;
  }
</style>
