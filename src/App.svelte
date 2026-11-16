<script lang="ts">
  import Scene3D from "./lib/components/Scene3D.svelte";
  import Controls from "./lib/components/Controls.svelte";
  import StereoViewer from "./lib/components/StereoViewer.svelte";
  import Tooltip from "./lib/components/Tooltip.svelte";
  import SplitPanes from "./lib/components/SplitPanes.svelte";
  import Select from "./lib/components/Select.svelte";
  import { imageryModes } from "./lib/types";
  import { params } from "./lib/contexts/state.svelte";
  import MonoViewer from "./lib/components/MonoViewer.svelte";

  let scene = $state<ReturnType<typeof Scene3D>>();

  const blank = (px: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    return c;
  };
</script>

{#snippet leftPane()}
  <div class="scene">
    <Scene3D bind:this={scene} />
    <div class="hud">
      <Tooltip align="start">
        <b>Photogrammetry Lab</b><br />Orange = current frustum &amp; error
        cylinder<br />Blue = captured image · green = after GCP correction<br
        />Violet & teal = stereo pair, rays &amp; error cylinder<br />Grey =
        sensor-only error / flat-datum point<br />Drag to orbit · scroll to zoom
      </Tooltip>
    </div>
  </div>
{/snippet}

{#snippet rightPane()}
  <aside class="right-pane">
    <Select
      label="Imagery mode"
      bind:value={params.imageryMode}
      options={imageryModes}
    />
    {#if params.imageryMode === "mono"}
      <MonoViewer
        captureImage={() => scene?.capture()}
        renderMap={(cx, cz, size, px, rot) =>
          scene?.renderMap(cx, cz, size, px, rot) ?? blank(px)}
      />
    {:else}
      <h2>Stereographic parallax</h2>
      <StereoViewer capture={() => scene?.captureStereo()} />
    {/if}
  </aside>
{/snippet}

<main>
  <aside>
    <Controls />
  </aside>
  <SplitPanes panes={[leftPane, rightPane]} />
</main>

<style>
  main {
    display: grid;
    grid-template-columns: 22rem 1fr;
    height: 100%;
  }
  .scene {
    height: 100%;
    position: relative;
  }
  .hud {
    position: absolute;
    right: 1rem;
    top: 1rem;
  }
  aside {
    overflow: auto;
    background: var(--panel);
    border-left: 1px solid var(--line);
    padding: 0.5rem 1rem;
  }

  .right-pane {
    display: flex;
    flex-direction: column;
    gap: var(--size-lg);
  }
</style>
