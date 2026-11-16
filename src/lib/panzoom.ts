export interface PanZoomHandlers {
  wheel(x: number, y: number, factor: number): void; // zoom about the cursor; factor > 1 zooms in
  drag(dx: number, dy: number): void; // pan by canvas pixels
  click(x: number, y: number): void; // a press that barely moved
  reset(): void; // double-click
  rotate?(delta: number): void;
}

/**
 * Shared canvas interaction. All coordinates are in canvas pixels (not CSS pixels). Returns a cleanup function.
 * Drag pans, Shift + drag rotates (if `rotate` is given), double-click resets, and Alt + wheel zooms about the cursor. A plain wheel is left alone so the page
 * (e.g. a scrolling sidebar) keeps scrolling over the canvas.
 */
export function panzoom(el: HTMLCanvasElement, h: PanZoomHandlers) {
  let down: {
      x: number;
      y: number;
      moved: boolean;
      rotate: boolean;
      angle: number;
    } | null = null,
    dragged = false,
    ax = 0,
    ay = 0,
    ar = 0,
    raf = 0;
  /** The canvas content box in CSS px: the bounding box minus any CSS border. */
  const box = () => {
    const r = el.getBoundingClientRect(),
      cs = getComputedStyle(el);
    const l = parseFloat(cs.borderLeftWidth) || 0,
      t = parseFloat(cs.borderTopWidth) || 0;
    return {
      left: r.left + l,
      top: r.top + t,
      w: r.width - l - (parseFloat(cs.borderRightWidth) || 0),
      h: r.height - t - (parseFloat(cs.borderBottomWidth) || 0),
    };
  };
  const pos = (e: MouseEvent) => {
    const b = box();
    return [
      ((e.clientX - b.left) * el.width) / b.w,
      ((e.clientY - b.top) * el.height) / b.h,
    ] as const;
  };
  const angleOf = (e: MouseEvent) => {
    const [x, y] = pos(e);
    return Math.atan2(y - el.height / 2, x - el.width / 2);
  }; // clockwise on screen (y is down)
  const flush = () => {
    raf = 0;
    if (ax || ay) h.drag(ax, ay);
    if (ar) h.rotate?.(ar);
    ax = ay = ar = 0;
  }; // coalesce to one update per frame
  const pd = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragged = false;
    down = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      rotate: !!h.rotate && e.shiftKey,
      angle: angleOf(e),
    };
    el.setPointerCapture(e.pointerId);
  };
  const pm = (e: PointerEvent) => {
    if (
      !down ||
      (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4)
    )
      return;
    down.moved = dragged = true;
    if (down.rotate) {
      const a = angleOf(e);
      let d = a - down.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      ar += d;
      down.angle = a;
    } else {
      const b = box();
      ax += ((e.clientX - down.x) * el.width) / b.w;
      ay += ((e.clientY - down.y) * el.height) / b.h;
      down.x = e.clientX;
      down.y = e.clientY;
    }
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const pu = () => {
    down = null;
  };
  const click = (e: MouseEvent) => {
    if (dragged || e.detail > 1) {
      dragged = false;
      return;
    }
    const [x, y] = pos(e);
    h.click(x, y);
  };
  const wheel = (e: WheelEvent) => {
    if (!e.altKey) return; // no preventDefault: the page scrolls
    e.preventDefault();
    const [x, y] = pos(e),
      d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX; // some systems swap the axis with Alt
    h.wheel(x, y, Math.exp(-d * 0.0015));
  };
  const dbl = () => h.reset();
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", pd);
  el.addEventListener("pointermove", pm);
  el.addEventListener("pointerup", pu);
  el.addEventListener("pointercancel", pu);
  el.addEventListener("click", click);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("dblclick", dbl);
  return () => {
    el.removeEventListener("pointerdown", pd);
    el.removeEventListener("pointermove", pm);
    el.removeEventListener("pointerup", pu);
    el.removeEventListener("pointercancel", pu);
    el.removeEventListener("click", click);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("dblclick", dbl);
    if (raf) cancelAnimationFrame(raf);
  };
}
