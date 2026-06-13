// Renders one resolved Element as absolutely-positioned CSS. Inches -> px at 96/in,
// points -> px at 96/72. This is the ONLY place geometry becomes pixels in the preview.

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Align, Element, Para, Run, VAlign } from "../layout/element";
import type { Span } from "../model/deck";
import { PX_PER_IN } from "../theme/theme";
import { RichTextEditor } from "./RichTextEditor";
import { useMode } from "./mode";

const PT_PX = 96 / 72;
const inPx = (v: number) => v * PX_PER_IN;
const DRAG_THRESHOLD = 3; // px (screen space) before a press becomes a move

// Drag-to-move: presses on the element pan it, committing an inch-offset to
// deck.json on release. Active only in "move" mode; only moves past a small
// threshold so a click doesn't register as a drag.
function useElementDrag(slideId: string, elKey: string, scale: number) {
  const mode = useMode();
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || mode !== "move") return;
    // No pointer capture here: capturing would retarget click/dblclick away from
    // the text span and break double-click-to-edit. Capture only once a real
    // drag begins (see onPointerMove).
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!s.moved) {
      s.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic / already-captured pointers can't be captured */
      }
    }
    setDrag({ dx, dy });
  }

  function onPointerUp(e: PointerEvent) {
    const s = start.current;
    start.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (s?.moved) {
      // Screen px -> inches: the stage is CSS-scaled, so undo scale too.
      const dx = (e.clientX - s.x) / (PX_PER_IN * scale);
      const dy = (e.clientY - s.y) / (PX_PER_IN * scale);
      void commitMove(slideId, elKey, dx, dy);
    }
    setDrag(null);
  }

  // The translate lives inside the already-scaled stage, so divide by scale to
  // track the cursor 1:1. Grab cursor only in move mode.
  const dragStyle: CSSProperties = {
    cursor: mode === "move" ? (drag ? "grabbing" : "grab") : "default",
    touchAction: "none",
    ...(drag ? { transform: `translate(${drag.dx / scale}px, ${drag.dy / scale}px)` } : null),
  };
  return { dragProps: { onPointerDown, onPointerMove, onPointerUp }, dragStyle };
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

function runStyle(r: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string }): CSSProperties {
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? "italic" : undefined,
    textDecoration: r.underline ? "underline" : undefined,
    color: r.color,
    background: r.highlight,
  };
}

// Resolved Run and stored Span are structurally identical (text + the five
// optional marks). This is the single point that bridges the two names so the
// editor (which speaks Span) can take resolved runs.
const asSpans = (runs: Run[]): Span[] => runs;

function renderRuns(runs: Run[]) {
  return runs.map((r, i) => (
    <span key={i} style={runStyle(r)}>
      {r.text}
    </span>
  ));
}

// One table cell's content: editable when it carries a source, else plain runs.
function CellContent({ slideId, source, runs }: { slideId: string; source?: string; runs: Run[] }) {
  if (!source) return <>{renderRuns(runs)}</>;
  return <RichTextEditor slideId={slideId} path={source} spans={asSpans(runs)} />;
}

function Paragraph({
  p,
  slideId,
  defFont,
  defSize,
  defColor,
  defAlign,
  lineHeightPt,
}: {
  p: Para;
  slideId: string;
  defFont: string;
  defSize: number;
  defColor: string;
  defAlign?: Align;
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
    // Honor the element-level align (e.g. centered closing title, table verdict),
    // matching the exporter which passes e.align. Paragraph align still wins.
    textAlign: p.align ?? defAlign ?? "left",
    paddingLeft: p.bullet ? 16 + (p.indentLevel ?? 0) * 18 : 0,
    textIndent: p.bullet ? -16 : 0,
  };
  const bullet = p.bullet ? <span style={{ color: defColor }}>•&nbsp;</span> : null;

  if (p.source) {
    return (
      <p style={style} data-source={p.source}>
        {bullet}
        <RichTextEditor slideId={slideId} path={p.source} spans={asSpans(p.runs)} />
      </p>
    );
  }

  return (
    <p style={style}>
      {bullet}
      {renderRuns(p.runs)}
    </p>
  );
}

export function ElementView({ e, slideId, scale }: { e: Element; slideId: string; scale: number }) {
  const { dragProps, dragStyle } = useElementDrag(slideId, e.key, scale);

  if (e.kind === "rect") {
    return (
      <div
        {...dragProps}
        style={{
          ...box(e),
          background: e.fill ?? "transparent",
          border: e.line ? `${(e.lineWidthPt ?? 1) * PT_PX}px solid ${e.line}` : undefined,
          borderRadius: e.radius ? inPx(e.radius) : undefined,
          boxSizing: "border-box",
          ...dragStyle,
        }}
      />
    );
  }

  if (e.kind === "image") {
    return <img src={e.path} {...dragProps} style={{ ...box(e), objectFit: "contain", ...dragStyle }} alt="" />;
  }

  if (e.kind === "table") {
    const fs = e.size * PT_PX;
    return (
      <table
        {...dragProps}
        style={{
          ...box(e),
          borderCollapse: "collapse",
          fontFamily: `'${e.font}', sans-serif`,
          fontSize: fs,
          tableLayout: "fixed",
          ...dragStyle,
        }}
      >
        <thead>
          <tr>
            {e.columns.map((c, i) => (
              <th
                key={i}
                data-source={c.source}
                style={{
                  background: e.headerFill,
                  color: e.headerColor,
                  textAlign: i === 0 ? "left" : "center",
                  padding: "6px 8px",
                  fontWeight: 600,
                  border: `1px solid ${e.borderColor}`,
                }}
              >
                <CellContent slideId={slideId} source={c.source} runs={c.runs} />
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
                  data-source={cell.source}
                  style={{
                    color: e.textColor,
                    fontWeight: ci === 0 ? 600 : 400,
                    fontStyle: ri === e.highlightRow ? "italic" : undefined,
                    textAlign: ci === 0 ? "left" : "center",
                    padding: "5px 8px",
                    border: `1px solid ${e.borderColor}`,
                  }}
                >
                  <CellContent slideId={slideId} source={cell.source} runs={cell.runs} />
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
      {...dragProps}
      className="text-box"
      style={{
        ...box(e),
        display: "flex",
        flexDirection: "column",
        justifyContent: justify[e.valign ?? "top"],
        overflow: "hidden",
        ...dragStyle,
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
          defAlign={e.align}
          lineHeightPt={e.lineHeightPt}
        />
      ))}
    </div>
  );
}

// Commits an incremental position delta (inches) for one element to deck.json.
// The server accumulates it onto any prior offset; HMR then repaints the move.
async function commitMove(id: string, key: string, dx: number, dy: number): Promise<void> {
  const res = await fetch("/api/slides/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, key, dx, dy }),
  });
  if (!res.ok) alert("Move failed. Is the dev server running?");
}
