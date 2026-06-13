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
import type { Span } from "../model/deck";
import { FOOTER_SOURCE } from "../model/deck";
import { spansToDoc, docToSpans, type PMDoc } from "./richtext";
import { useMode } from "./mode";

const COLOR = "#D64545";
const HIGHLIGHT = "#FFE08A";

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
      setFocused(false);
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

  return (
    <span
      className={
        "slide-editable" + (editable ? " editable" : "") + (focused ? " editing" : "")
      }
      onKeyDown={onKeyDown}
    >
      {editor && focused && (
        <BubbleMenu editor={editor} className="rt-bubble">
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
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(COLOR).run()}
            title="Text color"
          >
            A
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().unsetColor().run()}
            title="Clear color"
          >
            A&times;
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run()}
            className={editor.isActive("highlight") ? "on" : ""}
            title="Highlight"
          >
            H
          </button>
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
