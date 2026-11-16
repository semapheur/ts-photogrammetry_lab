<script lang="ts">
  import {
    params,
    session,
    frameStore,
    env,
    ground,
    gcp,
    gcpAddImage,
  } from "../contexts/state.svelte";
  import { groundDir, IMG_W as W, IMG_H as H } from "../sensor";
  import { Vector3 } from "three";
  import { strokeCompass, compassLetter } from "../compass";
  import { panzoom } from "../panzoom";
  import type { Frame, GroundPoint } from "../types";
  import { bitmapOf } from "../contexts/bitmap.svelte";
  import { View } from "../contexts/view.svelte";
  import MiniMap from "./MiniMap.svelte";
  import type { Attachment } from "svelte/attachments";

  const K = W / 480; // overlays keep their on-screen size at any capture resolution
  let canvas: HTMLCanvasElement;

  const view = new View(W, H); // zoom / pan of the picture
  const centre = $derived(view.centre);
  const thumb = bitmapOf(() => {
    void session.frameId;
    return frameStore.frame?.snap;
  });

  /** North compass from the current camera (fixed in the corner; direction measured at the image centre). */
  const compass = (ctx: CanvasRenderingContext2D, f: Frame) => {
    const [nx, ny] = groundDir(f.cam, env.terrain, new Vector3(0, 0, -1), W, H);
    strokeCompass(ctx, W - 52 * K, 52 * K, 22 * K, Math.atan2(ny, nx));
    compassLetter(ctx, W - 52 * K, 52 * K, 26 * K);
  };

  /** Ground circle (CEP90, or SEP90 in sphere mode) around the point, projected into the image. */
  const circle = (
    ctx: CanvasRenderingContext2D,
    f: Frame,
    g: GroundPoint,
    R: number,
    color: string,
    dash: number[],
  ) => {
    const pts = Array.from({ length: 73 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2,
        x = g.p.x + R * Math.cos(a),
        z = g.p.z + R * Math.sin(a);
      const q = new Vector3(x, env.terrain.dsm.height(x, z), z).project(f.cam);
      return view.toS(((q.x + 1) / 2) * W, ((1 - q.y) / 2) * H);
    });
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 5 * K;
    ctx.strokeStyle = "rgba(0,0,0,.9)";
    ctx.lineWidth = 5 * K;
    ctx.setLineDash(dash.map((d) => d * K));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * K;
    ctx.stroke();
    ctx.restore();
  };

  const mark = (
    ctx: CanvasRenderingContext2D,
    nx: number,
    ny: number,
    label: string,
    color: string,
  ) => {
    const [u, v] = view.nToS(nx, ny);
    ctx.save();
    ctx.lineWidth = 3 * K;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.beginPath();
    ctx.arc(u, v, 9 * K, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5 * K;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.font = `bold ${11 * K}px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3 * K;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.strokeText(label, u, v + K);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, u, v + K);
    ctx.restore();
  };

  const cross = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    s: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx, cy + s);
    ctx.stroke();
  };

  const draw = () => {
    const ctx = canvas.getContext("2d")!,
      f = frameStore.frame,
      g = ground.value,
      px = session.pixel;
    ctx.clearRect(0, 0, W, H);
    if (!f) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high"; // bilinear interpolation when zoomed
    ctx.drawImage(f.snap, view.ox, view.oy, W * view.z, H * view.z);
    compass(ctx, f);
    gcp.list.forEach((q, i) => mark(ctx, q.nx, q.ny, String(i + 1), "#5ce08a"));
    if (gcp.pending) mark(ctx, gcp.pending.nx, gcp.pending.ny, "?", "#f08a24");
    if (g && px) {
      const sep = params.umode === "sep";
      circle(ctx, f, g, sep ? g.sepS : g.cepS, "#c8d0d6", [5, 4]); // sensor only
      circle(ctx, f, g, sep ? g.sep : g.cep, "#f08a24", []); // sensor + DEM
      const [u, v] = view.nToS(px[0], px[1]),
        r = 8 * K;
      ctx.strokeStyle = "#fff"; //"#f08a24";
      ctx.lineWidth = 2 * K;
      ctx.beginPath();
      cross(ctx, u, v, r);

      // believed ground point, seen through the camera that actually took the picture
      const q = g.p.clone().project(f.truth.cam);
      if (q.z < 1) {
        // in front of the camera
        const [bu, bv] = view.nToS(q.x, q.y); // project() gives normalised coords, y up, like session.pixel

        // link from the clicked feature to where the solution believes it is
        ctx.save();
        ctx.setLineDash([4 * K, 3 * K]);
        ctx.lineWidth = 3 * K;
        ctx.strokeStyle = "rgba(0,0,0,.85)";
        ctx.beginPath();
        ctx.moveTo(u, v);
        ctx.lineTo(bu, bv);
        ctx.stroke();
        ctx.lineWidth = 1.5 * K;
        ctx.strokeStyle = "#f08a24";
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = "#f08a24";
        cross(ctx, bu, bv, r);

        ctx.restore();
      }
    }
  };
  // Redraws on new frame / correction / uncertainty mode; zoom, pan, GCPs and error inputs are tracked through draw()
  $effect(() => {
    void session.frameId;
    void session.rev;
    void params.umode;
    draw();
  });
  $effect(() => {
    void session.frameId;
    view.reset();
  }); // new picture: reset the view

  const pz: Attachment<HTMLCanvasElement> = (el) =>
    panzoom(el, {
      wheel: (x, y, f) => view.zoom(x, y, f),
      drag: (dx, dy) => view.pan(dx, dy),
      reset: () => view.reset(),
      click(x, y) {
        if (!frameStore.frame) return;
        const [u, v] = view.fromS(x, y),
          nx = (u / W) * 2 - 1,
          ny = -((v / H) * 2 - 1);
        if (gcp.mode) gcpAddImage(nx, ny);
        else session.pixel = [nx, ny];
      },
    });
</script>

<div class="image-viewer">
  <div class="stage">
    <canvas bind:this={canvas} width={W} height={H} {@attach pz}></canvas>
    {#if thumb.value}
      <MiniMap
        bitmap={thumb.value}
        imgW={W}
        imgH={H}
        cx={centre[0]}
        cy={centre[1]}
        zoom={view.z}
        viewW={W}
        viewH={H}
        maxW={96}
        maxH={72}
        onpan={(x, y) => view.centerOn(x, y)}
      />
    {/if}
  </div>
  <div class="footer">
    <span class="note">zoom {view.z.toFixed(1)}×</span>
  </div>
</div>

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    gap: var(--size-sm);
  }
  .stage {
    position: relative;
  }
  canvas {
    width: 100%;
    border-radius: 0.25rem;
    border: 1px solid var(--line);
    background: #000;
    cursor: crosshair;
    display: block;
  }
</style>
