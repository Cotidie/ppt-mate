// Shared geometry engine: slide + theme -> positioned elements (inches).
// Imported by BOTH the React preview and the PPTX exporter. No DOM, no Node deps.

import type { Slide } from "../model/deck";
import type { Theme } from "../theme/theme";
import type { Element } from "./element";
import { resolveCover } from "./families/cover";
import { resolveBody } from "./families/body";
import { resolveComparison } from "./families/comparison";
import { resolveTable } from "./families/table";
import { resolveClosing } from "./families/closing";

export type { Element } from "./element";

// Smallest an element may be shrunk to via a resize drag (inches), so a handle
// can't collapse or invert a box. Shared with the preview's live-resize clamp.
export const MIN_IN = 0.3;

export function resolveSlide(slide: Slide, theme: Theme, footerText: string): Element[] {
  const els = resolveByLayout(slide, theme, footerText);
  const overrides = slide.overrides;
  if (!overrides) return els;
  // Apply user geometry overrides (inches) once, here, so the preview and the
  // PPTX exporter (both call resolveSlide) honor moves and resizes identically.
  return els.map((el) => {
    const o = overrides[el.key];
    if (!o) return el;
    return {
      ...el,
      x: el.x + (o.dx ?? 0),
      y: el.y + (o.dy ?? 0),
      w: Math.max(MIN_IN, el.w + (o.dw ?? 0)),
      h: Math.max(MIN_IN, el.h + (o.dh ?? 0)),
    };
  });
}

function resolveByLayout(slide: Slide, theme: Theme, footerText: string): Element[] {
  switch (slide.layout) {
    case "cover":
      return resolveCover(slide, theme, footerText);
    case "body":
      return resolveBody(slide, theme, footerText);
    case "comparison":
      return resolveComparison(slide, theme, footerText);
    case "table":
      return resolveTable(slide, theme, footerText);
    case "closing":
      return resolveClosing(slide, theme, footerText);
  }
}
