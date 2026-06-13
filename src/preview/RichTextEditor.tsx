// In-place rich-text editor for a single deck field. The TipTap editor is always
// mounted, rendering the field's runs; it is editable only in "edit" mode, so a
// click lands the caret natively where pressed and a drag selects natively - no
// selection has to be carried across a read->edit DOM swap. Enter (or blur)
// commits the serialized Span[] to deck.json via /api/slides/edit; Escape
// reverts to the last committed value.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { HexColorPicker, HexColorInput } from "react-colorful";
import type { Span } from "../model/deck";
import { FOOTER_SOURCE } from "../model/deck";
import { spansToDoc, docToSpans, type PMDoc } from "./richtext";
import { useMode } from "./mode";

// Swatch palettes for the bubble's color controls. The first entry (v: null) is
// the reset: Default removes the text color, None removes the highlight.
type Swatch = { v: string | null; title: string };
const TEXT_SWATCHES: Swatch[] = [
  { v: null, title: "Default" },
  { v: "#1A1A2E", title: "Ink" },
  { v: "#D64545", title: "Red" },
  { v: "#E8893D", title: "Orange" },
  { v: "#2E9E5B", title: "Green" },
  { v: "#3B6FD4", title: "Blue" },
  { v: "#7048E8", title: "Purple" },
];
const HIGHLIGHT_SWATCHES: Swatch[] = [
  { v: null, title: "None" },
  { v: "#FFE08A", title: "Yellow" },
  { v: "#B7E4C7", title: "Green" },
  { v: "#A5D8FF", title: "Blue" },
  { v: "#FFC9C9", title: "Pink" },
  { v: "#E5DBFF", title: "Lavender" },
];

// Single-paragraph schema: no hard breaks, so Enter is free to commit.
const OneLineDocument = Document.extend({ content: "paragraph" });

const PT_PX = 96 / 72;
const SIZE_STEP = 2;
const SIZE_MIN = 8;
const SIZE_MAX = 160;

