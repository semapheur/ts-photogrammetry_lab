import { untrack } from "svelte";

/**
 * Reactive ImageBitmap copy of a canvas, for thumbnails. Call it while a component initialises.
 * `source` runs inside an effect: read whatever reactive value should trigger a refresh (e.g. a frame counter) in it.
 */
export function bitmapOf(source: () => HTMLCanvasElement | null | undefined) {
  let value = $state<ImageBitmap | null>(null);
  $effect(() => {
    const src = source();
    let stale = false;
    if (!src) {
      untrack(() => value?.close());
      value = null;
      return;
    }
    createImageBitmap(src).then((b) => {
      if (stale) {
        b.close();
        return;
      }
      value?.close();
      value = b;
    });
    return () => {
      stale = true;
    };
  });
  return {
    get value() {
      return value;
    },
  };
}
