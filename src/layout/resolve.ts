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

export function resolveSlide(slide: Slide, theme: Theme, footerText: string): Element[] {
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
