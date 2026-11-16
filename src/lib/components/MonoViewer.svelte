<script lang="ts">
  import ImageViewer from "./ImageViewer.svelte";
  import {
    gcp,
    session,
    gcpReproject,
    gcpClear,
  } from "../contexts/state.svelte";
  import Tooltip from "./Tooltip.svelte";
  import MapViewer from "./MapViewer.svelte";
  import Readout from "./Readout.svelte";
  import Button from "./Button.svelte";
  import OrthoViewer from "./OrthoViewer.svelte";

  interface Props {
    captureImage: () => void;
    renderMap: (
      cx: number,
      cz: number,
      size: number,
      px: number,
      rot?: number,
    ) => HTMLCanvasElement;
  }

  let { captureImage, renderMap }: Props = $props();

  const status = $derived(
    !session.hasFrame
      ? "Capture an image first."
      : !gcp.mode
        ? `${gcp.list.length} reference point(s). Enter GCP mode to add more.`
        : gcp.pending
          ? "Now click the same feature on the map. Orange x = where the image currently projects it; dashed circle = its 90 % uncertainty."
          : `Point ${gcp.list.length + 1}: click a recognisable feature on the image.`,
  );

  const n = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
  const report = $derived.by(() => {
    const r = gcp.result;
    if (!r)
      return gcp.list.length
        ? `${gcp.list.length} point(s) set. At least 3 are needed to reproject.`
        : "";
    const row = (l: string, a: number, b: number) =>
      `${l.padEnd(12)}${n(a).padStart(8)}${n(b).padStart(8)} m`;
    return [
      `Fit residual ${n(r.rms0)} px → ${n(r.rms1)} px  (${gcp.list.length} points)`,
      `Pose change  ΔE ${n(r.dPos[0])}  ΔN ${n(r.dPos[1])}  ΔU ${n(r.dPos[2])} m`,
      `             roll ${n(r.dAtt[0], 2)}°  pitch ${n(r.dAtt[1], 2)}°  yaw ${n(r.dAtt[2], 2)}°`,
      "",
      "GROUND ERROR over the image (200 check pixels vs truth)",
      `${"".padEnd(12)}${"before".padStart(8)}${"after".padStart(8)}`,
      row("RMSE horiz", r.before.rmse, r.after.rmse),
      row("CEP90", r.before.cep90, r.after.cep90),
      row("LEP90", r.before.lep90, r.after.lep90),
      "",
      "GCP  your click  before   after  (horizontal error, m)",
      ...r.rows.map(
        (q, i) =>
          `${String(i + 1).padStart(3)}${n(q.click).padStart(11)}${n(q.before).padStart(9)}${n(q.after).padStart(8)}`,
      ),
    ].join("\n");
  });
</script>

<div class="mono-viewer">
  <header>
    <Button onclick={captureImage}>Capture image</Button>
    <Button
      disabled={!session.hasFrame}
      onclick={() => {
        gcp.mode = !gcp.mode;
        gcp.pending = null;
      }}>{gcp.mode ? "Exit GCP mode" : "Set reference points"}</Button
    >
    <Button disabled={gcp.list.length < 3} onclick={gcpReproject}
      >Reproject</Button
    >
    <Button disabled={!gcp.list.length && !gcp.result} onclick={gcpClear}
      >Clear</Button
    >
  </header>
  <div class="viewer-grid">
    <div class="view-card">
      <div class="card-header">
        <span class="card-title">Image</span>
        <Tooltip align="end">
          Scroll to zoom · drag to pan · double-click to reset. Click a pixel:
          the orange circle is the 90 % horizontal error (CEP90) of its ground
          position; the dashed grey circle is the sensor-only part.
        </Tooltip>
      </div>
      <ImageViewer />
    </div>
    <div class="view-card">
      <div class="card-header">
        <span class="card-title">Orthorectified map</span>
        <Tooltip align="end">
          Scroll to zoom · drag to pan · double-click to reset the view. Dashed
          outline: blue = original footprint, green = corrected.
        </Tooltip>
      </div>
      <MapViewer {renderMap} />
    </div>
  </div>

  <div class="panel">
    <h2>Ground control points</h2>
    <p class="note">{status}</p>
    <pre class="out">{report}</pre>
  </div>

  <div class="panel">
    <div class="panel-header">
      <h2>Coordinate mensuration</h2>
      <Tooltip align="start">
        Orange = total (sensor + DEM), grey = sensor only. Errors are propagated
        by Monte Carlo: perturbed rays hit the true terrain, the estimate hits
        the DEM. A coarser DEM adds elevation error, which shifts the ground
        position by about error × tan(look angle).
      </Tooltip>
    </div>
    <Readout />
  </div>

  <h2>Orthorectification</h2>
  <OrthoViewer {renderMap} />
</div>

<style>
  .mono-viewer {
    display: flex;
    flex-direction: column;
    gap: var(--size-sm);
  }
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

  .view-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .card-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
  }

  .panel-header {
    display: flex;
    gap: var(--size-sm);
  }
</style>
