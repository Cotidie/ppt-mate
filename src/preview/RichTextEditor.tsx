// In-place rich-text editor for a single deck field. Renders the field's runs;
// double-click enters edit mode with a TipTap single-paragraph editor and a
// floating BubbleMenu (B/I/U/color/highlight). Enter or blur commits the
// serialized Span[] to deck.json via /api/slides/edit; Escape discards.

import { useEffect, useState } from "react";
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
import { spansToDoc, docToSpans, type PMDoc } from "./richtext";

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
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span
        className="slide-editable"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
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
          onClose();
          return true;
        }
        return false;
      },
    },
  });

  function doCommit() {
    if (!editor) return;
    const next = docToSpans(editor.getJSON() as unknown as PMDoc);
    onClose();
    void commitSpans(slideId, path, next);
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
        >
          <b>B</b>
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive("italic") ? "on" : ""}
        >
          <i>I</i>
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={editor.isActive("underline") ? "on" : ""}
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
