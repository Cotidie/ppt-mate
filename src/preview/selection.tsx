// Group selection + group move for Move mode. Lives above the per-element frames
// (SlideCanvas owns the state, ElementViews consume it via context) because a
// marquee and a group drag are inherently cross-element: the marquee tests every
// element's box, and a group move broadcasts ONE inch-delta to every member so
// their relative positions are preserved.
//
// Two gestures, both driven by window listeners (so they survive the pointer
// leaving the box):
//   - marquee: a press on empty stage rubber-bands a rectangle; on release every
//     element whose box even partially overlaps it becomes the selection.
//   - group move: a press on a selected member drags the whole set; each member
//     renders an absolute optimistic geometry HELD until deck.json (server + HMR)
//     reports it back - the same anti-flicker hold the single-element drag uses.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Element } from "../layout/element";
import {
  DRAG_THRESHOLD,
  PX_PER_IN,
  commitTransformBatch,
  nearGeom,
  type Geom,
} from "./gesture";
import { snapMove, type Guide } from "./snap";

type Box = Geom & { key: string };
type Rect = { x: number; y: number; w: number; h: number };

// Alignment-snap pull radius, constant in screen px (converted to inches via the
// live scale so it feels the same at any zoom).
const SNAP_PX = 6;

export interface SelectionApi {
  selected: ReadonlySet<string>;
  marquee: Rect | null; // stage px (unscaled), rendered inside the scaled stage
  guides: Guide[]; // active alignment guides (inches) during a snapped move
  groupGeomFor(key: string): Geom | null;
  selectOnly(key: string): void;
  clear(): void;
  beginMarquee(e: ReactPointerEvent, scale: number): void;
  beginGroupMove(e: ReactPointerEvent, scale: number): void;
  // Snap a moving box to the other elements' alignment lines; sets the guides and
  // returns the correction to add to the in-flight delta. `bypass` (Alt held)
  // skips snapping and clears guides. Used by the single-move hook and group move.
  snapMoveBox(moving: Geom, exclude: Iterable<string>, scale: number, bypass: boolean): { dx: number; dy: number };
  clearGuides(): void;
}

const NOOP: SelectionApi = {
  selected: new Set(),
  marquee: null,
  guides: [],
  groupGeomFor: () => null,
  selectOnly: () => {},
  clear: () => {},
  beginMarquee: () => {},
  beginGroupMove: () => {},
  snapMoveBox: () => ({ dx: 0, dy: 0 }),
  clearGuides: () => {},
};

export const SelectionContext = createContext<SelectionApi>(NOOP);
export const useSelection = (): SelectionApi => useContext(SelectionContext);

// Partial AABB overlap (inches); a shared edge does not count as overlap.
function overlaps(a: Box, m: Rect): boolean {
  return a.x < m.x + m.w && a.x + a.w > m.x && a.y < m.y + m.h && a.y + a.h > m.y;
}

