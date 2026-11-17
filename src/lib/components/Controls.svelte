<script lang="ts">
  import { params, renavigate } from "../contexts/state.svelte";
  import { uncertainty } from "../errors";
  import {
    type NumKey,
    type Params,
    type ImageryMode,
    uncertaintyModes,
    type GroupKey,
  } from "../types";
  import Select from "./Select.svelte";
  import Tooltip from "./Tooltip.svelte";
  import TerrainPanel from "./TerrainPanel.svelte";
  import DemPanel from "./DemPanel.svelte";

  interface Bounds {
    label: string;
    min: number;
    max: number;
    step: number;
  }

  type Row = Bounds &
    (
      | { key: NumKey }
      | {
          [G in GroupKey]: { group: G; key: keyof Params[G] & string };
        }[GroupKey]
    );

  type BoolKey = {
    [K in keyof Params]: Params[K] extends boolean ? K : never;
  }[keyof Params];

  interface Section {
    title: string;
    note: string;
    rows: Row[];
    mode?: ImageryMode;
  }

  const sections: Section[] = [
    {
      title: "Flight",
      note: "Footprint width ≈ 2·altitude·tan(FOV/2).",
      rows: [
        {
          group: "platformPosition",
          key: "altitude",
          label: "Altitude (m)",
          min: 200,
          max: 1000,
          step: 10,
        },
        {
          group: "platformPosition",
          key: "x",
          label: "Position E (m)",
          min: -300,
          max: 300,
          step: 10,
        },
        {
          group: "platformPosition",
          key: "z",
          label: "Position N (m)",
          min: -300,
          max: 300,
          step: 10,
        },
      ],
    },
    {
      title: "Look direction",
      note: "Look angle is measured from nadir (0° = straight down); azimuth is clockwise from north. Oblique views have longer slant range, so attitude errors and relief displacement grow.",
      rows: [
        { key: "lookAzimuth", label: "Azimuth (°)", min: 0, max: 360, step: 5 },
        { key: "lookAngle", label: "Look angle (°)", min: 0, max: 65, step: 1 },
      ],
    },
    {
      title: "Platform position error (90 %)",
      note: "Navigation error of the sensor position along each axis at 90 % confidence. The error ellipsoid in the 3D view has these semi-axes.",
      rows: [
        {
          group: "positionError",
          key: "east",
          label: "East (m)",
          min: 0,
          max: 50,
          step: 1,
        },
        {
          group: "positionError",
          key: "north",
          label: "North (m)",
          min: 0,
          max: 50,
          step: 1,
        },
        {
          group: "positionError",
          key: "up",
          label: "Up (m)",
          min: 0,
          max: 50,
          step: 1,
        },
      ],
    },
    {
      title: "Attitude error (1σ, °)",
      note: "An angle θ at slant range ρ shifts the ground by ≈ ρ·θ.",
      rows: [
        {
          group: "attitudeError",
          key: "roll",
          label: "Roll",
          min: 0,
          max: 3,
          step: 0.1,
        },
        {
          group: "attitudeError",
          key: "pitch",
          label: "Pitch",
          min: 0,
          max: 3,
          step: 0.1,
        },
        {
          group: "attitudeError",
          key: "yaw",
          label: "Yaw",
          min: 0,
          max: 3,
          step: 0.1,
        },
      ],
    },
    {
      title: "Geodesy",
      note: "Ellipsoid height h = orthometric height H + geoid separation N.",
      rows: [
        {
          key: "geoidExag",
          label: "Geoid exaggeration",
          min: 1,
          max: 20,
          step: 1,
        },
      ],
    },
    {
      title: "Stereo pair",
      mode: "stereo",
      note: "The second exposure is taken one baseline further along the look azimuth. Error correlation is the share of the position/attitude error common to both exposures; matching error is how precisely the same feature is placed in both images.",
      rows: [
        { key: "baseline", label: "Baseline (m)", min: 20, max: 300, step: 10 },
        {
          key: "stereoCorr",
          label: "Error correlation",
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: "matchPx",
          label: "Matching error (px)",
          min: 0,
          max: 5,
          step: 0.25,
        },
      ],
    },
  ];
  const visible = $derived(
    sections.filter((s) => !s.mode || s.mode === params.imageryMode),
  );

  const rowId = (r: Row) => ("group" in r ? `${r.group}.${r.key}` : r.key);
  const read = (r: Row): number =>
    "group" in r
      ? (params[r.group] as Record<string, number>)[r.key]
      : params[r.key];
  const write = (r: Row, v: number) => {
    if ("group" in r) {
      (params[r.group] as Record<string, number>)[r.key] = v;
      if (r.group === "positionError" || r.group === "attitudeError")
        renavigate();
    } else params[r.key] = v;
  };

  /** Frustum layers offered in each imagery mode. */
  const frusta: Record<ImageryMode, { key: BoolKey; label: string }[]> = {
    mono: [
      { key: "showLive", label: "Current (flight path)" },
      { key: "showFrame", label: "Captured image" },
      { key: "showCorr", label: "Corrected (after GCPs)" },
    ],
    stereo: [
      { key: "showLive", label: "Current pair (preview)" },
      { key: "showStereo", label: "Captured pair" },
    ],
  };
  const surfaces: { key: BoolKey; label: string }[] = [
    { key: "showTerrain", label: "Terrain" },
    { key: "showGeo", label: "Geoid / ellipsoid" },
    { key: "showDem", label: "DEM mesh" },
  ];

  const platform = $derived(uncertainty(params.positionError));
</script>

{#snippet check(key: BoolKey, label: string)}
  <label><input type="checkbox" bind:checked={params[key]} /> {label}</label>
{/snippet}

{#snippet sliderRow(r: Row)}
  <div class="row">
    <label for={rowId(r)}>{r.label}</label>
    <input
      id={rowId(r)}
      type="range"
      min={r.min}
      max={r.max}
      step={r.step}
      bind:value={() => read(r), (v) => write(r, v)}
    />
    <output>{read(r)}</output>
  </div>
{/snippet}

<div class="controls">
  {#each visible as sec (sec.title)}
    <div class="panel">
      <div class="header">
        <h2>{sec.title}</h2>
        <Tooltip align="end">{sec.note}</Tooltip>
      </div>
      <div class="sliders">
        {#each sec.rows as r (rowId(r))}
          {@render sliderRow(r)}
        {/each}
      </div>
    </div>
  {/each}

  <DemPanel />

  <Select
    bind:value={params.umode}
    label="Uncertainty"
    options={uncertaintyModes}
  />

  <div class="check-group">
    {#each surfaces as s (s.key)}{@render check(s.key, s.label)}{/each}
  </div>

  <h2>Frustums</h2>
  <div class="check-group">
    {#each frusta[params.imageryMode] as f (f.key)}{@render check(
        f.key,
        f.label,
      )}{/each}
  </div>
  <pre class="out">Platform SEP90 ≈ {platform.sep.toFixed(1)} m</pre>

  <TerrainPanel />
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--size-sm);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sliders {
    display: flex;
    flex-direction: column;
    gap: var(--size-xs);
  }
  .row {
    display: grid;
    grid-template-columns: 10rem 1fr 2rem;
    align-items: center;
    gap: 0;
  }
  .row output {
    text-align: right;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  label {
    font-size: var(--text-sm);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--ink);
  }
  .check-group {
    display: flex;
    gap: var(--size-xs);
    flex-wrap: wrap;
  }
</style>
