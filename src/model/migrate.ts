// One-time transform: rewrites an old-shape deck (plain-string fields, bullet
// emphasis enum, table cellColors) into the rich-text shape (Span[] everywhere).
// Pure and idempotent: fields already in array form are passed through unchanged.

import theme from "../../theme.json";
import type { Span } from "./deck";

const GREEN = theme.colors.green;
const RED = theme.colors.red;

function toRich(v: unknown): Span[] {
  if (Array.isArray(v)) return v as Span[];
  return [{ text: String(v ?? "") }];
}

function emphasisToSpans(text: string, emphasis?: string): Span[] {
  if (emphasis === "green") return [{ text, color: GREEN, bold: true }];
  if (emphasis === "red") return [{ text, color: RED, bold: true }];
  if (emphasis === "bold") return [{ text, bold: true }];
  return [{ text }];
}

function migrateBullet(b: any): any {
  if (Array.isArray(b.runs)) return b;
  const out: any = { runs: emphasisToSpans(b.text, b.emphasis) };
  if (b.level != null) out.level = b.level;
  return out;
}

function colorCell(text: string, color?: string): Span[] {
  if (color === "green") return [{ text, color: GREEN }];
  if (color === "red") return [{ text, color: RED }];
  return [{ text }];
}

function migrateSlide(s: any): any {
  const out: any = { ...s };
  if (s.kicker != null) out.kicker = toRich(s.kicker);
  if (s.title != null) out.title = toRich(s.title);

  switch (s.layout) {
    case "cover":
      if (s.citation != null) out.citation = toRich(s.citation);
      if (s.authors) out.authors = s.authors.map(toRich);
      break;
    case "body":
      out.bullets = s.bullets.map(migrateBullet);
      if (s.note != null) out.note = toRich(s.note);
      break;
    case "comparison":
      out.cards = s.cards.map((c: any) => ({
        ...c,
        header: toRich(c.header),
        bullets: c.bullets.map(migrateBullet),
      }));
      if (s.note != null) out.note = toRich(s.note);
      break;
    case "table":
      if (s.verdict != null) out.verdict = toRich(s.verdict);
      out.columns = s.columns.map(toRich);
      out.rows = s.rows.map((r: any) => ({
        cells: r.cells.map((cell: any, i: number) =>
          Array.isArray(cell) ? cell : colorCell(cell, r.cellColors?.[i])
        ),
      }));
      break;
    case "closing":
      if (s.subtitle != null) out.subtitle = toRich(s.subtitle);
      break;
  }
  return out;
}

export function migrateDeck(deck: any): any {
  return { ...deck, slides: deck.slides.map(migrateSlide) };
}
