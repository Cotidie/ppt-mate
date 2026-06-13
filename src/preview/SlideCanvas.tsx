// Fixed 1280x720 (16:9) print-accurate stage, scaled to fit its container.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Slide } from "../model/deck";
import { resolveSlide } from "../layout/resolve";
import { theme, PX_PER_IN } from "../theme/theme";
import { ElementView } from "./Element";
import { SelectionContext, useSelectionState } from "./selection";
import { useMode } from "./mode";

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
  const [fitScale, setFitScale] = useState(1);

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

  // A press that reaches the stage (not stopped by an element frame) is on empty
  // canvas: in move mode it rubber-bands a group selection.
  const onStageDown = (e: ReactPointerEvent) => {
    if (mode === "move") selection.beginMarquee(e, scale);
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
              <ElementView key={i} e={e} slideId={slide.id} scale={scale} />
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
