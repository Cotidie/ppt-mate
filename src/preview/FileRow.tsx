// One workspace tree row, plus the inline name editor it shares with the
// New Folder flow. The library has no built-in editor, so we render our own
// <input> inside the node (its recommended pattern).

import { useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { INode } from "react-accessible-treeview";
import prettyBytes from "pretty-bytes";
import { type Meta } from "./workspaceTree";
import { FileIcon, PencilIcon } from "./fileIcons";

export function FileRow({
  element,
  isExpanded,
  level,
  getNodeProps,
  editing,
  dragHandlers,
  isDropTarget,
  onOpen,
  onBeginRename,
  onCommitRename,
  onCancelRename,
}: {
  element: INode;
  isExpanded: boolean;
  level: number;
  getNodeProps: () => HTMLAttributes<HTMLDivElement>;
  editing: boolean;
  dragHandlers?: {
    onDragOver: (e: ReactDragEvent) => void;
    onDragLeave: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
  };
  isDropTarget?: boolean;
  onOpen: (path: string) => void;
  onBeginRename: (path: string) => void;
  onCommitRename: (path: string, name: string) => void;
  onCancelRename: () => void;
}) {
  const meta = element.metadata as Meta | undefined;
  const path = meta?.path ?? "";
  const isDir = meta?.type === "dir";
  const baseTitle = meta ? path + (meta.size != null ? ` · ${prettyBytes(meta.size)}` : "") : element.name;
  const title = isDir ? baseTitle : `${baseTitle} — double-click to open`;
  return (
    <div
      {...getNodeProps()}
      {...dragHandlers}
      className={
        "files-row " + (isDir ? "files-dir" : "files-file") + (isDropTarget ? " drop-target" : "")
      }
      style={{ paddingLeft: 8 + (level - 1) * 12 }}
      title={editing ? undefined : title}
      data-path={path}
      onDoubleClick={() => {
        if (!editing && !isDir && path) onOpen(path);
      }}
      // F2 renames the focused row (VS Code convention) for keyboard users.
      onKeyDown={(e) => {
        if (e.key === "F2" && path) {
          e.preventDefault();
          e.stopPropagation();
          onBeginRename(path);
        }
      }}
    >
      {/* Folder vs file by the authoritative type, not isBranch (which is false for
          an EMPTY folder, making it look like a file). Folders get a foldable
          caret; files get a document icon. */}
      {isDir ? (
        <span className={"files-caret" + (isExpanded ? " open" : "")} aria-hidden="true">›</span>
      ) : (
        <FileIcon />
      )}
      {editing ? (
        <NameInput
          className="files-edit"
          initial={element.name}
          onCommit={(name) => onCommitRename(path, name)}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <span className="files-name">{element.name}</span>
          {/* Rename pencil at the row's far right; revealed on row hover or when
              the row (treeitem) has keyboard focus (CSS). */}
          <button
            className="files-rename"
            title="Rename"
            aria-label={`Rename ${element.name}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onBeginRename(path);
            }}
          >
            <PencilIcon />
          </button>
        </>
      )}
    </div>
  );
}

// Inline name editor shared by New Folder and rename. Autofocuses, selects the
// base name (text before the extension). Enter commits, Escape/blur cancels via a
// single guarded path so a value is committed at most once.
export function NameInput({
  className,
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  className: string;
  initial: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? "";
    if (commit && value.trim() && value.trim() !== initial) onCommit(value);
    else onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep tree keyboard nav from stealing keystrokes
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };

  return (
    <input
      ref={ref}
      className={className}
      defaultValue={initial}
      placeholder={placeholder}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}
