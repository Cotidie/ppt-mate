// PPTX exporter. Reads deck.json + theme.json, runs the SAME resolveSlide as the
// preview, and emits native pptxgenjs shapes using the resolved inch coordinates.
// Preview and export share geometry, so the .pptx matches the browser by construction.

import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import pptxgen from "pptxgenjs";
import type { Deck } from "../src/model/deck";
import { resolveSlide } from "../src/layout/resolve";
import type { Element, Para } from "../src/layout/element";
import { theme } from "../src/theme/theme";

const here = dirname(fileURLToPath(import.meta.url));
const root = pathResolve(here, "..");
const deck = JSON.parse(readFileSync(pathResolve(root, "deck.json"), "utf8")) as Deck;

const hex = (c?: string) => (c ?? "#000000").replace("#", "").toUpperCase();

function addTextEl(slide: pptxgen.Slide, e: Extract<Element, { kind: "text" }>) {
  const runs: pptxgen.TextProps[] = [];
  e.paragraphs.forEach((p: Para) => {
    p.runs.forEach((r, ri) => {
      const isLast = ri === p.runs.length - 1;
      runs.push({
        text: r.text,
        options: {
          bold: r.bold ?? p.bold ?? false,
          italic: r.italic,
          underline: r.underline ? { style: "sng" } : undefined,
          highlight: r.highlight ? hex(r.highlight) : undefined,
          color: hex(r.color ?? p.color ?? e.color),
          fontFace: p.font ?? e.font,
          fontSize: p.size ?? e.size,
          align: p.align ?? e.align ?? "left",
          bullet: p.bullet ? { indent: 14 + (p.indentLevel ?? 0) * 14 } : false,
          indentLevel: p.indentLevel ?? 0,
          breakLine: isLast,
          paraSpaceAfter: isLast ? p.spaceAfterPt ?? 0 : 0,
        },
      });
    });
  });

  slide.addText(runs, {
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    valign: e.valign ?? "top",
    align: e.align ?? "left",
    fontFace: e.font,
    fontSize: e.size,
    color: hex(e.color),
    lineSpacing: e.lineHeightPt,
    margin: 0,
  });
}

function addRectEl(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  e: Extract<Element, { kind: "rect" }>
) {
  const shape = e.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  slide.addShape(shape, {
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    fill: e.fill ? { color: hex(e.fill) } : { type: "none" },
    line: e.line ? { color: hex(e.line), width: e.lineWidthPt ?? 1 } : { type: "none" },
    rectRadius: e.radius ?? 0,
  });
}

function runsToTextProps(
  runs: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string }[],
  fallback: { color?: string; bold?: boolean; italic?: boolean }
): pptxgen.TextProps[] {
  return runs.map((r) => ({
    text: r.text,
    options: {
      bold: r.bold ?? fallback.bold,
      italic: r.italic ?? fallback.italic,
      underline: r.underline ? { style: "sng" } : undefined,
      highlight: r.highlight ? hex(r.highlight) : undefined,
      color: hex(r.color ?? fallback.color),
    },
  }));
}

function addTableEl(slide: pptxgen.Slide, e: Extract<Element, { kind: "table" }>) {
  const border = { type: "solid" as const, color: hex(e.borderColor), pt: 1 };

  const headerRow: pptxgen.TableRow = e.columns.map((c, ci) => ({
    text: runsToTextProps(c.runs, { color: e.headerColor, bold: true }),
    options: {
      fill: { color: hex(e.headerFill) },
      color: hex(e.headerColor),
      align: ci === 0 ? "left" : "center",
      valign: "middle",
    },
  }));

  const dataRows: pptxgen.TableRow[] = e.rows.map((row, ri) =>
    row.map((cell, ci) => ({
      text: runsToTextProps(cell.runs, {
        color: e.textColor,
        bold: ci === 0,
        italic: ri === e.highlightRow,
      }),
      options: {
        fill: ri === e.highlightRow && e.highlightFill ? { color: hex(e.highlightFill) } : undefined,
        align: ci === 0 ? "left" : "center",
        valign: "middle",
      },
    }))
  );

  const colW = e.columns.map((_, ci) =>
    ci === 0 ? e.w * 0.28 : (e.w * 0.72) / (e.columns.length - 1)
  );

  slide.addTable([headerRow, ...dataRows], {
    x: e.x,
    y: e.y,
    w: e.w,
    colW,
    border,
    fontFace: e.font,
    fontSize: e.size,
    valign: "middle",
    autoPage: false,
  });
}

async function main() {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "W16x9", width: theme.canvas.w, height: theme.canvas.h });
  pptx.layout = "W16x9";

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(theme.colors.bg) };
    for (const e of resolveSlide(s, theme, deck.meta.footer)) {
      if (e.kind === "text") addTextEl(slide, e);
      else if (e.kind === "rect") addRectEl(pptx, slide, e);
      else if (e.kind === "table") addTableEl(slide, e);
      else if (e.kind === "image") slide.addImage({ path: e.path, x: e.x, y: e.y, w: e.w, h: e.h });
    }
  }

  const outDir = pathResolve(root, "out");
  mkdirSync(outDir, { recursive: true });
  const fileName = pathResolve(outDir, "deck.pptx");
  await pptx.writeFile({ fileName });
  console.log("wrote", fileName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
