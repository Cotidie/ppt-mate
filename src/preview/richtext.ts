// Serializes between deck Span[] / paragraph lists and a ProseMirror document.
// One TipTap editor backs one whole text element. A single-field element (title,
// note, a table cell) is one paragraph of inline runs; a list element (bullets,
// cover authors) is many paragraphs in ONE editor, so a selection - and any
// formatting - can span them. Marks map 1:1 to Span fields; each paragraph node
// carries the bullet flag + indent level as attributes.

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

type ParaNode = {
  type: "paragraph";
  attrs?: { bullet?: boolean; indentLevel?: number };
  content?: TextNode[];
};

export type PMDoc = {
  type: "doc";
  content: ParaNode[];
};

// One editable paragraph: its inline runs plus the bullet/indent it renders with.
export type EditorPara = {
  runs: Span[];
  bullet?: boolean;
  indentLevel?: number;
};

// --- run <-> inline-node bridges (mark mapping lives here, used by both dirs) ---

function runsToNodes(spans: Span[]): TextNode[] {
  return spans
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
}

function nodesToRuns(nodes: TextNode[]): Span[] {
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

// --- paragraph-list (the general case) <-> doc -------------------------------

export function parasToDoc(paras: EditorPara[]): PMDoc {
  const content: ParaNode[] = (paras.length ? paras : [{ runs: [] }]).map((p) => {
    const nodes = runsToNodes(p.runs);
    const attrs: { bullet?: boolean; indentLevel?: number } = {};
    if (p.bullet) attrs.bullet = true;
    if (p.indentLevel) attrs.indentLevel = p.indentLevel;
    return {
      type: "paragraph",
      ...(Object.keys(attrs).length ? { attrs } : null),
      ...(nodes.length ? { content: nodes } : null),
    };
  });
  return { type: "doc", content };
}

export function docToParas(doc: PMDoc): EditorPara[] {
  return doc.content.map((p) => ({
    runs: nodesToRuns(p.content ?? []),
    bullet: p.attrs?.bullet,
    indentLevel: p.attrs?.indentLevel,
  }));
}

// --- single-field convenience wrappers (one paragraph, no bullet) ------------

export function spansToDoc(spans: Span[]): PMDoc {
  return parasToDoc([{ runs: spans }]);
}

export function docToSpans(doc: PMDoc): Span[] {
  return docToParas(doc)[0]?.runs ?? [];
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
