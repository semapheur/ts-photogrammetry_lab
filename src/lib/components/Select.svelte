<script lang="ts" generics="T = string">
  import type { HTMLSelectAttributes } from "svelte/elements";
  import type { SelectOption } from "../types";

  type OptionInput<T> = T | SelectOption<T>;

  interface Props<T> extends HTMLSelectAttributes {
    label?: string | null;
    value?: T | null;
    options: readonly OptionInput<T>[];
  }

  const uid = $props.id();
  let { label, value = $bindable(), options, ...rest }: Props<T> = $props();

  const normalizedOptions = $derived(
    options.map((o): SelectOption<T> => {
      if (typeof o === "object" && o !== null && "label" in o) {
        return o as SelectOption<T>;
      }

      if (typeof o === "string") {
        return {
          label: o,
          value: o.toLowerCase() as T,
        };
      }

      return {
        label: String(o),
        value: o as T,
      };
    }),
  );
</script>

<label for={uid}>
  {label}
  <select id={uid} bind:value {...rest}>
    {#each normalizedOptions as o}
      <option value={o.value}>{o.label}</option>
    {/each}
  </select>
</label>

<style>
  label {
    font-size: var(--text-sm);
  }

  select {
    padding: var(--size-md);
    color: var(--ink);
    background-color: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--size-sm);
  }
</style>
