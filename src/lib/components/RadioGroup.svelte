<script lang="ts">
  interface Option {
    value: string;
    label: string;
    disabled?: boolean;
  }

  let {
    options,
    value = $bindable(),
    name = "radio-group",
  }: {
    options: Option[];
    value: string;
    name?: string;
  } = $props();
</script>

<div class="radio-group">
  {#each options as o}
    <label>
      <input
        type="radio"
        {name}
        value={o.value}
        checked={value === o.value}
        disabled={o.disabled}
        onchange={() => (value = o.value)}
      />
      {o.label}
    </label>
  {/each}
</div>

<style>
  .radio-group {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  label {
    font-size: var(--text-xs);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  input[type="radio"]:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
