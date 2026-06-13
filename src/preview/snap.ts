// Alignment snapping math (pure; no React/DOM). All geometry is in INCHES, like
// the rest of the layout engine. Corners, edge-midpoints, and centers all reduce
// to per-axis alignment lines: a box has three x-lines (Left, CenterX, Right) and
// three y-lines (Top, CenterY, Bottom). Snapping each axis independently to the
// other elements' lines covers every reference type at once.

import { MIN_IN, type Geom } from "./gesture";

// A drawn alignment guide. `at` is the aligned coordinate (inches) on `axis`'s
// cross direction; `start..end` is the span on the other axis (the union extent
// of the moving box and the element it aligned to), so the line is drawn only
// across the boxes it relates.
export type Guide = { axis: "x" | "y"; at: number; start: number; end: number };

export type SnapResult = { dx: number; dy: number; guides: Guide[] };

const linesX = (b: Geom): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
const linesY = (b: Geom): number[] => [b.y, b.y + b.h / 2, b.y + b.h];

// Guide spanning the union extent of two boxes on the axis perpendicular to the
// line, so it is drawn only across the elements it relates.
const guideX = (at: number, a: Geom, b: Geom): Guide => ({
  axis: "x",
  at,
  start: Math.min(a.y, b.y),
  end: Math.max(a.y + a.h, b.y + b.h),
});
const guideY = (at: number, a: Geom, b: Geom): Guide => ({
  axis: "y",
  at,
  start: Math.min(a.x, b.x),
  end: Math.max(a.x + a.w, b.x + b.w),
});

// The static line nearest a single moving coordinate within tol (used by resize,
// where only one edge moves per axis).
function nearestLine(coord: number, others: Geom[], linesOf: (b: Geom) => number[], tol: number): { at: number; other: Geom } | null {
  let best: { at: number; other: Geom; d: number } | null = null;
  for (const other of others) {
    for (const ol of linesOf(other)) {
      const d = Math.abs(ol - coord);
      if (d <= tol && (!best || d < best.d)) best = { at: ol, other, d };
    }
  }
  return best;
}

// Best alignment on one axis: the static line nearest a moving line within tol.
type Hit = { shift: number; at: number; other: Geom };
function bestAxis(movingLines: number[], others: Geom[], linesOf: (b: Geom) => number[], tol: number): Hit | null {
  let best: Hit | null = null;
  for (const other of others) {
    for (const ol of linesOf(other)) {
      for (const ml of movingLines) {
        const d = ol - ml;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) {
          best = { shift: d, at: ol, other };
        }
      }
    }
  }
  return best;
}

// Snap `moving` to `others`, independently per axis. Returns the correction to
// add to the in-flight delta plus a guide per snapped axis. `tol` is in inches.
export function snapMove(moving: Geom, others: Geom[], tol: number): SnapResult {
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  const hx = bestAxis(linesX(moving), others, linesX, tol);
  if (hx) {
    dx = hx.shift;
    guides.push(guideX(hx.at, moving, hx.other));
  }

  const hy = bestAxis(linesY(moving), others, linesY, tol);
  if (hy) {
    dy = hy.shift;
    guides.push(guideY(hy.at, moving, hy.other));
  }

  return { dx, dy, guides };
}

// Snap a RESIZE: only the edge(s) the active handle drives move, so we snap that
// edge's coordinate to the others' lines and reshape the box (the opposite edge
// stays put). `dir` is the handle (n/s/e/w combos). Returns the snapped box + a
// guide per snapped axis. A snap that would shrink past MIN_IN is skipped.
export function snapResize(cand: Geom, dir: string, others: Geom[], tol: number): { box: Geom; guides: Guide[] } {
  let { x, y, w, h } = cand;
  const guides: Guide[] = [];

  if (dir.includes("e")) {
    const hit = nearestLine(x + w, others, linesX, tol); // right edge
    if (hit && hit.at - x >= MIN_IN) {
      w = hit.at - x;
      guides.push(guideX(hit.at, { x, y, w, h }, hit.other));
    }
  } else if (dir.includes("w")) {
    const right = x + w;
    const hit = nearestLine(x, others, linesX, tol); // left edge moves; right fixed
    if (hit && right - hit.at >= MIN_IN) {
      x = hit.at;
      w = right - x;
      guides.push(guideX(hit.at, { x, y, w, h }, hit.other));
    }
  }

  if (dir.includes("s")) {
    const hit = nearestLine(y + h, others, linesY, tol); // bottom edge
    if (hit && hit.at - y >= MIN_IN) {
      h = hit.at - y;
      guides.push(guideY(hit.at, { x, y, w, h }, hit.other));
    }
  } else if (dir.includes("n")) {
    const bottom = y + h;
    const hit = nearestLine(y, others, linesY, tol); // top edge moves; bottom fixed
    if (hit && bottom - hit.at >= MIN_IN) {
      y = hit.at;
      h = bottom - y;
      guides.push(guideY(hit.at, { x, y, w, h }, hit.other));
    }
  }

  return { box: { x, y, w, h }, guides };
}
