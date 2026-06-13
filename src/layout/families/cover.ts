import type { Theme } from "../../theme/theme";
import { ptToIn } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, footer, spansToRuns } from "../shared";

type Cover = Extract<import("../../model/deck").Slide, { layout: "cover" }>;

export function resolveCover(s: Cover, t: Theme, footerText: string): Element[] {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const els: Element[] = [];
  let y = t.margin.top + 0.5;

  if (s.kicker) {
    els.push({
      kind: "text",
      key: "kicker",
      x,
      y,
      w,
      h: ptToIn(t.type.kicker) * 1.4,
      paragraphs: [{ runs: spansToRuns(s.kicker), source: "kicker" }],
      font: t.fonts.body,
      size: t.type.kicker,
      color: t.colors.brandBright,
      align: "left",
      valign: "top",
    });
    y += ptToIn(t.type.kicker) * 2.0;
  }

  const titleW = w * 0.66;
  const titleH = ptToIn(t.type.coverTitle) * 5 * 1.12;
  els.push({
    kind: "text",
    key: "title",
    x,
    y,
    w: titleW,
    h: titleH,
    paragraphs: [{ runs: spansToRuns(s.title), bold: true, source: "title" }],
    font: t.fonts.title,
    size: t.type.coverTitle,
    color: t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: t.type.coverTitle * 1.12,
  });
  y += titleH + 0.1;

  if (s.citation) {
    const h = 0.6;
    els.push({
      kind: "text",
      key: "citation",
      x,
      y,
      w: w * 0.62,
      h,
      paragraphs: [{ runs: spansToRuns(s.citation), source: "citation" }],
      font: t.fonts.body,
      size: t.type.caption,
      color: t.colors.textSecondary,
      align: "left",
      valign: "top",
    });
    y += h + 0.15;
  }

  if (s.authors?.length) {
    els.push({
      kind: "text",
      key: "authors",
      x,
      y,
      w: w * 0.62,
      h: 1.6,
      paragraphs: s.authors.map((a) => ({
        runs: spansToRuns(a),
        spaceAfterPt: 4,
      })),
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.textSecondary,
      align: "left",
      valign: "top",
      lineHeightPt: t.type.body * 1.5,
      // Each author is a line in one editable list (path = the authors array).
      list: { path: "authors", item: "lines" },
    });
  }

  els.push(footer(t, footerText));
  return els;
}
