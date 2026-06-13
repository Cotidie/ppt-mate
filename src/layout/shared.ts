// Shared layout helpers used by every family resolver: the persistent header
// (kicker + title, top-left) and the centered footer band.

import type { Theme } from "../theme/theme";
import { ptToIn } from "../theme/theme";
import type { Element, Para, Run, TextEl } from "./element";
import type { Span, Bullet } from "../model/deck";
import { FOOTER_SOURCE } from "../model/deck";

export const CANVAS = { w: 13.333, h: 7.5 };

// Stored spans -> resolved runs. An empty field becomes one empty run so the
// renderers always have something to lay out.
export function spansToRuns(spans: Span[]): Run[] {
  if (!spans.length) return [{ text: "" }];
  return spans.map((s) => ({
    text: s.text,
    bold: s.bold,
    italic: s.italic,
    underline: s.underline,
    color: s.color,
    highlight: s.highlight,
    size: s.size,
  }));
}

// Header zone: gray kicker then bold navy title, both anchored to the left margin.
export function header(
  t: Theme,
  title: Span[],
  kicker?: Span[],
  opts?: { titleSize?: number; titleColor?: string }
): { elements: Element[]; contentTop: number } {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const els: Element[] = [];
  let y = t.margin.top;

  if (kicker) {
    els.push({
      kind: "text",
      key: "kicker",
      x,
      y,
      w,
      h: ptToIn(t.type.kicker) * 1.4,
      paragraphs: [{ runs: spansToRuns(kicker), source: "kicker" }],
      font: t.fonts.body,
      size: t.type.kicker,
      color: t.colors.kicker,
      align: "left",
      valign: "top",
    });
    y += ptToIn(t.type.kicker) * 1.6;
  }

  const titleSize = opts?.titleSize ?? t.type.title;
  const titleH = ptToIn(titleSize) * 2.2;
  els.push({
    kind: "text",
    key: "title",
    x,
    y,
    w,
    h: titleH,
    paragraphs: [{ runs: spansToRuns(title), bold: true, source: "title" }],
    font: t.fonts.title,
    size: titleSize,
    color: opts?.titleColor ?? t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: titleSize * 1.1,
  });

  return { elements: els, contentTop: y + titleH + 0.15 };
}

// Centered copyright footer (plain string; not user-editable).
export function footer(t: Theme, text: string): TextEl {
  return {
    kind: "text",
    key: "footer",
    x: t.margin.x,
    y: CANVAS.h - t.margin.bottom - t.layout.footerH,
    w: CANVAS.w - t.margin.x * 2,
    h: t.layout.footerH,
    paragraphs: [{ runs: [{ text }], source: FOOTER_SOURCE }],
    font: t.fonts.body,
    size: t.type.caption,
    color: t.colors.kicker,
    align: "center",
    valign: "bottom",
  };
}

// One text element, one paragraph per bullet, so both renderers wrap natively.
export function bulletsElement(
  bullets: Bullet[],
  t: Theme,
  box: { x: number; y: number; w: number; h: number },
  opts?: { size?: number; sourcePrefix?: string; keyName?: string }
): TextEl {
  const size = opts?.size ?? t.type.body;
  const prefix = opts?.sourcePrefix ?? "bullets";
  const paragraphs: Para[] = bullets.map((b) => ({
    runs: spansToRuns(b.runs),
    bullet: true,
    indentLevel: b.level ?? 0,
    spaceAfterPt: 6,
    align: "left",
  }));
  return {
    kind: "text",
    key: opts?.keyName ?? "bullets",
    ...box,
    paragraphs,
    font: t.fonts.body,
    size,
    color: t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: size * 1.35,
    // The whole bullet array is one editable list (path = its parent array).
    list: { path: prefix, item: "bullets" },
  };
}

// Full-width pale-blue note band with centered text.
export function noteBand(t: Theme, note: Span[]): Element[] {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const h = 0.8;
  const y = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - h;
  return [
    { kind: "rect", key: "note.rect", x, y, w, h, fill: t.colors.panel, radius: t.layout.cardRadius },
    {
      kind: "text",
      key: "note",
      x: x + 0.3,
      y,
      w: w - 0.6,
      h,
      paragraphs: [{ runs: spansToRuns(note), source: "note" }],
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.brand,
      align: "center",
      valign: "middle",
    },
  ];
}
