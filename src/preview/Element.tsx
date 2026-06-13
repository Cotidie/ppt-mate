// Renders one resolved Element. Inches -> px at 96/in, points -> px at 96/72.
// This is the ONLY place geometry becomes pixels in the preview.
//
// Every element is wrapped in a positioned "frame" that owns its geometry: the
// frame is what moves (body drag) and resizes (8 handles) in move mode, and the
// kind-specific content (text/rect/image/table) fills it. Putting geometry on a
// generic frame is what lets resize handles attach to any kind - including <img>
// and <table>, which can't host child handles directly.

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Align, Element, Para, Run, VAlign } from "../layout/element";
import type { Span } from "../model/deck";
import { PX_PER_IN } from "../theme/theme";
import { MIN_IN } from "../layout/resolve";
import { RichTextEditor } from "./RichTextEditor";
import { useMode } from "./mode";

const PT_PX = 96 / 72;
const inPx = (v: number) => v * PX_PER_IN;
const DRAG_THRESHOLD = 3; // px (screen space) before a press becomes a gesture

// ---------------------------------------------------------------------------
// Geometry gesture: move (body drag) + resize (handle drag), both in move mode.
// ---------------------------------------------------------------------------

type Delta = { dx: number; dy: number; dw: number; dh: number };
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// Translate a handle's screen drag (already in inches) into a geometry delta,
// clamped so the box never shrinks below MIN_IN (and so a min-size hit pins the
// opposite edge instead of dragging it). West/north edges move the origin.
function dirDelta(dir: Dir, mx: number, my: number, baseW: number, baseH: number): Delta {
  let dx = 0, dy = 0, dw = 0, dh = 0;
  if (dir.includes("e")) dw = Math.max(mx, MIN_IN - baseW);
  if (dir.includes("w")) {
    const m = Math.min(mx, baseW - MIN_IN); // can't push past min width
    dw = -m;
    dx = m;
  }
  if (dir.includes("s")) dh = Math.max(my, MIN_IN - baseH);
  if (dir.includes("n")) {
    const m = Math.min(my, baseH - MIN_IN);
    dh = -m;
    dy = m;
  }
  return { dx, dy, dw, dh };
}

// One hook drives both gestures. `pending` is the live (clamped) delta in inches
// that the frame previews; on release it commits to deck.json. Window listeners
// (not pointer capture) keep the gesture alive while the cursor leaves the box.
function useElementGesture(slideId: string, key: string, scale: number, baseW: number, baseH: number) {
  const mode = useMode();
  const [pending, setPending] = useState<Delta | null>(null);

  function begin(e: ReactPointerEvent, dir: Dir | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let last: Delta | null = null;

    const move = (ev: PointerEvent) => {
      const mxPx = ev.clientX - startX;
      const myPx = ev.clientY - startY;
      if (!moved && Math.hypot(mxPx, myPx) < DRAG_THRESHOLD) return;
      moved = true;
      // Screen px -> inches: the stage is CSS-scaled, so undo scale too.
      const mx = mxPx / (PX_PER_IN * scale);
      const my = myPx / (PX_PER_IN * scale);
      last = dir ? dirDelta(dir, mx, my, baseW, baseH) : { dx: mx, dy: my, dw: 0, dh: 0 };
      setPending(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && last) void commitTransform(slideId, key, last);
      setPending(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Body press starts a move, but only in move mode.
  const bodyProps = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (mode !== "move") return;
      begin(e, null);
    },
  };
  // A handle press starts a resize (handles only render in move mode).
  const startResize = (dir: Dir) => (e: ReactPointerEvent) => begin(e, dir);

  return { mode, pending, bodyProps, startResize };
}

function ResizeHandles({ startResize }: { startResize: (dir: Dir) => (e: ReactPointerEvent) => void }) {
  return (
    <>
      {DIRS.map((d) => (
        <div key={d} className={`resize-handle rh-${d}`} onPointerDown={startResize(d)} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Content rendering (kind-specific), sized to fill the frame.
// ---------------------------------------------------------------------------

const justify: Record<VAlign, CSSProperties["justifyContent"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

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

// The kind-specific content, filling the frame (width/height 100%). Geometry
// (x/y/w/h) lives on the frame; content never positions itself.
function ElementBody({ e, slideId }: { e: Element; slideId: string }) {
  if (e.kind === "rect") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: e.fill ?? "transparent",
          border: e.line ? `${(e.lineWidthPt ?? 1) * PT_PX}px solid ${e.line}` : undefined,
          borderRadius: e.radius ? inPx(e.radius) : undefined,
          boxSizing: "border-box",
        }}
      />
    );
  }

  if (e.kind === "image") {
    return <img src={e.path} style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="" />;
  }

  if (e.kind === "table") {
    const fs = e.size * PT_PX;
    return (
      <table
        style={{
          width: "100%",
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
      className="text-box"
      style={{
        width: "100%",
        // Auto-grow: the box is never shorter than its laid-out height (so
        // un-resized boxes look unchanged and valign still works) but grows
        // downward as rewrapped text needs more lines.
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: justify[e.valign ?? "top"],
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

// ---------------------------------------------------------------------------
// Frame: per-element geometry owner (move/resize/hover) wrapping the content.
// ---------------------------------------------------------------------------

export function ElementView({ e, slideId, scale }: { e: Element; slideId: string; scale: number }) {
  const { mode, pending, bodyProps, startResize } = useElementGesture(slideId, e.key, scale, e.w, e.h);
  const [hover, setHover] = useState(false);

  // Live geometry while dragging a move/resize gesture; otherwise the resolved
  // box. Clamp mirrors resolveSlide so the preview matches the committed result.
  const x = e.x + (pending?.dx ?? 0);
  const y = e.y + (pending?.dy ?? 0);
  const w = Math.max(MIN_IN, e.w + (pending?.dw ?? 0));
  const h = Math.max(MIN_IN, e.h + (pending?.dh ?? 0));

  const isText = e.kind === "text";
  const showHandles = mode === "move" && hover;

  const frameStyle: CSSProperties = {
    position: "absolute",
    left: inPx(x),
    top: inPx(y),
    width: inPx(w),
    // Text frames auto-grow (min height); other kinds keep a fixed box.
    ...(isText ? { minHeight: inPx(h) } : { height: inPx(h) }),
    // Non-text content clips to its box; text overflows so auto-grow shows, and
    // so the editor's floating BubbleMenu isn't cropped.
    overflow: isText ? "visible" : "hidden",
    cursor: mode === "move" ? (pending ? "grabbing" : "grab") : "default",
    touchAction: "none",
  };

  return (
    <div
      className={"el-frame" + (showHandles ? " selected" : "")}
      style={frameStyle}
      {...bodyProps}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <ElementBody e={e} slideId={slideId} />
      {showHandles && <ResizeHandles startResize={startResize} />}
    </div>
  );
}

// Commits an accumulated geometry delta (inches) for one element to deck.json:
// dx/dy move, dw/dh resize. The server adds it onto any prior override; HMR then
// repaints. (Route name is historical - it now carries resizes too.)
async function commitTransform(id: string, key: string, d: Delta): Promise<void> {
  const res = await fetch("/api/slides/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, key, ...d }),
  });
  if (!res.ok) alert("Move failed. Is the dev server running?");
}
