<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
    align?: "start" | "center" | "end";
  }

  let { children, align = "center" }: Props = $props();

  let isOpen = $state(false);
  let buttonEl: HTMLButtonElement;
  let coords = $state({ top: 0, left: 0 });

  function updatePosition() {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2;
    let top = rect.bottom + 8;

    if (align === "start") {
      left = rect.left;
    } else if (align === "end") {
      left = rect.right;
    }

    coords = { top, left };
  }

  function show() {
    isOpen = true;
    requestAnimationFrame(updatePosition);
  }

  function hide() {
    isOpen = false;
  }
</script>

<button
  bind:this={buttonEl}
  type="button"
  class="tip"
  aria-label="Information"
  onmouseenter={show}
  onmouseleave={hide}
  onfocus={show}
  onblur={hide}
>
  i
</button>

{#if isOpen}
  <div
    class={{
      bubble: true,
      "align-start": align === "start",
      "align-center": align === "center",
      "align-end": align === "end",
    }}
    style="top: {coords.top}px; left: {coords.left}px;"
    role="tooltip"
  >
    {@render children()}
  </div>
{/if}

<style>
  .tip {
    all: unset;
    position: relative;
    display: inline-grid;
    place-items: center;
    margin-inline: 0.35em;
    height: 1rem;
    width: 1rem;
    font-size: var(--text-xs);
    font-weight: var(--text-bold);
    border: 1.5px solid var(--muted);
    border-radius: 50%;
    color: var(--muted);
    cursor: help;
    vertical-align: middle;
  }
  .tip:hover,
  .tip:focus-visible {
    color: var(--ink);
    border-color: var(--ink);
  }
  .tip:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* Positioned relative to the viewport, escaping all overflow/stacking contexts */
  .bubble {
    position: fixed;
    z-index: 1;
    width: max-content;
    max-width: 16rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--edge);
    border-radius: 8px;
    background: var(--well);
    color: var(--ink);
    font-size: 0.85rem;
    font-weight: normal;
    text-align: left;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .bubble.align-center {
    transform: translateX(-50%);
  }
  .bubble.align-end {
    transform: translateX(-100%);
  }
  .bubble.align-start {
    transform: translateX(0);
  }
</style>
