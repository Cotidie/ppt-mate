// Fixed 1280x720 (16:9) print-accurate stage, scaled to fit its container.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Slide } from "../model/deck";
import { resolveSlide } from "../layout/resolve";
import { theme, PX_PER_IN } from "../theme/theme";
import { ElementView } from "./Element";
import { SelectionContext, useSelectionState } from "./selection";
import { useMode } from "./mode";
import { reportContext, setPendingVisual, type RenderFact, type TextSel, type Rect } from "./agentContext";
import * as htmlToImage from "html-to-image";

const STAGE_W = theme.canvas.w * PX_PER_IN; // 1280
const STAGE_H = theme.canvas.h * PX_PER_IN; // 720

export function SlideCanvas({
  slide,
  footerText,
  zoom = 1,
}: {
  slide: Slide;
  footerText: string;
  zoom?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  // Visual Selection tool: the live rubber-band region (unscaled stage px).
  const [visualRect, setVisualRect] = useState<Rect | null>(null);

  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const s = Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H);
      setFitScale(s);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Effective scale = auto-fit times the user's zoom. Drag math divides by this,
  // so moves stay correct at any zoom.
  const scale = fitScale * zoom;

  const elements = resolveSlide(slide, theme, footerText);

  const mode = useMode();
  const selection = useSelectionState(elements, slide.id, scale);

  // The slide context picked for Claude with the Select tool: one element, or a
  // text range. Persists across mode switches (only Select-mode actions change
  // it); cleared when the active slide changes. Move-mode group selection is
  // separate and is NOT reported to the agent.
  const [claudeSel, setClaudeSel] = useState<{ keys: string[]; text: TextSel | null }>({
    keys: [],
    text: null,
  });

  useEffect(() => {
    reportContext({ selection: claudeSel.keys, selectedText: claudeSel.text });
  }, [claudeSel]);

  // A new slide is a fresh context.
  useEffect(() => {
    setClaudeSel({ keys: [], text: null });
  }, [slide.id]);

  // Select mode: capture what the user picks for Claude. A non-empty native text
  // selection inside an element becomes a text range; a plain click selects the
  // whole element; a click on empty stage clears. Listeners live only while the
  // Select tool is active.
  useEffect(() => {
    if (mode !== "select") return;
    const root = wrapRef.current;
    if (!root) return;
    const onSelChange = () => {
      const t = readTextSel(root);
      if (t) setClaudeSel({ keys: [t.elementKey], text: t });
    };
    const onClick = (ev: MouseEvent) => {
      const native = window.getSelection();
      if (native && !native.isCollapsed && native.toString().trim()) return; // text drag: handled above
      const frame = (ev.target as HTMLElement | null)?.closest?.(".el-frame[data-key]") as HTMLElement | null;
      if (frame && root.contains(frame)) setClaudeSel({ keys: [frame.getAttribute("data-key")!], text: null });
      else setClaudeSel({ keys: [], text: null });
    };
    document.addEventListener("selectionchange", onSelChange);
    root.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      root.removeEventListener("click", onClick);
    };
  }, [mode]);

  // Measure rendered layout (text overflow past its box + off-canvas) and report
  // it, so the agent can see and fix visual problems the model alone can't predict.
  // Runs once fonts + layout settle; re-runs on slide change and on remount after
  // a deck edit (HMR). offsetHeight is unaffected by the stage's CSS scale.
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const root = wrapRef.current;
      if (!root) return;
      const facts: Record<string, RenderFact> = {};
      const eps = 0.02;
      const linePx = theme.layout.lineHeightPt * (96 / 72);
      for (const e of elements) {
        const fact: RenderFact = {};
        if (e.x < -eps || e.y < -eps || e.x + e.w > theme.canvas.w + eps || e.y + e.h > theme.canvas.h + eps)
          fact.offCanvas = true;
        const frame = root.querySelector(`.el-frame[data-key="${e.key}"]`) as HTMLElement | null;
        if (frame) {
          const overrunPx = frame.offsetHeight - e.h * PX_PER_IN;
          if (overrunPx > linePx * 0.5) {
            fact.overflowInches = Math.round((overrunPx / PX_PER_IN) * 100) / 100;
            fact.overflowLines = Math.max(1, Math.round(overrunPx / linePx));
          }
        }
        if (Object.keys(fact).length) facts[e.key] = fact;
      }
      reportContext({ render: facts });
    };
    const fontsReady = (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    fontsReady.then(() => requestAnimationFrame(measure));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, footerText]);

  // A press that reaches the stage (not stopped by an element frame): move mode
  // rubber-bands a group selection; visual mode rubber-bands a capture region.
  const onStageDown = (e: ReactPointerEvent) => {
    if (mode === "move") selection.beginMarquee(e, scale);
    else if (mode === "visual") beginVisual(e);
  };

  // Visual Selection: drag a rectangle (unscaled stage px), then rasterize the
  // stage and crop to it, handing the PNG to the chat path via setPendingVisual.
  const beginVisual = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const stageEl = stageRef.current;
    if (!stageEl) return;
    e.preventDefault();
    const box = stageEl.getBoundingClientRect();
    const toStage = (cx: number, cy: number) => ({
      x: Math.max(0, Math.min(STAGE_W, (cx - box.left) / scale)),
      y: Math.max(0, Math.min(STAGE_H, (cy - box.top) / scale)),
    });
    const start = toStage(e.clientX, e.clientY);
    let cur = start;
    const rectOf = (): Rect => ({
      x: Math.min(start.x, cur.x),
      y: Math.min(start.y, cur.y),
      w: Math.abs(cur.x - start.x),
      h: Math.abs(cur.y - start.y),
    });
    const move = (ev: PointerEvent) => {
      cur = toStage(ev.clientX, ev.clientY);
      setVisualRect(rectOf());
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const r = rectOf();
      setVisualRect(null);
      if (r.w > 8 && r.h > 8) void captureRegion(stageEl, r);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The CSS transform is visual-only and does not shrink the layout box, so the
  // sizer reserves the *scaled* footprint. This keeps the stage centered and
  // overflow-free at any browser zoom (magnitude).
  return (
    <div ref={wrapRef} className="stage-wrap">
      <div
        className="stage-sizer"
        style={{ width: STAGE_W * scale, height: STAGE_H * scale }}
      >
        <div
          ref={stageRef}
          className="stage"
          style={{
            width: STAGE_W,
            height: STAGE_H,
            background: theme.colors.bg,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          onPointerDown={onStageDown}
        >
          <SelectionContext.Provider value={selection}>
            {elements.map((e, i) => (
              <ElementView
                key={i}
                e={e}
                slideId={slide.id}
                scale={scale}
                ctxSelected={mode === "select" && claudeSel.keys.includes(e.key)}
              />
            ))}
          </SelectionContext.Provider>
          {selection.marquee && (
            <div
              className="marquee"
              style={{
                left: selection.marquee.x,
                top: selection.marquee.y,
                width: selection.marquee.w,
                height: selection.marquee.h,
              }}
            />
          )}
          {visualRect && (
            <div
              className="visual-rect"
              style={{ left: visualRect.x, top: visualRect.y, width: visualRect.w, height: visualRect.h }}
            />
          )}
          {/* Alignment guides (inches -> unscaled stage px). An x-guide is a thin
              vertical line at `at` spanning start..end; a y-guide the horizontal
              counterpart. Drawn inside the scaled stage, like the marquee. */}
          {selection.guides.map((g, i) =>
            g.axis === "x" ? (
              <div
                key={i}
                className="snap-guide snap-guide-x"
                style={{ left: g.at * PX_PER_IN, top: g.start * PX_PER_IN, height: (g.end - g.start) * PX_PER_IN }}
              />
            ) : (
              <div
                key={i}
                className="snap-guide snap-guide-y"
                style={{ top: g.at * PX_PER_IN, left: g.start * PX_PER_IN, width: (g.end - g.start) * PX_PER_IN }}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

export const STAGE = { w: STAGE_W, h: STAGE_H };

// Rasterize the stage (at native 1280x720, CSS scale neutralized) and crop to the
// region (unscaled stage px) into a PNG, then hand it to the chat path. 2x pixel
// ratio so small regions stay legible for the model.
async function captureRegion(stageEl: HTMLElement, r: Rect): Promise<void> {
  const ratio = 2;
  try {
    const full = await htmlToImage.toCanvas(stageEl, {
      pixelRatio: ratio,
      width: STAGE_W,
      height: STAGE_H,
      style: { transform: "none", transformOrigin: "top left" },
    });
    const c = document.createElement("canvas");
    c.width = Math.round(r.w * ratio);
    c.height = Math.round(r.h * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(full, r.x * ratio, r.y * ratio, r.w * ratio, r.h * ratio, 0, 0, c.width, c.height);
    setPendingVisual({ dataUrl: c.toDataURL("image/png"), rect: r });
  } catch (err) {
    console.error("Visual capture failed", err);
  }
}

// Read the current native text selection as a TextSel, or null if it is collapsed,
// empty, or outside the stage. Locates the enclosing element (data-key) + deck
// field (data-source) and the char offset of the selection within the element.
function readTextSel(root: HTMLElement): TextSel | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const range = sel.getRangeAt(0);
  const ancEl = range.commonAncestorContainer.nodeType === 1
    ? (range.commonAncestorContainer as HTMLElement)
    : range.commonAncestorContainer.parentElement;
  const frame = ancEl?.closest(".el-frame[data-key]") as HTMLElement | null;
  if (!frame || !root.contains(frame)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(frame);
  try {
    pre.setEnd(range.startContainer, range.startOffset);
  } catch {
    /* start outside frame: leave offset at 0 */
  }
  const start = pre.toString().length;
  const startEl = range.startContainer.nodeType === 1
    ? (range.startContainer as HTMLElement)
    : range.startContainer.parentElement;
  const path = startEl?.closest("[data-source]")?.getAttribute("data-source") ?? undefined;
  return { elementKey: frame.getAttribute("data-key")!, path, text, start, end: start + text.length };
}
