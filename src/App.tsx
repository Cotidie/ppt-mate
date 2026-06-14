import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Deck } from "./model/deck";
import { SlideCanvas } from "./preview/SlideCanvas";
import { ChatDock } from "./preview/ChatDock";
import { Toolbox, type ZoomAction } from "./preview/Toolbox";
import { Settings } from "./preview/Settings";
import { FileExplorer } from "./preview/FileExplorer";
import { ModeContext, type Mode } from "./preview/mode";
import { reportContext } from "./preview/agentContext";
import deckJson from "../deck.json";

const deck = deckJson as Deck;

const RAIL_MIN = 120;
const RAIL_MAX = 480;
const RAIL_HIDE_AT = 60; // drag narrower than this and the rail snaps shut
const RAIL_KEY = "ppt.railWidth";

// Vertical split inside the rail: the file explorer's height (px) at the bottom,
// the slide thumbnails take the rest.
const SPLIT_MIN = 80;
const SPLIT_MAX = 600;
const SPLIT_KEY = "ppt.railSplit";

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

export default function App() {
  const [i, setI] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelEdit = useRef(false);
  const railWidth = useRailWidth();
  const railSplit = useRailSplit();
  const [mode, setMode] = useState<Mode>("edit");
  const [zoom, setZoom] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const slides = deck.slides;
  const clamp = (n: number) => Math.max(0, Math.min(slides.length - 1, n));

  const onZoom = (a: ZoomAction) =>
    setZoom((z) =>
      a === "fit" ? 1 : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + (a === "in" ? ZOOM_STEP : -ZOOM_STEP)))
    );

  const onExport = async (format: "pdf" | "pptx") => {
    setExporting(true);
    try {
      await exportDeck(format);
      setExportOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const startRename = (s: Deck["slides"][number]) => {
    setEditingId(s.id);
    setDraft(labelOf(s));
    cancelEdit.current = false;
  };

  // Single commit path: Enter and Escape both blur the input, so this fires once.
  const commitRename = async (s: Deck["slides"][number]) => {
    setEditingId(null);
    if (cancelEdit.current) return;
    if (draft.trim() === labelOf(s)) return; // unchanged
    await renameSlide(s.id, draft);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setI((p) => clamp(p + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setI((p) => clamp(p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  // Tell the agent which slide is active. Selection / selected-text / render facts
  // are owned and reported by SlideCanvas (it clears them on slide change).
  useEffect(() => {
    reportContext({ activeSlideId: slides[i].id });
  }, [i, slides]);

  return (
    <div className="app" style={{ "--rail-w": `${railWidth.value}px` } as CSSProperties}>
      <aside className="rail">
        {railWidth.value > 0 && (
          <>
            <div className="rail-slides">
              {slides.map((s, idx) => (
                <div className="thumb-row" key={s.id}>
                  {editingId === s.id ? (
                    <div className="thumb thumb-editing">
                      <span className="thumb-n">{idx + 1}</span>
                      <input
                        className="thumb-input"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") {
                            cancelEdit.current = true;
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={() => commitRename(s)}
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        className={"thumb" + (idx === i ? " active" : "")}
                        onClick={() => setI(idx)}
                        onDoubleClick={() => startRename(s)}
                        title="Double-click to rename"
                      >
                        <span className="thumb-n">{idx + 1}</span>
                        <span className="thumb-label">{labelOf(s)}</span>
                      </button>
                      <button
                        className="thumb-del"
                        title="Delete slide"
                        aria-label={`Delete slide ${idx + 1}`}
                        onClick={() => deleteSlide(s, slides.length)}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
            <div
              className={"rail-split" + (railSplit.dragging ? " dragging" : "")}
              role="separator"
              aria-orientation="horizontal"
              title="Drag to resize the file explorer"
              onPointerDown={railSplit.onDragStart}
            >
              <span className="resizer-grip resizer-grip-h" aria-hidden="true" />
            </div>
            <div className="rail-files" style={{ height: railSplit.value }}>
              <FileExplorer />
            </div>
          </>
        )}
      </aside>

      <div
        className={"rail-resizer" + (railWidth.dragging ? " dragging" : "")}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize — drag fully left to hide"
        onPointerDown={railWidth.onDragStart}
      >
        <span className="resizer-grip resizer-grip-v" aria-hidden="true" />
      </div>

      <main className="main">
        <ModeContext.Provider value={mode}>
          <div className="stage-region">
            <SlideCanvas slide={slides[i]} footerText={deck.meta.footer} zoom={zoom} />
            <Toolbox
              mode={mode}
              onMode={setMode}
              onZoom={onZoom}
              onResetPosition={() => resetLayout(slides[i].id)}
              exportOpen={exportOpen}
              onToggleExport={() => setExportOpen((o) => !o)}
              onExport={onExport}
              exporting={exporting}
              settingsOpen={settingsOpen}
              onToggleSettings={() => setSettingsOpen((o) => !o)}
            />
            <div className="hud">
              <button onClick={() => setI((p) => clamp(p - 1))} disabled={i === 0}>
                ‹
              </button>
              <span>
                {i + 1} / {slides.length} · {deck.slides[i].layout}
              </span>
              <button onClick={() => setI((p) => clamp(p + 1))} disabled={i === slides.length - 1}>
                ›
              </button>
            </div>
          </div>
        </ModeContext.Provider>
        <ChatDock />
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// Drag-resizable rail width. Snaps to 0 (hidden) when dragged past the left edge,
// otherwise clamps to [RAIL_MIN, RAIL_MAX]. Persisted across reloads.
function useRailWidth() {
  const [value, setValue] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, String(value));
  }, [value]);

  const onDragStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => setValue(snapWidth(ev.clientX));
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { value, dragging, onDragStart };
}

function readStoredWidth(): number {
  const raw = localStorage.getItem(RAIL_KEY);
  return raw === null ? 200 : snapWidth(Number(raw));
}

function snapWidth(px: number): number {
  if (px < RAIL_HIDE_AT) return 0;
  return Math.max(RAIL_MIN, Math.min(RAIL_MAX, px));
}

// Drag-resizable file-explorer height inside the rail. The explorer is at the
// bottom, so dragging the splitter sets height = viewport bottom minus pointer Y.
// Clamped to [SPLIT_MIN, SPLIT_MAX]; persisted across reloads.
function useRailSplit() {
  const [value, setValue] = useState(readStoredSplit);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    localStorage.setItem(SPLIT_KEY, String(value));
  }, [value]);

  const onDragStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => setValue(snapSplit(window.innerHeight - ev.clientY));
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { value, dragging, onDragStart };
}

function readStoredSplit(): number {
  const raw = localStorage.getItem(SPLIT_KEY);
  return raw === null ? 220 : snapSplit(Number(raw));
}

function snapSplit(px: number): number {
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, px));
}

function richTextToPlain(rt: import("./model/deck").RichText): string {
  return rt.map((span) => span.text).join("");
}

function labelOf(s: Deck["slides"][number]): string {
  return s.navLabel ?? richTextToPlain(s.title);
}

// Persists a sidebar-only rename to deck.json; the file write triggers Vite HMR,
// which reloads the preview with the new label. Does not touch slide content.
async function renameSlide(id: string, label: string): Promise<void> {
  const res = await fetch("/api/slides/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, label }),
  });
  if (!res.ok) alert("Rename failed. Is the dev server running?");
}

// Exports the deck via the dev server (rebuilds the pptx from current deck.json;
// PDF goes through headless LibreOffice). Streams the file back; we trigger a
// browser download from the blob.
async function exportDeck(format: "pdf" | "pptx"): Promise<void> {
  const res = await fetch(`/api/export?format=${format}`);
  if (!res.ok) {
    alert("Export failed. Is the dev server running?");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deck.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Clears all element geometry overrides on a slide (undo moves + resizes). The
// file write triggers Vite HMR, which reloads the preview with elements back at
// their computed position and size.
async function resetLayout(id: string): Promise<void> {
  const res = await fetch("/api/slides/reset-offsets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) alert("Reset failed. Is the dev server running?");
}

// Deletes a slide by persisting to deck.json; the file write triggers Vite HMR,
// which reloads the preview with the new deck. Blocked on the last slide so the
// deck is never left empty.
async function deleteSlide(slide: Deck["slides"][number], count: number): Promise<void> {
  if (count <= 1) {
    alert("Cannot delete the last slide.");
    return;
  }
  if (!confirm(`Delete slide "${richTextToPlain(slide.title)}"?`)) return;
  const res = await fetch("/api/slides/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: slide.id }),
  });
  if (!res.ok) alert("Delete failed. Is the dev server running?");
}
