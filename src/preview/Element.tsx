// Renders one resolved Element as absolutely-positioned CSS. Inches -> px at 96/in,
// points -> px at 96/72. This is the ONLY place geometry becomes pixels in the preview.

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Element, Para, VAlign } from "../layout/element";
import { PX_PER_IN } from "../theme/theme";

const PT_PX = 96 / 72;
const inPx = (v: number) => v * PX_PER_IN;

// Double-click a tagged text to edit it in place. Enter/blur commits to deck.json
// (re-rendered via HMR with all styling reapplied); Escape discards. Single-run
// only — the deck field, not the rendered styling, is what gets written.
function EditableText({
  slideId,
  path,
  text,
  style,
}: {
  slideId: string;
  path: string;
  text: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);

  const start = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    setEditing(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      selectWordAt(el, clientX, clientY);
    });
  };

  const stop = (commit: boolean) => {
    setEditing(false);
    const next = ref.current?.textContent ?? "";
    if (commit && next !== text) commitEdit(slideId, path, next);
    else if (!commit && ref.current) ref.current.textContent = text; // discard
  };

  return (
    <span
      ref={ref}
      className={"slide-editable" + (editing ? " editing" : "")}
      style={style}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={start}
      onKeyDown={(e) => {
        if (!editing) return;
        e.stopPropagation(); // don't let typing flip slides
        if (e.key === "Enter") {
          e.preventDefault();
          stop(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          stop(false);
        }
      }}
      onBlur={() => editing && stop(true)}
    >
      {text}
    </span>
  );
}

// Selects the word under (x, y) — the native double-click behavior, which we
// have to redo by hand because the element only becomes editable on the same
// double-click that we want to act on. Falls back to a caret if unsupported.
function selectWordAt(el: HTMLElement, x: number, y: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const caret = caretRangeAt(x, y);
  if (!caret) {
    const all = document.createRange();
    all.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(all);
    return;
  }
  sel.removeAllRanges();
  sel.addRange(caret);
  // Expand the collapsed caret to the surrounding word.
  sel.modify?.("move", "backward", "word");
  sel.modify?.("extend", "forward", "word");
}

function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

// Persists one field edit to deck.json by path; the write triggers Vite HMR.
async function commitEdit(id: string, path: string, value: string): Promise<void> {
  const res = await fetch("/api/slides/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, path, value }),
  });
  if (!res.ok) alert("Edit failed. Is the dev server running?");
}

const justify: Record<VAlign, CSSProperties["justifyContent"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

function box(e: { x: number; y: number; w: number; h: number }): CSSProperties {
  return {
    position: "absolute",
    left: inPx(e.x),
    top: inPx(e.y),
    width: inPx(e.w),
    height: inPx(e.h),
  };
}

function Paragraph({
  p,
  slideId,
  defFont,
  defSize,
  defColor,
  lineHeightPt,
}: {
  p: Para;
  slideId: string;
  defFont: string;
  defSize: number;
  defColor: string;
  lineHeightPt?: number;
}) {
  const size = (p.size ?? defSize) * PT_PX;
  const style: CSSProperties = {
    margin: 0,
    marginBottom: p.spaceAfterPt ? p.spaceAfterPt * PT_PX : 0,
    fontFamily: `'${p.font ?? defFont}', sans-serif`,
    fontSize: size,
    lineHeight: lineHeightPt ? `${lineHeightPt * PT_PX}px` : 1.3,
    color: p.color ?? defColor,
    fontWeight: p.bold ? 700 : 400,
    textAlign: p.align ?? "left",
    paddingLeft: p.bullet ? 16 + (p.indentLevel ?? 0) * 18 : 0,
    textIndent: p.bullet ? -16 : 0,
  };
  const bullet = p.bullet ? <span style={{ color: defColor }}>•&nbsp;</span> : null;

  // Sourced paragraphs are single-run: make just the text editable, keeping the
  // run's own emphasis (bold/color) on the editable span.
  if (p.source) {
    const r = p.runs[0];
    return (
      <p style={style}>
        {bullet}
        <EditableText
          slideId={slideId}
          path={p.source}
          text={r.text}
          style={{
            fontWeight: r.bold ? 700 : undefined,
            fontStyle: r.italic ? "italic" : undefined,
            color: r.color,
          }}
        />
      </p>
    );
  }

  const runs = p.runs.map((r, i) => (
    <span
      key={i}
      style={{
        fontWeight: r.bold ? 700 : undefined,
        fontStyle: r.italic ? "italic" : undefined,
        color: r.color,
      }}
    >
      {r.text}
    </span>
  ));
  return (
    <p style={style}>
      {bullet}
      {runs}
    </p>
  );
}

export function ElementView({ e, slideId }: { e: Element; slideId: string }) {
  if (e.kind === "rect") {
    return (
      <div
        style={{
          ...box(e),
          background: e.fill ?? "transparent",
          border: e.line ? `${(e.lineWidthPt ?? 1) * PT_PX}px solid ${e.line}` : undefined,
          borderRadius: e.radius ? inPx(e.radius) : undefined,
          boxSizing: "border-box",
        }}
      />
    );
  }

  if (e.kind === "image") {
    return <img src={e.path} style={{ ...box(e), objectFit: "contain" }} alt="" />;
  }

  if (e.kind === "table") {
    const fs = e.size * PT_PX;
    return (
      <table
        style={{
          ...box(e),
          borderCollapse: "collapse",
          fontFamily: `'${e.font}', sans-serif`,
          fontSize: fs,
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr>
            {e.columns.map((c, i) => (
              <th
                key={i}
                style={{
                  background: e.headerFill,
                  color: e.headerColor,
                  textAlign: i === 0 ? "left" : "center",
                  padding: "6px 8px",
                  fontWeight: 600,
                  border: `1px solid ${e.borderColor}`,
                }}
              >
                {e.columnSources?.[i] ? (
                  <EditableText slideId={slideId} path={e.columnSources[i]} text={c} />
                ) : (
                  c
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {e.rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri === e.highlightRow ? e.highlightFill : undefined }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    color: cell.color ?? e.textColor,
                    fontWeight: cell.color ? 700 : ci === 0 ? 600 : 400,
                    fontStyle: ri === e.highlightRow ? "italic" : undefined,
                    textAlign: ci === 0 ? "left" : "center",
                    padding: "5px 8px",
                    border: `1px solid ${e.borderColor}`,
                  }}
                >
                  {cell.source ? (
                    <EditableText slideId={slideId} path={cell.source} text={cell.text} />
                  ) : (
                    cell.text
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // text
  return (
    <div
      style={{
        ...box(e),
        display: "flex",
        flexDirection: "column",
        justifyContent: justify[e.valign ?? "top"],
        overflow: "hidden",
      }}
    >
      {e.paragraphs.map((p, i) => (
        <Paragraph
          key={i}
          p={p}
          slideId={slideId}
          defFont={e.font}
          defSize={e.size}
          defColor={e.color}
          lineHeightPt={e.lineHeightPt}
        />
      ))}
    </div>
  );
}