export function RichTextEditor({
  slideId,
  path,
  spans,
  defaultSize = 18,
}: {
  slideId: string;
  path: string;
  spans: Span[];
  defaultSize?: number; // pt the field falls back to when a run has no explicit size
}) {
  const mode = useMode();
  const editable = mode === "edit";
  const [focused, setFocused] = useState(false);
  // Which color picker is open in the bubble ("text" | "highlight" | none).
  const [picker, setPicker] = useState<"text" | "highlight" | null>(null);
  // The hex the picker UI currently shows (controlled value for react-colorful).
  const [draft, setDraft] = useState("#000000");
  // Text typed into the size field while it has focus; null shows the live size.
  const [sizeField, setSizeField] = useState<string | null>(null);
  // Synchronous mirror of `picker` for the onBlur guard, the selection to apply
  // colors to (the picker steals DOM focus, so we operate on a saved range), and
  // a ref to the bubble for outside-click detection.
  const pickerOpenRef = useRef(false);
  const savedSel = useRef<{ from: number; to: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // The last value this editor is in sync with, as a normalized doc-JSON string.
  // Guards both directions: skip a no-op commit, and skip clobbering the editor
  // with an incoming prop that already matches what it shows.
  const synced = useRef(JSON.stringify(spansToDoc(spans)));
  // True from the moment we commit an edit until the committed value echoes back
  // through props (server write -> HMR). While awaiting, the `spans` prop still
  // holds the STALE pre-commit value; without this hold the sync effect would
  // briefly setContent that stale value and visibly revert the just-made edit.
  const awaitingCommit = useRef(false);

  const editor = useEditor({
    extensions: [
      OneLineDocument,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: spansToDoc(spans),
    editable,
    onFocus: () => {
      // Re-entering the editor ends any pending commit-hold: the user is the
      // source of truth again (and it guards against a hold sticking if a route
      // normalizes the value so props never echo it byte-for-byte, e.g. footer).
      awaitingCommit.current = false;
      setFocused(true);
    },
    onBlur: () => {
      // While a color picker is open it owns focus; ignore this blur so the
      // bubble stays mounted and we don't commit mid-interaction.
      if (pickerOpenRef.current) return;
      setFocused(false);
      setPicker(null);
      commit();
    },
  });

  // Mode drives editability; toggling is a deliberate toolbar action, never
  // mid-gesture, so there is no selection race.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Re-render when the editor state changes (selection / marks) so the bubble's
  // live readouts - active B/I/U, current color, current font size - stay in
  // sync. Without this, values read from editor.getAttributes go stale and the
  // size stepper would step from a frozen base.
  const [, bumpRender] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => bumpRender((n) => n + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  // Pull external changes (the chat agent editing deck.json) into the editor -
  // but never while the user is typing in it, and never when it already matches.
  // The optimistic-hold rule mirrors the geometry gesture: our own committed
  // value is authoritative until props catch up, so a lagging stale prop can't
  // revert the edit. Only a prop that differs from `synced` while we are NOT
  // awaiting our own commit is a genuine external change worth applying.
  const incoming = JSON.stringify(spansToDoc(spans));
  useEffect(() => {
    if (!editor || focused) return;
    if (incoming === synced.current) {
      awaitingCommit.current = false; // props caught up to our commit; release hold
      return;
    }
    if (awaitingCommit.current) return; // props still lagging our own edit; hold
    editor.commands.setContent(JSON.parse(incoming) as PMDoc, { emitUpdate: false });
    synced.current = incoming;
  }, [editor, incoming, focused]);

  // A mousedown outside the bubble while a picker is open means the user is done:
  // close it and commit (the onBlur guard suppresses the normal commit path).
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) finishPicker(e.target as Node);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [picker]);

  function commit() {
    if (!editor) return;
    const next = docToSpans(editor.getJSON() as unknown as PMDoc);
    const nextJSON = JSON.stringify(spansToDoc(next));
    if (nextJSON === synced.current) return; // unchanged
    synced.current = nextJSON;
    awaitingCommit.current = true; // hold the edit until props echo it back (HMR)
    // The footer is the deck-wide meta string, not a slide field: flatten the
    // edited runs to plain text and commit it via its own route.
    if (path === FOOTER_SOURCE) void commitFooter(next);
    else void commitSpans(slideId, path, next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Focus is inside the editor, so swallow keys here: keeps arrows/PageUp from
    // flipping slides while typing (App's nav listener is on window).
    e.stopPropagation();
    if (!editor) return;
    if (e.key === "Enter") {
      e.preventDefault();
      editor.commands.blur(); // single-paragraph schema; blur is the commit path
    } else if (e.key === "Escape") {
      e.preventDefault();
      editor.commands.setContent(JSON.parse(synced.current) as PMDoc, { emitUpdate: false });
      editor.commands.blur();
    }
  }

  // --- Color pickers -------------------------------------------------------
  // The picker UI lives outside the editor and steals DOM focus, so we snapshot
  // the selection on open and apply colors to that saved range (no .focus()).

  function openPicker(kind: "text" | "highlight") {
    if (!editor) return;
    if (picker === kind) return closePicker(); // toggle off
    const { from, to } = editor.state.selection;
    savedSel.current = { from, to };
    const cur = (kind === "text"
      ? editor.getAttributes("textStyle").color
      : editor.getAttributes("highlight").color) as string | undefined;
    setDraft(cur ?? (kind === "text" ? "#1A1A2E" : "#FFE08A"));
    pickerOpenRef.current = true;
    setPicker(kind);
  }

  function applyHex(hex: string) {
    setDraft(hex);
    const s = savedSel.current;
    if (!editor || !s) return;
    const chain = editor.chain().setTextSelection(s);
    if (picker === "highlight") chain.setHighlight({ color: hex }).run();
    else chain.setColor(hex).run();
  }

  function resetCurrent() {
    const s = savedSel.current;
    if (editor && s) {
      const chain = editor.chain().setTextSelection(s);
      if (picker === "highlight") chain.unsetHighlight().run();
      else chain.unsetColor().run();
    }
    // Stay open so the user can keep trying colors; close via the A/H toggle or
    // by clicking outside the bubble.
  }

  // Close from inside the bubble: keep editing (refocus the saved range).
  function closePicker() {
    pickerOpenRef.current = false;
    setPicker(null);
    const s = savedSel.current;
    if (editor && s) editor.chain().setTextSelection(s).focus().run();
  }

  // A mousedown outside the bubble closes the picker. If it landed back inside
  // this editor (the user is re-selecting text), keep editing so the bubble
  // re-shows for the new selection - the editor never lost DOM focus, so we must
  // NOT force `focused` false here or `onFocus` won't fire to restore it. Only
  // when focus truly leaves the editor do we finalize (commit + blur).
  function finishPicker(target: Node) {
    pickerOpenRef.current = false;
    setPicker(null);
    if (editor && editor.view.dom.contains(target)) return; // re-selecting; keep editing
    setFocused(false);
    commit();
  }

  // --- Font size -----------------------------------------------------------
  // The current selection's size in pt: its run's fontSize mark, else the field
  // default (paragraph/element size).
  const fontSizeAttr = editor?.getAttributes("textStyle").fontSize as string | undefined;
  const currentSize = fontSizeAttr ? Math.round(parseFloat(fontSizeAttr) / PT_PX) : defaultSize;

  // Apply to the live selection (buttons keep editor focus via preventDefault).
  function applySize(pt: number) {
    if (!editor) return;
    const clamped = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(pt)));
    editor.chain().focus().setFontSize(`${clamped * PT_PX}px`).run();
  }

  // The size <input> steals focus, so it saves the selection on focus (like the
  // color hex field) and applies to that saved range; blur refocuses it.
  function applySizeToSaved(pt: number) {
    const s = savedSel.current;
    if (!editor || !s) return;
    const clamped = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(pt)));
    editor.chain().setTextSelection(s).setFontSize(`${clamped * PT_PX}px`).run();
  }

  return (
    <span
      className={
        "slide-editable" + (editable ? " editable" : "") + (focused ? " editing" : "")
      }
      onKeyDown={onKeyDown}
    >
      {editor && focused && (
        <BubbleMenu
          editor={editor}
          className="rt-bubble"
          shouldShow={({ editor: ed }) =>
            pickerOpenRef.current || (ed.isFocused && !ed.state.selection.empty)
          }
        >
          <div ref={bubbleRef} style={{ display: "contents" }}>
            <div className="rt-row">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={editor.isActive("bold") ? "on" : ""}
                title="Bold"
              >
                <b>B</b>
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={editor.isActive("italic") ? "on" : ""}
                title="Italic"
              >
                <i>I</i>
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                className={editor.isActive("underline") ? "on" : ""}
                title="Underline"
              >
                <u>U</u>
              </button>
              <span className="rt-sep" />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openPicker("text")}
                className={picker === "text" ? "on" : ""}
                title="Font color"
              >
                <span
                  className="rt-glyph"
                  style={{ borderBottom: `3px solid ${editor.getAttributes("textStyle").color ?? "transparent"}` }}
                >
                  A
                </span>
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openPicker("highlight")}
                className={picker === "highlight" ? "on" : ""}
                title="Highlight color"
              >
                <span
                  className="rt-glyph"
                  style={{ borderBottom: `3px solid ${editor.getAttributes("highlight").color ?? "transparent"}` }}
                >
                  H
                </span>
              </button>
              <span className="rt-sep" />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySize(currentSize - SIZE_STEP)}
                title="Decrease font size"
              >
                −
              </button>
              <input
                className="rt-size-input"
                type="text"
                inputMode="numeric"
                value={sizeField ?? String(currentSize)}
                title="Font size (pt)"
                onChange={(e) => {
                  setSizeField(e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) applySizeToSaved(n);
                }}
                onFocus={() => {
                  if (editor) {
                    const { from, to } = editor.state.selection;
                    savedSel.current = { from, to };
                  }
                  pickerOpenRef.current = true;
                  setSizeField(String(currentSize));
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={() => {
                  setSizeField(null);
                  closePicker(); // clears the focus guard + refocuses the saved range
                }}
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySize(currentSize + SIZE_STEP)}
                title="Increase font size"
              >
                +
              </button>
            </div>
            {picker && (
              <div className="rt-picker">
                <HexColorPicker color={draft} onChange={applyHex} />
                <div className="rt-picker-row">
                  {/* HexColorInput onChange yields the hex without '#'. */}
                  <HexColorInput className="rt-hex" color={draft} prefixed onChange={(h) => applyHex("#" + h)} />
                  <button
                    className="rt-reset-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={resetCurrent}
                  >
                    {picker === "text" ? "Default" : "None"}
                  </button>
                </div>
                <div className="rt-swatches">
                  {(picker === "text" ? TEXT_SWATCHES : HIGHLIGHT_SWATCHES)
                    .filter((s) => s.v)
                    .map((s) => (
                      <button
                        key={s.v}
                        className="rt-swatch"
                        style={{ background: s.v as string }}
                        title={s.title}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyHex(s.v as string)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </span>
  );
}

async function commitSpans(id: string, path: string, value: Span[]): Promise<void> {
  const res = await fetch("/api/slides/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, path, value }),
  });
  if (!res.ok) alert("Edit failed. Is the dev server running?");
}

// The deck footer is a single meta string rendered on every slide. Commit it as
// plain text (footer carries no marks) to its own route, which rewrites
// deck.meta.footer and reloads all slides.
async function commitFooter(value: Span[]): Promise<void> {
  const text = value.map((s) => s.text).join("");
  const res = await fetch("/api/footer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: text }),
  });
  if (!res.ok) alert("Footer edit failed. Is the dev server running?");
}
