// Alignment snapping math (pure; no React/DOM). All geometry is in INCHES, like
// the rest of the layout engine. Corners, edge-midpoints, and centers all reduce
// to per-axis alignment lines: a box has three x-lines (Left, CenterX, Right) and
// three y-lines (Top, CenterY, Bottom). Snapping each axis independently to the
// other elements' lines covers every reference type at once.

import type { Geom } from "./gesture";

// A drawn alignment guide. `at` is the aligned coordinate (inches) on `axis`'s
// cross direction; `start..end` is the span on the other axis (the union extent
// of the moving box and the element it aligned to), so the line is drawn only
// across the boxes it relates.
export type Guide = { axis: "x" | "y"; at: number; start: number; end: number };

export type SnapResult = { dx: number; dy: number; guides: Guide[] };

const linesX = (b: Geom): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
const linesY = (b: Geom): number[] => [b.y, b.y + b.h / 2, b.y + b.h];

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
    // Vertical guide at x = hx.at, spanning the y-union of moving (shifted) + other.
    const start = Math.min(moving.y, hx.other.y);
    const end = Math.max(moving.y + moving.h, hx.other.y + hx.other.h);
    guides.push({ axis: "x", at: hx.at, start, end });
  }

  const hy = bestAxis(linesY(moving), others, linesY, tol);
  if (hy) {
    dy = hy.shift;
    const start = Math.min(moving.x, hy.other.x);
    const end = Math.max(moving.x + moving.w, hy.other.x + hy.other.w);
    guides.push({ axis: "y", at: hy.at, start, end });
  }

  return { dx, dy, guides };
}
