<script lang="ts" generics="T">
  type Props = {
    label?: string;
    values: T[];
    value: T;
    format?: (v: T) => string | number;
  };

  let {
    label,
    values = [],
    value = $bindable(),
    format = (v: T) => String(v),
  }: Props = $props();

  const uid = $props.id();

  // Find the index matching the current bound value (default to 0 if not found)
  let currentIndex = $derived.by<number>(() => {
    const idx = values.indexOf(value);
    return idx !== -1 ? idx : 0;
  });

  function handleInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const idx = Number(target.value);
    value = values[idx];
  }
</script>

<div class="discrete-slider">
  {#if label}
    <label for={uid}>{label}</label>
  {/if}

  <input
    id={uid}
    type="range"
    min={0}
    max={Math.max(0, values.length - 1)}
    step={1}
    value={currentIndex}
    oninput={handleInput}
  />

  <output for={uid}>{format(value)}</output>
</div>

<style>
  .discrete-slider {
    display: grid;
    grid-template-columns: 10rem 1fr 2rem;
    align-items: center;
    gap: 0;
  }

  label {
    font-size: var(--text-sm);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--ink);
  }

  output {
    text-align: right;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
</style>
