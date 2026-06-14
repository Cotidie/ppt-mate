// Drag-and-drop upload for the workspace explorer. Tracks which folder the
// cursor is hovering (the effective drop target: a folder -> itself, a file ->
// its parent, blank panel -> root "") and uploads the dropped OS files there.

import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { type Meta, dirOf } from "./workspaceTree";
import { uploadFiles } from "./workspaceApi";

type DropDeps = {
  refresh: () => void;
  setExpanded: (path: string, open: boolean) => void;
  setError: (msg: string | null) => void;
};

type DragHandlers = {
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
};

// True only for an OS file drag (ignore internal/text drags).
const draggingFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes("Files");

export function useWorkspaceDrop({ refresh, setExpanded, setError }: DropDeps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null); // effective folder, "" = root
  const [uploading, setUploading] = useState(false);

  const handlersFor = (target: string): DragHandlers => ({
    onDragOver: (e) => {
      if (!draggingFiles(e)) return;
      e.preventDefault();
      e.stopPropagation(); // a row wins over the panel root beneath it
      e.dataTransfer.dropEffect = "copy";
      setDropTarget(target);
    },
    onDragLeave: (e) => {
      // Only clear when the cursor actually leaves this element's subtree.
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
        setDropTarget((t) => (t === target ? null : t));
      }
    },
    onDrop: async (e) => {
      if (!draggingFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      setDropTarget(null);
      if (!files.length) return;
      setUploading(true);
      const err = await uploadFiles(target, files);
      setUploading(false);
      setError(err);
      refresh();
      if (!err && target) setExpanded(target, true); // reveal the new files
    },
  });

  // A folder drops into itself; a file drops into its parent.
  const rowHandlers = (meta: Meta): DragHandlers =>
    handlersFor(meta.type === "dir" ? meta.path : dirOf(meta.path));

  const bodyHandlers = handlersFor("");

  return { dropTarget, uploading, rowHandlers, bodyHandlers };
}
