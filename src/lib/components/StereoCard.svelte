<script lang="ts">
  import MiniMap from "./MiniMap.svelte";
  import type { Attachment } from "svelte/attachments";

  let {
    title,
    canvas = $bindable(),
    width,
    height,
    borderColor,
    attach,
    thumb,
    cx,
    cy,
    zoom,
    onpan,
  }: {
    title: string;
    canvas: HTMLCanvasElement | undefined;
    width: number;
    height: number;
    borderColor: string;
    attach: Attachment<HTMLCanvasElement>;
    thumb: ImageBitmap | undefined;
    cx: number;
    cy: number;
    zoom: number;
    onpan: (x: number, y: number) => void;
  } = $props();
</script>

<div class="view-card">
  <span class="card-title">{title}</span>
  <div class="stage">
    <canvas
      bind:this={canvas}
      class="stereo-canvas"
      {width}
      {height}
      style:border={`2px solid ${borderColor}`}
      {@attach attach}
    ></canvas>
    {#if thumb}
      <MiniMap
        bitmap={thumb}
        imgW={width}
        imgH={height}
        {cx}
        {cy}
        {zoom}
        viewW={width}
        viewH={height}
        maxW={96}
        maxH={72}
        {onpan}
      />
    {/if}
  </div>
</div>

<style>
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
  .stage {
    position: relative;
  }
  canvas {
    width: 100%;
    border-radius: var(--size-sm);
    background: #000;
    display: block;
    cursor: crosshair;
  }
</style>
