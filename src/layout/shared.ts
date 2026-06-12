// Shared layout helpers used by every family resolver: the persistent header
// (kicker + title, top-left) and the centered footer band. Keeps zone geometry
// identical across slides per DESIGN.md flow architecture.

import type { Theme } from "../theme/theme";
import { ptToIn } from "../theme/theme";
import type { Element, Para, TextEl } from "./element";
import type { Bullet, Emphasis } from "../model/deck";

export const CANVAS = { w: 13.333, h: 7.5 };

export function emphasis(e: Emphasis | undefined, t: Theme): { color?: string; bold?: boolean } {
  switch (e) {
    case "green":
      return { color: t.colors.green, bold: true };
    case "red":
      return { color: t.colors.red, bold: true };
    case "bold":
      return { bold: true };
    default:
      return {};
  }
}

// Header zone: gray kicker then bold navy title, both anchored to the left margin.
// Returns the elements plus the y where the content zone can begin.
export function header(
  t: Theme,
  title: string,
  kicker?: string,
  opts?: { titleSize?: number; titleColor?: string }
): { elements: Element[]; contentTop: number } {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const els: Element[] = [];
  let y = t.margin.top;

  if (kicker) {
    els.push({
      kind: "text",
      x,
      y,
      w,
      h: ptToIn(t.type.kicker) * 1.4,
      paragraphs: [{ runs: [{ text: kicker }], source: "kicker" }],
      font: t.fonts.body,
      size: t.type.kicker,
      color: t.colors.kicker,
      align: "left",
      valign: "top",
    });
    y += ptToIn(t.type.kicker) * 1.6;
  }

  const titleSize = opts?.titleSize ?? t.type.title;
  const titleH = ptToIn(titleSize) * 2.2; // room for up to ~2 lines
  els.push({
    kind: "text",
    x,
    y,
    w,
    h: titleH,
    paragraphs: [{ runs: [{ text: title, bold: true }], source: "title" }],
    font: t.fonts.title,
    size: titleSize,
    color: opts?.titleColor ?? t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: titleSize * 1.1,
  });

  return { elements: els, contentTop: y + titleH + 0.15 };
}

// Centered copyright footer, present on (nearly) every slide.
export function footer(t: Theme, text: string): TextEl {
  return {
    kind: "text",
    x: t.margin.x,
    y: CANVAS.h - t.margin.bottom - t.layout.footerH,
    w: CANVAS.w - t.margin.x * 2,
    h: t.layout.footerH,
    paragraphs: [{ runs: [{ text }] }],
    font: t.fonts.body,
    size: t.type.caption,
    color: t.colors.kicker,
    align: "center",
    valign: "bottom",
  };
}

// Turn deck bullets into one text element with one paragraph per bullet so both
// renderers wrap natively (no manual y-stepping, no overlap on wrap).
export function bulletsElement(
  bullets: Bullet[],
  t: Theme,
  box: { x: number; y: number; w: number; h: number },
  opts?: { size?: number; sourcePrefix?: string }
): TextEl {
  const size = opts?.size ?? t.type.body;
  const prefix = opts?.sourcePrefix ?? "bullets";
  const paragraphs: Para[] = bullets.map((b, i) => {
    const em = emphasis(b.emphasis, t);
    return {
      runs: [{ text: b.text, bold: em.bold, color: em.color }],
      bullet: true,
      indentLevel: b.level ?? 0,
      spaceAfterPt: 6,
      align: "left",
      source: `${prefix}.${i}.text`,
    };
  });
  return {
    kind: "text",
    ...box,
    paragraphs,
    font: t.fonts.body,
    size,
    color: t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: size * 1.35,
  };
}

// Full-width pale-blue note band with centered text (optional bottom band).
export function noteBand(t: Theme, text: string): Element[] {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const h = 0.8;
  const y = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - h;
  return [
    { kind: "rect", x, y, w, h, fill: t.colors.panel, radius: t.layout.cardRadius },
    {
      kind: "text",
      x: x + 0.3,
      y,
      w: w - 0.6,
      h,
      paragraphs: [{ runs: [{ text, color: t.colors.brand }], source: "note" }],
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.brand,
      align: "center",
      valign: "middle",
    },
  ];
}
