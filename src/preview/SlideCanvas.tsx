// Fixed 1280x720 (16:9) print-accurate stage, scaled to fit its container.

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Moveable from "react-moveable";
import type { Slide } from "../model/deck";
import { resolveSlide } from "../layout/resolve";
import { theme, PX_PER_IN } from "../theme/theme";
import { ElementView } from "./Element";

const STAGE_W = theme.canvas.w * PX_PER_IN; // 1280
const STAGE_H = theme.canvas.h * PX_PER_IN; // 720

const SNAP_ALL = { top: true, left: true, bottom: true, right: true, center: true, middle: true };

export function SlideCanvas({ slide, footerText }: { slide: Slide; footerText: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const [scale, setScale] = useState(1);
  // The element currently being dragged. Set only for the duration of a drag so
  // the Moveable control box never overlays an idle element (which would block
  // double-click-to-edit).
  const [target, setTarget] = useState<HTMLElement | null>(null);

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

  // Start an instant drag on whichever element was pressed (delegated). Bail when
  // pressing inside an active editor so text selection / the toolbar keep the
  // pointer. flushSync applies the target synchronously so dragStart can attach
  // to this same pointerdown.
  const onStagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const node = (e.target as HTMLElement).closest<HTMLElement>("[data-elkey]");
    if (!node || (e.target as HTMLElement).closest(".slide-editable.editing")) return;
    flushSync(() => setTarget(node));
    moveableRef.current?.dragStart(e.nativeEvent);
  };

  const elements = resolveSlide(slide, theme, footerText);

  // Other elements act as snap guides for the dragged one.
  const guidelines =
    target && stageRef.current
      ? [...stageRef.current.querySelectorAll<HTMLElement>("[data-elkey]")].filter((n) => n !== target)
      : [];

  return (
    <div ref={wrapRef} className="stage-wrap">
      <div className="stage-sizer" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
        <div
          ref={stageRef}
          className="stage"
          onPointerDown={onStagePointerDown}
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

          <Moveable
            ref={moveableRef}
            target={target}
            draggable
            origin={false}
            snappable
            snapThreshold={6}
            snapDirections={SNAP_ALL}
            elementSnapDirections={SNAP_ALL}
            elementGuidelines={guidelines}
            verticalGuidelines={[STAGE_W / 2]}
            horizontalGuidelines={[STAGE_H / 2]}
            bounds={{ left: 0, top: 0, right: STAGE_W, bottom: STAGE_H, position: "css" }}
            onDrag={({ target: t, transform }) => {
              (t as HTMLElement).style.transform = transform;
            }}
            onDragEnd={({ target: t, lastEvent }) => {
              const node = t as HTMLElement;
              const key = node.dataset.elkey;
              const dist = lastEvent?.dist as [number, number] | undefined;
              if (key && dist && (dist[0] || dist[1])) {
                // Moveable reports the drag distance in the stage's own (unscaled)
                // pixels; convert straight to inches. HMR repaints with the new
                // offset and clears the inline transform.
                void commitMove(slide.id, key, dist[0] / PX_PER_IN, dist[1] / PX_PER_IN);
              }
              setTarget(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export const STAGE = { w: STAGE_W, h: STAGE_H };

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
