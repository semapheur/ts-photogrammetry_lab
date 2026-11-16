<script lang="ts">
  import { env, params, regenerate } from "../contexts/state.svelte";
  import { Cover } from "../generate";
  import Button from "./Button.svelte";

  let seedIn = $state(params.seed);
  /** Land-cover shares (%) and ground-truth feature counts of the current terrain. */
  const stats = $derived.by(() => {
    const t = env.terrain,
      share = new Array(6).fill(0),
      count = { building: 0, tree: 0, bridge: 0 };
    for (const v of t.cover) share[v]++;
    for (const f of t.features) count[f.kind]++;
    const pct = (...ids: number[]) =>
      Math.round(
        (ids.reduce((s, i) => s + share[i], 0) * 100) / t.cover.length,
      );
    return {
      water: pct(Cover.Water),
      forest: pct(Cover.Forest),
      urban: pct(Cover.Urban, Cover.Road),
      rock: pct(Cover.Rock),
      ...count,
    };
  });
</script>

<section>
  <h2>Terrain</h2>
  <div>
    <input type="number" bind:value={seedIn} aria-label="Seed" />
    <Button onclick={() => regenerate(seedIn)}>Generate</Button>
    <Button
      onclick={() => {
        seedIn = Math.floor(Math.random() * 1e5);
        regenerate(seedIn);
      }}>Random</Button
    >
  </div>
  <pre
    class="out">Water {stats.water}%  Forest {stats.forest}%  Urban/road {stats.urban}%  Rock {stats.rock}%
  {stats.building} buildings · {stats.tree} trees · {stats.bridge} bridges (ground truth)</pre>
</section>

<style>
  input {
    appearance: none;
    padding: var(--size-md);
    color: var(--ink);
    background-color: var(--well);
    border: 1px solid var(--line);
    border-radius: var(--size-sm);
  }
</style>
