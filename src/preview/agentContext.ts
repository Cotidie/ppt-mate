// Reports live UI state to the dev server (POST /api/context) so the in-app agent
// knows what the user is looking at: the active slide, the current selection, and
// measured render facts (overflow / off-canvas). Fire-and-forget and debounced -
// the server just holds the latest snapshot, stitched into each chat turn.
//
// Partials merge: callers report only the field(s) that changed; pending partials
// within the debounce window coalesce into one POST.
//
// This module is the single writer of agent context, so it also keeps a client
// mirror (`current`) + a subscribe hook. The UI indicator reads that mirror to
// show exactly what the agent is aware of - no extra fetch needed.

import { useSyncExternalStore } from "react";

export type RenderFact = { overflowLines?: number; overflowInches?: number; offCanvas?: boolean };
// A text sub-selection the user made for Claude: the exact substring, the element
// it lives in, the deck field path (when known), and char offsets within that
// element's plain text.
export type TextSel = {
  elementKey: string;
  path?: string;
  text: string;
  start?: number;
  end?: number;
};
export type Rect = { x: number; y: number; w: number; h: number };
// Where a visual selection sits on the slide, in the units the layout engine and
// deck.json already use (inches, top-left origin, fixed 13.333x7.5in canvas), so
// the agent can act on the position directly - even when the cropped pixels are
// blank. Rides the chat turn alongside the crop; not part of /api/context.
export type VisualRegion = {
  unit: "in";
  canvas: { w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
  center: { x: number; y: number };
  zone: string; // 3x3 grid label from the center, e.g. "top-left", "center"
};
export type UiContext = {
  activeSlideId?: string;
  selection?: string[];
  selectedText?: TextSel | null;
  render?: Record<string, RenderFact>;
  // Visual Selection: metadata of a captured region crop pending on the next chat
  // turn (the PNG itself is held in `pendingVisual`, never POSTed).
  visual?: { rect: Rect; capturedAt: number } | null;
};
export type UiContextPatch = UiContext;

const DEBOUNCE_MS = 150;
let pending: UiContextPatch = {};
let timer: ReturnType<typeof setTimeout> | null = null;

// Client mirror of the merged context (the same data POSTed to the server) and
// its subscribers. `current` is replaced with a new object on every change so
// useSyncExternalStore sees a stable reference between unchanged renders.
let current: UiContext = {};
const listeners = new Set<() => void>();

export function reportContext(patch: UiContextPatch): void {
  Object.assign(pending, patch);
  current = { ...current, ...patch };
  listeners.forEach((fn) => fn());
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Live snapshot of what the agent currently knows.
export function useAgentContext(): UiContext {
  return useSyncExternalStore(subscribe, () => current);
}

// The captured region crop awaiting the next chat turn. Held only on the client
// (the base64 PNG is large and rides the chat POST, NOT /api/context). The chip
// metadata is mirrored into `current.visual` so the indicator can react.
let pendingVisual: { dataUrl: string; rect: Rect; region: VisualRegion } | null = null;

export function setPendingVisual(v: { dataUrl: string; rect: Rect; region: VisualRegion }): void {
  pendingVisual = v;
  current = { ...current, visual: { rect: v.rect, capturedAt: Date.now() } };
  listeners.forEach((fn) => fn());
}
export function clearPendingVisual(): void {
  if (!pendingVisual && !current.visual) return;
  pendingVisual = null;
  current = { ...current, visual: null };
  listeners.forEach((fn) => fn());
}
export function getPendingVisual(): { dataUrl: string; rect: Rect; region: VisualRegion } | null {
  return pendingVisual;
}

// On-demand full-slide capture, registered by the active SlideCanvas. The server
// calls it (via a `render-request` SSE event mid-turn) so the agent can render and
// SEE the slide it is viewing. Returns a PNG dataURL, or null if nothing is
// mounted to capture. Client-only, like pendingVisual.
let slideCapturer: (() => Promise<string | null>) | null = null;

export function setSlideCapturer(fn: (() => Promise<string | null>) | null): void {
  slideCapturer = fn;
}
export function getSlideCapturer(): (() => Promise<string | null>) | null {
  return slideCapturer;
}

function flush(): void {
  const body = pending;
  pending = {};
  timer = null;
  fetch("/api/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
