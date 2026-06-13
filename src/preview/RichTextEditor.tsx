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

export function RichTextEditor({
  slideId,
  path,
  spans,
}: {
  slideId: string;
  path: string;
  spans: Span[];
}) {
  const mode = useMode();
  const editable = mode === "edit";
  const [focused, setFocused] = useState(false);
  // Which color picker is open in the bubble ("text" | "highlight" | none).
  const [picker, setPicker] = useState<"text" | "highlight" | null>(null);
  // The hex the picker UI currently shows (controlled value for react-colorful).
  const [draft, setDraft] = useState("#000000");
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

  const editor = useEditor({
    extensions: [
      OneLineDocument,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: spansToDoc(spans),
    editable,
    onFocus: () => setFocused(true),
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

  // Pull external changes (HMR after a commit, or the chat agent editing
  // deck.json) into the editor - but never while the user is typing in it, and
  // never when the incoming value already matches what's shown.
  const incoming = JSON.stringify(spansToDoc(spans));
  useEffect(() => {
    if (!editor || focused) return;
    if (incoming === synced.current) return;
    editor.commands.setContent(JSON.parse(incoming) as PMDoc, { emitUpdate: false });
    synced.current = incoming;
  }, [editor, incoming, focused]);

  // A mousedown outside the bubble while a picker is open means the user is done:
  // close it and commit (the onBlur guard suppresses the normal commit path).
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) finishPicker();
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

  // Close because the user clicked outside the bubble: finish editing + commit.
  function finishPicker() {
    pickerOpenRef.current = false;
    setPicker(null);
    setFocused(false);
    commit();
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
