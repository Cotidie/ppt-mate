// In-place rich-text editor for a single deck field. Renders the field's runs;
// a single click (in edit mode) enters edit mode with a TipTap single-paragraph
// editor and a floating BubbleMenu (B/I/U/color/highlight). Enter or blur commits
// the serialized Span[] to deck.json via /api/slides/edit; Escape discards.

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
  children,
}: {
  slideId: string;
  path: string;
  spans: Span[];
  children: React.ReactNode; // read-only run rendering, shown when not editing
}) {
  const mode = useMode();
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span
        className={"slide-editable" + (mode === "edit" ? " editable" : "")}
        onClick={() => {
          if (mode !== "edit") return; // strict modes: only edit in edit mode
          setEditing(true);
        }}
        title={mode === "edit" ? "Click to edit" : undefined}
      >
        {children}
      </span>
    );
  }
  return (
    <EditorInstance
      slideId={slideId}
      path={path}
      spans={spans}
      onClose={() => setEditing(false)}
    />
  );
}

function EditorInstance({
  slideId,
  path,
  spans,
  onClose,
}: {
  slideId: string;
  path: string;
  spans: Span[];
  onClose: () => void;
}) {
  // Guards the field against more than one finalize. Enter, blur, and a
  // post-close blur can all race; whichever lands first wins, the rest no-op.
  // It also makes Escape a true discard: a trailing blur after Escape sees the
  // field already finalized and never commits.
  const finalized = useRef(false);

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
    autofocus: "end",
    immediatelyRender: true,
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === "Enter") {
          event.preventDefault();
          // Defer so the editor state is fully settled before commit reads it.
          setTimeout(doCommit, 0);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          discard();
          return true;
        }
        return false;
      },
    },
  });

  function doCommit() {
    if (finalized.current || !editor || editor.isDestroyed) return;
    finalized.current = true;
    const next = docToSpans(editor.getJSON() as unknown as PMDoc);
    onClose();
    // The footer is the deck-wide meta string, not a slide field: flatten the
    // edited runs to plain text and commit it via its own route.
    if (path === FOOTER_SOURCE) void commitFooter(next);
    else void commitSpans(slideId, path, next);
  }

  function discard() {
    if (finalized.current) return;
    finalized.current = true;
    onClose();
  }

  // Keep arrow keys from flipping slides while the editor is focused.
  useEffect(() => {
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, []);

  if (!editor) return null;

  return (
    <span className="slide-editable editing">
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
          onClick={() =>
            editor.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run()
          }
          className={editor.isActive("highlight") ? "on" : ""}
          title="Highlight"
        >
          H
        </button>
      </BubbleMenu>
      <EditorContent editor={editor} onBlur={doCommit} />
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
