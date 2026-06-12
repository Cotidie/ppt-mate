import type { Theme } from "../../theme/theme";
import { ptToIn } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, footer } from "../shared";

type Closing = Extract<import("../../model/deck").Slide, { layout: "closing" }>;

// Centered headline in brand blue, gray subtitle, short green accent rule.
export function resolveClosing(s: Closing, t: Theme, footerText: string): Element[] {
  const els: Element[] = [];
  const w = CANVAS.w - t.margin.x * 2;
  const x = t.margin.x;

  const titleH = ptToIn(t.type.closingTitle) * 1.4;
  const cy = CANVAS.h / 2 - titleH / 2 - 0.3;

  els.push({
    kind: "text",
    x,
    y: cy,
    w,
    h: titleH,
    paragraphs: [{ runs: [{ text: s.title, bold: true }], source: "title" }],
    font: t.fonts.title,
    size: t.type.closingTitle,
    color: t.colors.brand,
    align: "center",
    valign: "middle",
  });

  let y = cy + titleH + 0.1;
  if (s.subtitle) {
    const h = 0.5;
    els.push({
      kind: "text",
      x,
      y,
      w,
      h,
      paragraphs: [{ runs: [{ text: s.subtitle }], source: "subtitle" }],
      font: t.fonts.body,
      size: t.type.body + 1,
      color: t.colors.textSecondary,
      align: "center",
      valign: "top",
    });
    y += h + 0.15;
  }

  // short centered green accent rule (rendered as a thin rect)
  const ruleW = 1.2;
  els.push({
    kind: "rect",
    x: CANVAS.w / 2 - ruleW / 2,
    y,
    w: ruleW,
    h: 0.05,
    fill: t.colors.green,
    radius: 0.025,
  });

  els.push(footer(t, footerText));
  return els;
}
