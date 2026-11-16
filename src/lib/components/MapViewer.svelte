<script lang="ts">
  import { untrack } from "svelte";
  import {
    gcp,
    session,
    frameStore,
    env,
    dem,
    params,
    gcpAddMap,
  } from "../contexts/state.svelte";
  import { orthoImage } from "../ortho";
  import { locate } from "../georef";
  import { intersect } from "../terrain";
  import { pixelRay } from "../sensor";
  import { panzoom } from "../panzoom";
  import RadioGroup from "./RadioGroup.svelte";
  import MiniMap from "./MiniMap.svelte";
  import { bitmapOf } from "../contexts/bitmap.svelte";
  import type { Attachment } from "svelte/attachments";
  import { compassLetter, strokeCompass } from "../compass";

  interface View {
    cx: number;
    cz: number;
    size: number;
    rot: number;
  }

  interface Props {
    renderMap: (
      cx: number,
      cz: number,
      size: number,
      px: number,
      rot?: number,
    ) => HTMLCanvasElement;
  }

  let { renderMap }: Props = $props();
  const WIDTH = 480;
  const ZOOM = 140;
  let canvas: HTMLCanvasElement;

  // Map window (centre + width in metres). Wheel/drag change it; the map is re-rendered, so it stays sharp at any zoom.
  const mapViewer = $state<View>({
    cx: 0,
    cz: 0,
    size: env.terrain.size,
    rot: 0,
  });
  const overlayOptions = $derived([
    { value: "none", label: "off", disabled: false },
    { value: "before", label: "before", disabled: !session.hasFrame },
    { value: "after", label: "after", disabled: !gcp.result },
  ]);
  const bearing = $derived(
    Math.round(((mapViewer.rot * 180) / Math.PI + 360) % 360),
  );

  let saved: View | null = null;
  const overview = bitmapOf(() => {
    void session.world;
    return renderMap(0, 0, env.terrain.size, 240, 0);
  });

  function alignWithImage() {
    const f = frameStore.frame;
    if (!f) return;
    const at = (ny: number) =>
      intersect(dem.value, f.cam.position, pixelRay(f.cam, 0, ny));
    const lo = at(-0.1),
      hi = at(0.1); // two ground points on the centre line, lower and upper
    if (lo && hi) mapViewer.rot = Math.atan2(hi.x - lo.x, -(hi.z - lo.z));
  }

  const clampCenter = () => {
    const h = env.terrain.size / 2;
    mapViewer.cx = Math.max(-h, Math.min(h, mapViewer.cx));
    mapViewer.cz = Math.max(-h, Math.min(h, mapViewer.cz));
  };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  const toWorldCoords = (v: View, px: number, py: number): [number, number] => {
    const a = (px / WIDTH - 0.5) * v.size,
      b = (py / WIDTH - 0.5) * v.size,
      co = Math.cos(v.rot),
      si = Math.sin(v.rot);
    return [v.cx + a * co - b * si, v.cz + a * si + b * co];
  };
  const toCanvasCoords = (v: View, x: number, z: number): [number, number] => [
    ((x - v.cx) / v.size + 0.5) * WIDTH,
    ((z - v.cz) / v.size + 0.5) * WIDTH,
  ];

  const pz: Attachment<HTMLCanvasElement> = (el) =>
    panzoom(el, {
      wheel(x, y, f) {
        const size = Math.min(
          env.terrain.size,
          Math.max(20, mapViewer.size / f),
        );
        const [wx, wz] = toWorldCoords(mapViewer, x, y);
        const a = (x / WIDTH - 0.5) * size;
        const b = (y / WIDTH - 0.5) * size;
        const cos = Math.cos(mapViewer.rot);
        const sin = Math.sin(mapViewer.rot);
        mapViewer.cx = wx - (a * cos - b * sin);
        mapViewer.cz = wz - (a * sin + b * cos);
        mapViewer.size = size;
        clampCenter();
      },
      drag(dx, dy) {
        const s = mapViewer.size / WIDTH;
        const cos = Math.cos(mapViewer.rot);
        const sin = Math.sin(mapViewer.rot);
        mapViewer.cx += -dx * s * cos + dy * s * sin;
        mapViewer.cz += -dx * s * sin - dy * s * cos;
        clampCenter();
      },
      rotate(d) {
        if (Number.isFinite(d)) mapViewer.rot = wrap(mapViewer.rot - d);
      },
      reset() {
        Object.assign(
          mapViewer,
          gcp.pending
            ? { cx: gcp.pending.proj.x, cz: gcp.pending.proj.z, size: ZOOM }
            : { cx: 0, cz: 0, size: env.terrain.size },
        );
      },
      click(x, y) {
        if (gcp.mode && gcp.pending) {
          const [wx, wz] = toWorldCoords(mapViewer, x, y);
          gcpAddMap(wx, wz);
        }
      },
    });

  function compass(ctx: CanvasRenderingContext2D, v: View) {
    strokeCompass(
      ctx,
      WIDTH - 52,
      52,
      22,
      Math.atan2(-Math.cos(v.rot), -Math.sin(v.rot)),
    );
    compassLetter(ctx, WIDTH - 52, 52, 26);
  }
  function cross(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
  ) {
    ctx.save();
    ctx.lineCap = "round";
    for (const [w, c] of [
      [4, "rgba(0,0,0,.85)"],
      [1.8, color],
    ] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
    }
    ctx.restore();
  }
  function ring(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
    dash: number[] = [],
  ) {
    ctx.save();
    ctx.setLineDash(dash);
    for (const [w, c] of [
      [4, "rgba(0,0,0,.85)"],
      [1.8, color],
    ] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    const ctx = canvas.getContext("2d")!,
      v = mapViewer,
      f = frameStore.frame;
    ctx.clearRect(0, 0, WIDTH, WIDTH);
    ctx.drawImage(renderMap(v.cx, v.cz, v.size, WIDTH, v.rot), 0, 0);
    if (!f || !session.hasFrame) {
      compass(ctx, v);
      return;
    }
    if (gcp.overlay !== "none") {
      // the image reprojected with the original or the corrected pose
      const cam = gcp.overlay === "before" ? f.nominal.cam : f.cam,
        t = document.createElement("canvas");
      t.width = t.height = WIDTH;
      t.getContext("2d")!.putImageData(
        orthoImage(f.snap, cam, dem.value, v, WIDTH),
        0,
        0,
      );
      ctx.globalAlpha = 0.65;
      ctx.drawImage(t, 0, 0);
      ctx.globalAlpha = 1;
    }
    // footprints: blue = original navigation solution, green = corrected (after GCP reprojection)
    const foot = (cam: typeof f.cam, color: string) => {
      const fp = (
        [
          [-1, 1],
          [1, 1],
          [1, -1],
          [-1, -1],
        ] as const
      ).map(([x, y]) =>
        intersect(dem.value, cam.position, pixelRay(cam, x, y)),
      );
      if (!fp.every(Boolean)) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      fp.forEach((p, i) => {
        const [x, y] = toCanvasCoords(v, p!.x, p!.z);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };
    foot(f.nominal.cam, "#4fc3f7");
    if (gcp.result) foot(f.cam, "#5ce08a");
    gcp.list.forEach((q, i) => {
      // green = chosen map position, orange x = where the image currently projects
      const [mx, my] = toCanvasCoords(v, q.map.x, q.map.z),
        p = intersect(dem.value, f.cam.position, pixelRay(f.cam, q.nx, q.ny));
      if (p) {
        const [px, py] = toCanvasCoords(v, p.x, p.z);
        ctx.save();
        ctx.strokeStyle = "rgba(240,138,36,.8)";
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
        cross(ctx, px, py, 4, "#f08a24");
      }
      ring(ctx, mx, my, 5, "#5ce08a");
      ctx.save();
      ctx.font = "bold 11px system-ui,sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.85)";
      ctx.fillStyle = "#fff";
      ctx.strokeText(String(i + 1), mx + 8, my - 7);
      ctx.fillText(String(i + 1), mx + 8, my - 7);
      ctx.restore();
    });
    const pd = gcp.pending;
    if (pd) {
      // projected position of the clicked pixel + its 90 % uncertainty
      const [x, y] = toCanvasCoords(v, pd.proj.x, pd.proj.z),
        g = locate(
          env.terrain.dsm,
          dem.value,
          params,
          f.pose,
          f.cam,
          pd.nx,
          pd.ny,
          f.cov,
        );
      cross(ctx, x, y, 6, "#f08a24");
      if (g) ring(ctx, x, y, (g.cep / v.size) * WIDTH, "#f08a24", [6, 4]);
    }
    compass(ctx, v);
  }

  // Jump to a close-up of the projected point while a reference point awaits its map position, then come back
  $effect(() => {
    const pd = gcp.pending;
    untrack(() => {
      if (pd && !saved) {
        saved = { ...mapViewer };
        Object.assign(mapViewer, { cx: pd.proj.x, cz: pd.proj.z, size: ZOOM });
      } else if (!pd && saved) {
        Object.assign(mapViewer, saved);
        saved = null;
      }
    });
  });

  $effect(() => {
    void session.world;
    void session.frameId;
    void session.rev;
    void gcp.overlay;
    draw();
  });
</script>

<div class="stage">
  <canvas
    bind:this={canvas}
    width={WIDTH}
    height={WIDTH}
    style:cursor={gcp.mode && gcp.pending ? "crosshair" : "default"}
    {@attach pz}
  ></canvas>
  {#if overview.value}
    <MiniMap
      bitmap={overview.value}
      imgW={env.terrain.size}
      imgH={env.terrain.size}
      cx={mapViewer.cx + env.terrain.size / 2}
      cy={mapViewer.cz + env.terrain.size / 2}
      zoom={WIDTH /
        (mapViewer.size *
          (Math.abs(Math.cos(mapViewer.rot)) +
            Math.abs(Math.sin(mapViewer.rot))))}
      viewW={WIDTH}
      viewH={WIDTH}
      maxW={96}
      maxH={96}
      onpan={(x, y) => {
        mapViewer.cx = x - env.terrain.size / 2;
        mapViewer.cz = y - env.terrain.size / 2;
        clampCenter();
      }}
    />
  {/if}
</div>

<div class="footer">
  <button disabled={!session.hasFrame} onclick={alignWithImage}
    >Align with image</button
  >
  <button
    disabled={Math.abs(mapViewer.rot) < 1e-6}
    onclick={() => (mapViewer.rot = 0)}>North up</button
  >
  <span class="note">up = {bearing}° · Shift + drag to rotate</span>
</div>

<div class="footer">
  <span class="note">Reprojected image over map:</span>
  <RadioGroup
    name="gcp-overlay"
    options={overlayOptions}
    bind:value={gcp.overlay}
  />
</div>

<style>
  .stage {
    position: relative;
  }
  canvas {
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: #000;
    display: block;
  }
  .footer {
    display: flex;
    gap: var(--size-sm);
    flex-wrap: wrap;
    align-items: center;
  }
</style>
