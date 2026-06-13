// Renders one resolved Element. Inches -> px at 96/in, points -> px at 96/72.
// This is the ONLY place geometry becomes pixels in the preview.
//
// Every element is wrapped in a positioned "frame" that owns its geometry: the
// frame is what moves (body drag) and resizes (8 handles) in move mode, and the
// kind-specific content (text/rect/image/table) fills it. Putting geometry on a
// generic frame is what lets resize handles attach to any kind - including <img>
// and <table>, which can't host child handles directly.

import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Align, Element, Para, Run, VAlign } from "../layout/element";
import type { Span } from "../model/deck";
import { PX_PER_IN } from "../theme/theme";
import { RichTextEditor } from "./RichTextEditor";
import { useMode } from "./mode";
import { useSelection } from "./selection";
import {
  DRAG_THRESHOLD,
  applyDelta,
  commitTransform,
  cursorFor,
  dirDelta,
  nearGeom,
  type Delta,
  type Dir,
  type Geom,
  DIRS,
} from "./gesture";

const PT_PX = 96 / 72;
const inPx = (v: number) => v * PX_PER_IN;

// ---------------------------------------------------------------------------
// Geometry gesture: move (body drag) + resize (handle drag), both in move mode.
// Primitives (Delta/Dir/applyDelta/...) live in gesture.ts, shared with the
// group selection controller.
// ---------------------------------------------------------------------------

