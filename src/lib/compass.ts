import { Vector3 } from "three";

/**
 * Shared north-compass drawing.
 *
 * White circular ring with an integrated, filled triangular pointer.
 * The pointer rotates around the compass centre according to `th`.
 * Includes a dark outline/glow for visibility on any background.
 */
export function strokeCompass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  th: number,
) {
  if (![cx, cy, r, th].every(Number.isFinite)) return;

  const k = r / 22;

  const tip = r * 1.6;
  const half = 0.42; // Angular half-width of pointer base
  const innerR = r - 2.5 * k;

  // Points where the pointer meets the circle.
  const ax = cx + r * Math.cos(th + half);
  const ay = cy + r * Math.sin(th + half);

  const bx = cx + r * Math.cos(th - half);
  const by = cy + r * Math.sin(th - half);

  // Pointer tip.
  const tx = cx + tip * Math.cos(th);
  const ty = cy + tip * Math.sin(th);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Fill the triangular pointer.
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(tx, ty);
  ctx.lineTo(bx, by);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(ax, ay, tx, ty);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#bdbdbd");

  ctx.fillStyle = gradient;
  ctx.fill();

  // 2. Integrated outer contour. One continuous path: circle + triangular tip.
  ctx.beginPath();

  ctx.arc(cx, cy, r, th + half, th - half + Math.PI * 2);

  ctx.lineTo(tx, ty);
  ctx.closePath();

  // Dark outer glow / outline.
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8 * k;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = 7 * k;
  ctx.stroke();

  // White contour.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.5 * k;
  ctx.stroke();

  // Inner circular edge.
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);

  ctx.shadowColor = "#000";
  ctx.shadowBlur = 5 * k;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = 5 * k;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.5 * k;
  ctx.stroke();

  ctx.restore();
}

/** Large white "N" with a dark outline. */
export function compassLetter(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save();

  ctx.font = `bold ${size}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText("N", cx, cy + size * 0.04);

  ctx.fillStyle = "#fff";
  ctx.fillText("N", cx, cy + size * 0.04);

  ctx.restore();
}
