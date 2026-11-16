<script lang="ts">
  import Select from "./Select.svelte";
  import { demModels, demResolutions } from "../types";
  import { params } from "../contexts/state.svelte";
  import DiscreteSlider from "./DiscreteSlider.svelte";
</script>

<section>
  <h2>Digital elevation model</h2>
  <div class="inputs">
    <Select
      bind:value={params.demModel}
      label="Model type"
      options={demModels}
    />
    <DiscreteSlider
      label="Spacing"
      values={demResolutions}
      bind:value={params.demRes}
    />
  </div>
</section>

<style>
  .inputs {
    display: flex;
    flex-direction: column;
    gap: var(--size-xs);
  }
</style>