// One hook drives both gestures. It tracks an *absolute* optimistic geometry the
// frame renders instead of the resolved props: live during the drag, and HELD
// after release until deck.json (via the server + HMR) reports the same geometry
// back in props. Holding past release is what kills the flicker - clearing
// immediately would snap the element back to its pre-gesture box for the
// fetch->write->HMR round-trip. Because the hold is absolute (not an additive
// delta), the handoff to props is value-identical: no rollback, no double-apply.
// Window listeners (not pointer capture) keep the gesture alive off the box.
function useElementGesture(slideId: string, key: string, scale: number, base: Geom) {
  const mode = useMode();
  const sel = useSelection();
  const [optimistic, setOptimistic] = useState<Geom | null>(null);
  const [dragging, setDragging] = useState(false);

  // Release the hold once props catch up to the committed geometry.
  useEffect(() => {
    if (optimistic && nearGeom(base, optimistic)) setOptimistic(null);
  }, [base.x, base.y, base.w, base.h, optimistic]);

  function begin(e: ReactPointerEvent, dir: Dir | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Stop the press from starting a native text selection that the drag would
    // then sweep across the slide.
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let last: Delta | null = null;

    const move = (ev: PointerEvent) => {
      const mxPx = ev.clientX - startX;
      const myPx = ev.clientY - startY;
      if (!moved && Math.hypot(mxPx, myPx) < DRAG_THRESHOLD) return;
      if (!moved) {
        setDragging(true);
        // Pin the cursor document-wide for the whole drag (see RESIZE_CURSOR).
        document.body.classList.add("gesture-active");
        document.body.style.setProperty("--gesture-cursor", cursorFor(dir));
      }
      moved = true;
      // Screen px -> inches: the stage is CSS-scaled, so undo scale too.
      const mx = mxPx / (PX_PER_IN * scale);
      const my = myPx / (PX_PER_IN * scale);
      if (dir) {
        // Resize: snap the dragged edge(s) to nearby element lines (Alt bypasses);
        // derive the delta from the snapped box. The controller draws the guides.
        const cand = applyDelta(base, dirDelta(dir, mx, my, base.w, base.h));
        const box = sel.snapResizeBox(cand, dir, [key], scale, ev.altKey);
        last = { dx: box.x - base.x, dy: box.y - base.y, dw: box.w - base.w, dh: box.h - base.h };
      } else {
        // Move: snap the candidate box to nearby element alignment lines (Alt
        // bypasses). The correction is added to the raw delta; the controller
        // draws the guides.
        const cand = applyDelta(base, { dx: mx, dy: my, dw: 0, dh: 0 });
        const c = sel.snapMoveBox(cand, [key], scale, ev.altKey);
        last = { dx: mx + c.dx, dy: my + c.dy, dw: 0, dh: 0 };
      }
      setOptimistic(applyDelta(base, last));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      sel.clearGuides();
      document.body.classList.remove("gesture-active");
      document.body.style.removeProperty("--gesture-cursor");
      // Keep the optimistic geometry held (it's already set to the final spot);
      // commit, and let the catch-up effect release it when props match.
      if (moved && last) void commitTransform(slideId, key, last);
      else setOptimistic(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Body press starts a single-element move; the caller (ElementView) gates it on
  // move mode and routes group presses to the selection controller instead.
  const beginMove = (e: ReactPointerEvent) => begin(e, null);
  // A handle press starts a resize (handles only render in move mode).
  const startResize = (dir: Dir) => (e: ReactPointerEvent) => begin(e, dir);

  return { mode, optimistic, dragging, beginMove, startResize };
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

function runStyle(r: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string; size?: number }): CSSProperties {
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? "italic" : undefined,
    textDecoration: r.underline ? "underline" : undefined,
    color: r.color,
    background: r.highlight,
    // Run-level size (pt -> px); unsized runs inherit the paragraph/element size.
    fontSize: r.size ? r.size * PT_PX : undefined,
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
function CellContent({ slideId, source, runs, defaultSize }: { slideId: string; source?: string; runs: Run[]; defaultSize: number }) {
  if (!source) return <>{renderRuns(runs)}</>;
  return (
    <RichTextEditor
      slideId={slideId}
      target={{ kind: "field", path: source }}
      paragraphs={[{ runs: asSpans(runs) }]}
      defaultSize={defaultSize}
    />
  );
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
  const isBullet = !!p.bullet;
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
    // Bullets lay out as a flex row (marker + content column). The content is a
    // block (the always-mounted ProseMirror editor), so the old inline
    // hanging-indent trick can't apply - flex keeps the marker beside the text
    // and wraps wrapped lines under the content, not the bullet.
    ...(isBullet
      ? { display: "flex", alignItems: "baseline", paddingLeft: (p.indentLevel ?? 0) * 18 }
      : null),
  };
  const marker = isBullet ? (
    <span style={{ color: defColor, flex: "0 0 auto", marginRight: 6 }}>•</span>
  ) : null;

  // The content slot: editable (rich text) or static runs. Under a bullet it's a
  // flex:1 column so the block editor takes the remaining width and wraps there.
  const content = p.source ? (
    <RichTextEditor
      slideId={slideId}
      target={{ kind: "field", path: p.source }}
      paragraphs={[{ runs: asSpans(p.runs) }]}
      defaultSize={p.size ?? defSize}
    />
  ) : (
    renderRuns(p.runs)
  );

  return (
    <p style={style} data-source={p.source}>
      {marker}
      {isBullet ? <span style={{ flex: 1, minWidth: 0 }}>{content}</span> : content}
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
          // Clip content to the box here (not on the frame, which must stay
          // overflow:visible so it doesn't cut the resize handles).
          overflow: "hidden",
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
          // Clip to the box on the content (the frame stays overflow:visible so it
          // doesn't cut the resize handles).
          overflow: "hidden",
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
                <CellContent slideId={slideId} source={c.source} runs={c.runs} defaultSize={e.size} />
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
                  <CellContent slideId={slideId} source={cell.source} runs={cell.runs} defaultSize={e.size} />
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
        width: "100%",
        // Fill the frame's height (which is at least the laid-out height, and
        // grows when text wraps) so vertical alignment has a definite box to
        // resolve against - otherwise middle/bottom valign collapses to top.
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify[e.valign ?? "top"],
      }}
    >
      {e.list ? (
        // List element (bullets, cover authors): ONE editor over every paragraph,
        // so a selection - and any formatting - spans them. Element-level type
        // styling lives on the host; the bullet markers/indent are CSS (see
        // .rt-list in styles.css), keyed off each paragraph's data-bullet/-indent.
        <RichTextEditor
          slideId={slideId}
          target={{ kind: "list", path: e.list.path, item: e.list.item }}
          paragraphs={e.paragraphs.map((p) => ({ runs: asSpans(p.runs), bullet: p.bullet, indentLevel: p.indentLevel }))}
          defaultSize={e.size}
          style={listHostStyle(e)}
        />
      ) : (
        e.paragraphs.map((p, i) => (
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
        ))
      )}
    </div>
  );
}

// Element-level type styling for a list editor host. The block PM paragraphs
// inherit it; run marks (color, size) override per span, bullet markers inherit
// the color.
function listHostStyle(e: Extract<Element, { kind: "text" }>): CSSProperties {
  return {
    display: "block",
    width: "100%",
    fontFamily: `'${e.font}', sans-serif`,
    fontSize: e.size * PT_PX,
    lineHeight: e.lineHeightPt ? `${e.lineHeightPt * PT_PX}px` : 1.3,
    color: e.color,
    textAlign: e.align ?? "left",
  };
}

// ---------------------------------------------------------------------------
// Frame: per-element geometry owner (move/resize/hover) wrapping the content.
// ---------------------------------------------------------------------------

export function ElementView({
  e,
  slideId,
  scale,
  ctxSelected,
}: {
  e: Element;
  slideId: string;
  scale: number;
  ctxSelected?: boolean; // selected as Claude context (Select tool)
}) {
  const { mode, optimistic, dragging, beginMove, startResize } = useElementGesture(
    slideId,
    e.key,
    scale,
    e
  );
  const sel = useSelection();
  const [hover, setHover] = useState(false);

  const inGroup = sel.selected.has(e.key);
  // While a group move is dragging, the controller broadcasts each member's
  // absolute optimistic geometry; it wins over this element's own optimistic.
  const groupGeom = sel.groupGeomFor(e.key);

  // Precedence: a live group move, then this element's own gesture hold, then the
  // resolved props.
  const { x, y, w, h } = groupGeom ?? optimistic ?? e;
  const groupDragging = groupGeom != null;

  const isText = e.kind === "text";
  // Resize handles are available in BOTH modes (edit-mode resize lets the user
  // reflow text by box size). Body-drag still only moves in move mode; in edit
  // mode the body stays click-to-edit, so only the handles act here. Hide them
  // during a multi-element selection (resize is single-element; the group affords
  // move only). Keep them mounted while dragging even if the resizing edge slips
  // out from under the cursor and clears hover.
  const multi = sel.selected.size > 1;
  // No resize affordance in select mode (it picks context, never edits geometry).
  const showHandles = (hover || dragging) && !multi && !groupDragging && mode !== "select";
  // The solid move-style selection outline: a selected group member, during any
  // drag (so an edit-mode resize gets clear feedback), and in move mode on hover.
  // Edit-mode hover/focus keep their own dashed/solid affordance (styles.css).
  const selected = inGroup || dragging || groupDragging || (mode === "move" && hover);

  // Body press in move mode: drag the whole group if this element is a member of a
  // multi-selection, otherwise select just this element and start a single move.
  const onBodyDown = (ev: ReactPointerEvent) => {
    if (mode !== "move" || ev.button !== 0) return;
    ev.stopPropagation(); // don't let the stage start a marquee
    if (inGroup && multi) sel.beginGroupMove(ev, scale);
    else {
      sel.selectOnly(e.key);
      beginMove(ev);
    }
  };

  const frameStyle: CSSProperties = {
    position: "absolute",
    left: inPx(x),
    top: inPx(y),
    width: inPx(w),
    // Text frames auto-grow (min height) and host their content as a flex column
    // so the content can fill the box height (needed for middle/bottom valign);
    // other kinds keep a fixed box.
    ...(isText
      ? { minHeight: inPx(h), display: "flex", flexDirection: "column" }
      : { height: inPx(h) }),
    // The frame never clips: clipping here would cut the resize handles, which
    // sit ~5px outside the box. Non-text kinds clip their own content (see
    // ElementBody); text overflows so auto-grow + the floating BubbleMenu show.
    overflow: "visible",
    cursor: mode === "move" ? (dragging ? "grabbing" : "grab") : mode === "select" ? "text" : "default",
    touchAction: "none",
    // Move mode is gesture-only (no text highlight); select mode allows native
    // text selection so the user can sweep letters/words for Claude context.
    userSelect: mode === "move" ? "none" : mode === "select" ? "text" : undefined,
    WebkitUserSelect: mode === "move" ? "none" : mode === "select" ? "text" : undefined,
  };

  return (
    <div
      className={
        "el-frame " + mode + (isText ? " editable" : "") + (selected ? " selected" : "") +
        (ctxSelected ? " ctx-selected" : "")
      }
      data-key={e.key}
      style={frameStyle}
      onPointerDown={onBodyDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <ElementBody e={e} slideId={slideId} />
      {showHandles && <ResizeHandles startResize={startResize} />}
    </div>
  );
}
