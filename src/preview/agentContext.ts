// Reports live UI state to the dev server (POST /api/context) so the in-app agent
// knows what the user is looking at: the active slide, the current selection, and
// measured render facts (overflow / off-canvas). Fire-and-forget and debounced -
// the server just holds the latest snapshot, stitched into each chat turn.
//
// Partials merge: callers report only the field(s) that changed; pending partials
// within the debounce window coalesce into one POST.

export type RenderFact = { overflowLines?: number; overflowInches?: number; offCanvas?: boolean };
export type UiContextPatch = {
  activeSlideId?: string;
  selection?: string[];
  render?: Record<string, RenderFact>;
};

const DEBOUNCE_MS = 150;
let pending: UiContextPatch = {};
let timer: ReturnType<typeof setTimeout> | null = null;

export function reportContext(patch: UiContextPatch): void {
  Object.assign(pending, patch);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
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
