// Fixed 1280x720 (16:9) print-accurate stage, scaled to fit its container.

import { useEffect, useRef, useState } from "react";
import type { Slide } from "../model/deck";
import { resolveSlide } from "../layout/resolve";
import { theme, PX_PER_IN } from "../theme/theme";
import { ElementView } from "./Element";

const STAGE_W = theme.canvas.w * PX_PER_IN; // 1280
const STAGE_H = theme.canvas.h * PX_PER_IN; // 720

export function SlideCanvas({ slide, footerText }: { slide: Slide; footerText: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const s = Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H);
      setScale(s);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const elements = resolveSlide(slide, theme, footerText);

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
        >
          {elements.map((e, i) => (
            <ElementView key={i} e={e} slideId={slide.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const STAGE = { w: STAGE_W, h: STAGE_H };
