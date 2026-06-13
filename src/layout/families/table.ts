import type { Theme } from "../../theme/theme";
import type { Element, TableCellEl } from "../element";
import { CANVAS, header, footer, spansToRuns } from "../shared";

type TableSlide = Extract<import("../../model/deck").Slide, { layout: "table" }>;

export function resolveTable(s: TableSlide, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  let top = contentTop + 0.1;

  if (s.verdict) {
    const h = 0.5;
    els.push({
      kind: "text",
      key: "verdict",
      x,
      y: top,
      w,
      h,
      paragraphs: [{ runs: spansToRuns(s.verdict), bold: true, source: "verdict" }],
      font: t.fonts.title,
      size: t.type.body + 4,
      color: t.colors.textPrimary,
      align: "center",
      valign: "middle",
    });
    top += h + 0.2;
  }

  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.3;

  const columns: TableCellEl[] = s.columns.map((c, ci) => ({
    runs: spansToRuns(c),
    source: `columns.${ci}`,
  }));
  const rows: TableCellEl[][] = s.rows.map((r, ri) =>
    r.cells.map((cell, ci) => ({
      runs: spansToRuns(cell),
      source: `rows.${ri}.cells.${ci}`,
    }))
  );

  els.push({
    kind: "table",
    key: "table",
    x,
    y: top,
    w,
    h: bottomLimit - top,
    columns,
    rows,
    headerFill: t.colors.cardHeader,
    headerColor: t.colors.white,
    highlightRow: s.highlightRow,
    highlightFill: t.colors.panel,
    font: t.fonts.body,
    size: t.type.body - 2,
    borderColor: t.colors.border,
    textColor: t.colors.textPrimary,
  });

  els.push(footer(t, footerText));
  return els;
}
