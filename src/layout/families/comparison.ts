import type { Theme } from "../../theme/theme";
import type { Element, Para } from "../element";
import { CANVAS, header, footer, noteBand, spansToRuns } from "../shared";

type Comparison = Extract<import("../../model/deck").Slide, { layout: "comparison" }>;

export function resolveComparison(s: Comparison, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const noteH = s.note ? 1.0 : 0;
  const top = contentTop + 0.15;
  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - noteH;
  const cardH = bottomLimit - top;

  const n = s.cards.length;
  const gap = t.layout.cardGap;
  const cardW = (w - gap * (n - 1)) / n;
  const headerH = t.layout.cardHeaderH;
  const r = t.layout.cardRadius;

  s.cards.forEach((card, i) => {
    const cx = x + i * (cardW + gap);

    els.push({ kind: "rect", key: `card.${i}.bodyRect`, x: cx, y: top, w: cardW, h: cardH, fill: t.colors.cardBody, radius: r });
    els.push({ kind: "rect", key: `card.${i}.headerRect`, x: cx, y: top, w: cardW, h: headerH, fill: t.colors.cardHeader, radius: r });
    els.push({
      kind: "text",
      key: `card.${i}.header`,
      x: cx + 0.25,
      y: top,
      w: cardW - 0.5,
      h: headerH,
      paragraphs: [{ runs: spansToRuns(card.header), bold: true, source: `cards.${i}.header` }],
      font: t.fonts.title,
      size: t.type.body + 2,
      color: t.colors.white,
      align: "left",
      valign: "middle",
    });

    const paragraphs: Para[] = card.bullets.map((b) => ({
      runs: spansToRuns(b.runs),
      bullet: true,
      indentLevel: b.level ?? 0,
      spaceAfterPt: 6,
      align: "left",
    }));
    els.push({
      kind: "text",
      key: `card.${i}.body`,
      x: cx + 0.3,
      y: top + headerH + 0.2,
      w: cardW - 0.6,
      h: cardH - headerH - 0.4,
      paragraphs,
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.textPrimary,
      align: "left",
      valign: "top",
      lineHeightPt: t.type.body * 1.35,
      // The card's bullets are one editable list (path = its parent array).
      list: { path: `cards.${i}.bullets`, item: "bullets" },
    });
  });

  if (s.note) els.push(...noteBand(t, s.note));
  els.push(footer(t, footerText));
  return els;
}
