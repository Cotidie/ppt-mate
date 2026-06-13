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
export type UiContext = {
  activeSlideId?: string;
  selection?: string[];
  render?: Record<string, RenderFact>;
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
