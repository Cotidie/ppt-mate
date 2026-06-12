import type { Theme } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, header, footer, bulletsElement, noteBand } from "../shared";

type Body = Extract<import("../../model/deck").Slide, { layout: "body" }>;

// Header (kicker+title) + bullet list in the content zone + optional bottom note band.
export function resolveBody(s: Body, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const noteH = s.note ? 1.0 : 0;
  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - noteH;

  els.push(
    bulletsElement(s.bullets, t, {
      x,
      y: contentTop + 0.1,
      w,
      h: bottomLimit - (contentTop + 0.1),
    })
  );

  if (s.note) els.push(...noteBand(t, s.note));
  els.push(footer(t, footerText));
  return els;
}
