// Renders one resolved Element as absolutely-positioned CSS. Inches -> px at 96/in,
// points -> px at 96/72. This is the ONLY place geometry becomes pixels in the preview.

import type { CSSProperties } from "react";
import type { Element, Para, Run, VAlign } from "../layout/element";
import type { Span } from "../model/deck";
import { PX_PER_IN } from "../theme/theme";
import { RichTextEditor } from "./RichTextEditor";

const PT_PX = 96 / 72;
const inPx = (v: number) => v * PX_PER_IN;

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
  return (
    <RichTextEditor slideId={slideId} path={source} spans={asSpans(runs)}>
      {renderRuns(runs)}
    </RichTextEditor>
  );
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

  if (p.source) {
    return (
      <p style={style} data-source={p.source}>
        {bullet}
        <RichTextEditor slideId={slideId} path={p.source} spans={asSpans(p.runs)}>
          {renderRuns(p.runs)}
        </RichTextEditor>
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