// The selection state machine. Called by SlideCanvas with the live resolved
// elements (their boxes), the slide id (commit target + reset key) and the
// effective stage scale.
export function useSelectionState(elements: Element[], slideId: string, scale: number): SelectionApi {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  // Absolute optimistic geometry per member during/after a group move, held until
  // props catch up (mirrors the single-element gesture hold).
  const [groupOpt, setGroupOpt] = useState<Map<string, Geom> | null>(null);

  // Element boxes (inches). Refs so the window-listener closures read fresh values
  // without re-binding mid-drag.
  const boxes: Box[] = elements.map((e) => ({ key: e.key, x: e.x, y: e.y, w: e.w, h: e.h }));
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // A new slide is a fresh canvas: drop any selection / in-flight hold.
  useEffect(() => {
    setSelected(new Set());
    setGroupOpt(null);
    setMarquee(null);
    setGuides([]);
  }, [slideId]);

  // Release the group hold once deck.json (HMR) reports every member at its
  // committed spot. Runs each render (cheap; few elements) and self-stops once
  // cleared.
  useEffect(() => {
    if (!groupOpt) return;
    const caughtUp = [...groupOpt].every(([k, g]) => {
      const b = boxesRef.current.find((x) => x.key === k);
      return b != null && nearGeom(b, g);
    });
    if (caughtUp) setGroupOpt(null);
  });

  function selectOnly(key: string) {
    setSelected(new Set([key]));
  }
  function clear() {
    setSelected(new Set());
  }

  function clearGuides() {
    setGuides([]);
  }

  function snapMoveBox(moving: Geom, exclude: Iterable<string>, sc: number, bypass: boolean): { dx: number; dy: number } {
    if (bypass) {
      setGuides([]);
      return { dx: 0, dy: 0 };
    }
    const ex = new Set(exclude);
    const others = boxesRef.current.filter((b) => !ex.has(b.key));
    const tol = SNAP_PX / (PX_PER_IN * sc);
    const r = snapMove(moving, others, tol);
    setGuides(r.guides);
    return { dx: r.dx, dy: r.dy };
  }

  function beginMarquee(e: ReactPointerEvent, sc: number) {
    if (e.button !== 0) return;
    // Press point in unscaled stage px (currentTarget is the .stage element).
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startX = (e.clientX - rect.left) / sc;
    const startY = (e.clientY - rect.top) / sc;
    let moved = false;
    // A bare press (no drag) deselects.
    setSelected(new Set());

    // Every element the marquee currently covers, recomputed each move so the
    // whole set shows its selection border LIVE during the drag (not only on
    // release): marquee px -> inches, partial overlap.
    const hitsFor = (cur: Rect): string[] => {
      const m: Rect = { x: cur.x / PX_PER_IN, y: cur.y / PX_PER_IN, w: cur.w / PX_PER_IN, h: cur.h / PX_PER_IN };
      return boxesRef.current.filter((b) => overlaps(b, m)).map((b) => b.key);
    };

    const move = (ev: PointerEvent) => {
      const px = (ev.clientX - rect.left) / sc;
      const py = (ev.clientY - rect.top) / sc;
      if (!moved && Math.hypot((px - startX) * sc, (py - startY) * sc) < DRAG_THRESHOLD) return;
      moved = true;
      const cur: Rect = { x: Math.min(startX, px), y: Math.min(startY, py), w: Math.abs(px - startX), h: Math.abs(py - startY) };
      setMarquee(cur);
      setSelected(new Set(hitsFor(cur)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // The selection is already live from the last move; just drop the overlay.
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginGroupMove(e: ReactPointerEvent, sc: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const keys = [...selectedRef.current];
    const bases = keys
      .map((k) => boxesRef.current.find((b) => b.key === k))
      .filter((b): b is Box => b != null);
    // The group's bounding box is what snaps; the same delta then moves every
    // member, so relative positions are preserved.
    const union: Geom = {
      x: Math.min(...bases.map((b) => b.x)),
      y: Math.min(...bases.map((b) => b.y)),
      w: Math.max(...bases.map((b) => b.x + b.w)) - Math.min(...bases.map((b) => b.x)),
      h: Math.max(...bases.map((b) => b.y + b.h)) - Math.min(...bases.map((b) => b.y)),
    };
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let last: { dx: number; dy: number } | null = null;

    const move = (ev: PointerEvent) => {
      const mxPx = ev.clientX - startX;
      const myPx = ev.clientY - startY;
      if (!moved && Math.hypot(mxPx, myPx) < DRAG_THRESHOLD) return;
      if (!moved) {
        document.body.classList.add("gesture-active");
        document.body.style.setProperty("--gesture-cursor", "grabbing");
      }
      moved = true;
      const rawX = mxPx / (PX_PER_IN * sc);
      const rawY = myPx / (PX_PER_IN * sc);
      // Snap the moved union box to the non-member elements; add the correction.
      const cand: Geom = { x: union.x + rawX, y: union.y + rawY, w: union.w, h: union.h };
      const c = snapMoveBox(cand, keys, sc, ev.altKey);
      const dx = rawX + c.dx;
      const dy = rawY + c.dy;
      last = { dx, dy };
      const next = new Map<string, Geom>();
      // One delta for all: relative positions preserved by construction.
      for (const b of bases) next.set(b.key, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
      setGroupOpt(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("gesture-active");
      document.body.style.removeProperty("--gesture-cursor");
      setGuides([]);
      if (moved && last) {
        // Commit all members atomically (one read-modify-write -> one HMR); keep
        // the hold and let the catch-up effect release it when props match.
        void commitTransformBatch(slideId, bases.map((b) => ({ key: b.key, dx: last!.dx, dy: last!.dy })));
      } else {
        setGroupOpt(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return {
    selected,
    marquee,
    guides,
    groupGeomFor: (key) => groupOpt?.get(key) ?? null,
    selectOnly,
    clear,
    beginMarquee,
    beginGroupMove,
    snapMoveBox,
    clearGuides,
  };
}
