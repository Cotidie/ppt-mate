// Geometry-gesture primitives shared by the single-element drag (Element.tsx)
// and the group selection/move controller (selection.tsx). All geometry is in
// INCHES, matching the layout engine; the preview converts to px at the edges.

import { PX_PER_IN } from "../theme/theme";
import { MIN_IN } from "../layout/resolve";

export const DRAG_THRESHOLD = 3; // px (screen space) before a press becomes a gesture
export { MIN_IN, PX_PER_IN };

export type Delta = { dx: number; dy: number; dw: number; dh: number };
export type Geom = { x: number; y: number; w: number; h: number };

export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// The cursor to pin for the whole document during a gesture, so it never reverts
// to the default arrow when the drag (driven by window listeners) is over empty
// space or the resizing edge slips out from under the pointer. null dir = a move.
const RESIZE_CURSOR: Record<Dir, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};
export const cursorFor = (dir: Dir | null) => (dir ? RESIZE_CURSOR[dir] : "grabbing");

// Translate a handle's screen drag (already in inches) into a geometry delta,
// clamped so the box never shrinks below MIN_IN (and so a min-size hit pins the
// opposite edge instead of dragging it). West/north edges move the origin.
export function dirDelta(dir: Dir, mx: number, my: number, baseW: number, baseH: number): Delta {
  let dx = 0, dy = 0, dw = 0, dh = 0;
  if (dir.includes("e")) dw = Math.max(mx, MIN_IN - baseW);
  if (dir.includes("w")) {
    const m = Math.min(mx, baseW - MIN_IN); // can't push past min width
    dw = -m;
    dx = m;
  }
  if (dir.includes("s")) dh = Math.max(my, MIN_IN - baseH);
  if (dir.includes("n")) {
    const m = Math.min(my, baseH - MIN_IN);
    dh = -m;
    dy = m;
  }
  return { dx, dy, dw, dh };
}

export const nearGeom = (a: Geom, b: Geom) =>
  Math.abs(a.x - b.x) < 1e-3 &&
  Math.abs(a.y - b.y) < 1e-3 &&
  Math.abs(a.w - b.w) < 1e-3 &&
  Math.abs(a.h - b.h) < 1e-3;

// Apply a clamped delta to a base geometry, mirroring resolveSlide's min clamp so
// the optimistic preview matches the committed result exactly.
export function applyDelta(base: Geom, d: Delta): Geom {
  return {
    x: base.x + d.dx,
    y: base.y + d.dy,
    w: Math.max(MIN_IN, base.w + d.dw),
    h: Math.max(MIN_IN, base.h + d.dh),
  };
}

// Commits an accumulated geometry delta (inches) for one element to deck.json:
// dx/dy move, dw/dh resize. The server adds it onto any prior override; HMR then
// repaints. (Route name is historical - it now carries resizes too.)
export async function commitTransform(id: string, key: string, d: Delta): Promise<void> {
  const res = await fetch("/api/slides/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, key, ...d }),
  });
  if (!res.ok) alert("Move failed. Is the dev server running?");
}

// Commits a move delta for many elements at once (group move) in one request, so
// the server does a single read-modify-write and HMR fires once. Each element's
// delta is added onto its prior override, exactly like commitTransform.
export async function commitTransformBatch(
  id: string,
  moves: { key: string; dx: number; dy: number }[]
): Promise<void> {
  const res = await fetch("/api/slides/move-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, moves }),
  });
  if (!res.ok) alert("Move failed. Is the dev server running?");
}
