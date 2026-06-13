// Serializes between deck Span[] and a single-paragraph ProseMirror document.
// The TipTap editor edits one field, which is exactly one paragraph of inline
// runs, no block structure. Marks map 1:1 to Span fields.

import type { Span } from "../model/deck";

// Points <-> pixels: the model stores sizes in pt, the editor (and CSS) in px.
const PT_PX = 96 / 72;

type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  // Color and font size are both attributes of the single textStyle mark.
  | { type: "textStyle"; attrs: { color?: string | null; fontSize?: string | null } }
  | { type: "highlight"; attrs: { color: string } };

type TextNode = { type: "text"; text: string; marks?: Mark[] };

export type PMDoc = {
  type: "doc";
  content: [{ type: "paragraph"; content?: TextNode[] }];
};

export function spansToDoc(spans: Span[]): PMDoc {
  const content: TextNode[] = spans
    .filter((s) => s.text.length > 0)
    .map((s) => {
      const marks: Mark[] = [];
      if (s.bold) marks.push({ type: "bold" });
      if (s.italic) marks.push({ type: "italic" });
      if (s.underline) marks.push({ type: "underline" });
      // color + fontSize share one textStyle mark
      if (s.color || s.size) {
        const attrs: { color?: string; fontSize?: string } = {};
        if (s.color) attrs.color = s.color;
        if (s.size) attrs.fontSize = `${s.size * PT_PX}px`;
        marks.push({ type: "textStyle", attrs });
      }
      if (s.highlight) marks.push({ type: "highlight", attrs: { color: s.highlight } });
      return marks.length ? { type: "text", text: s.text, marks } : { type: "text", text: s.text };
    });
  return {
    type: "doc",
    content: [{ type: "paragraph", content: content.length ? content : undefined }],
  };
}

export function docToSpans(doc: PMDoc): Span[] {
  const nodes = doc.content[0]?.content ?? [];
  const spans: Span[] = nodes
    .filter((n) => n.text.length > 0)
    .map((n) => {
      const span: Span = { text: n.text };
      for (const m of n.marks ?? []) {
        if (m.type === "bold") span.bold = true;
        else if (m.type === "italic") span.italic = true;
        else if (m.type === "underline") span.underline = true;
        else if (m.type === "textStyle") {
          if (m.attrs.color) span.color = m.attrs.color;
          if (m.attrs.fontSize) span.size = Math.round(parseFloat(m.attrs.fontSize) / PT_PX);
        } else if (m.type === "highlight" && m.attrs.color) span.highlight = m.attrs.color;
      }
      return span;
    });
  return mergeAdjacent(spans);
}

function mergeAdjacent(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, s)) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

function sameMarks(a: Span, b: Span): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.size === b.size
  );
}
