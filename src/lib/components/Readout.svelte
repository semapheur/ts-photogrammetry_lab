<script lang="ts">
  import { ground, env, dem } from "../contexts/state.svelte";
  import { ORIGIN, latLon } from "../georef";
  import { gcp } from "../contexts/state.svelte";

  const f = (n: number, d = 1) => n.toFixed(d);
  const g = $derived(ground.value);
  const N = $derived(g ? env.terrain.geoidN(g.p.x, g.p.z) : 0);
  const ll = (p: { x: number; z: number }) =>
    latLon(p.x, p.z)
      .map((v) => v.toFixed(6))
      .join(", ");
</script>

<pre class="out">{#if g}POINT  E {f(ORIGIN.E + g.p.x)}  N {f(
      ORIGIN.N - g.p.z,
    )}  H {f(g.p.y)} m
         lat,lon {ll(g.p)}
  90 %   CEP90 {f(
      g.cep,
    )} m  LEP90 {f(g.lep)} m  SEP90 {f(g.sep)} m
         sensor only: CEP90 {f(
      g.cepS,
    )}  LEP90 {f(g.lepS)}  SEP90 {f(g.sepS)} m
  DEM    spacing {f(
      dem.value.spacing,
    )} m  height error at point {f(g.demErr)} m
  VIEW   slant range {f(
      g.slant,
    )} m  off-nadir {f(g.off)}°
  RELIEF DISPLACEMENT if terrain ignored: {f(
      g.rel,
    )} m
  HEIGHTS H {f(g.p.y)} + N {f(N)} = h {f(
      g.p.y + N,
    )} m
  pose basis: {gcp.result ? "adjusted to GCPs" : "navigation prior"}
  {:else}Capture an image, then click a pixel.{/if}</pre>
