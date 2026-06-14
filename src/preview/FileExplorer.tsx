// Workspace file explorer for the lower left rail (VS Code-style). Renders the
// `files/` tree from GET /api/workspace via react-accessible-treeview, which owns
// the ARIA tree roles, keyboard navigation, selection, and expand/collapse state.
// We add basic management on top: a New Folder action and per-row rename, both
// with inline editing (the library has no built-in editor, so we render our own
// <input> inside the node - the library's recommended pattern). Filesystem
// mutations are server-authoritative and sandboxed to files/.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import TreeView, { flattenTree, type INode, type NodeId } from "react-accessible-treeview";
import prettyBytes from "pretty-bytes";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
  children?: TreeNode[];
};

type Meta = { path: string; type: "dir" | "file"; size?: number };

function toInput(node: TreeNode): { name: string; metadata: Meta; children?: ReturnType<typeof toInput>[] } {
  return {
    name: node.name,
    metadata: { path: node.path, type: node.type, size: node.size },
    children: node.children?.map(toInput),
  };
}

// Parent folder of a workspace path ("" for a top-level item).
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function FileExplorer() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parent: string } | null>(null);
  const [selected, setSelected] = useState<Meta | null>(null);
  // Expansion is tracked by path (stable across refreshes / id reassignment),
  // then mapped to the library's node ids.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  const refresh = useCallback(() => {
    fetch("/api/workspace")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((t: TreeNode) => {
        setTree(t);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const roots = tree?.children ?? [];
  const data = useMemo(() => flattenTree({ name: "", children: roots.map(toInput) }), [tree]);

  // Seed expansion with the top-level folders once, after the first load.
  useEffect(() => {
    if (seeded.current || roots.length === 0) return;
    seeded.current = true;
    setExpandedPaths(new Set(roots.filter((n) => n.type === "dir").map((n) => n.path)));
  }, [roots]);

  const pathOf = (n: INode): string | undefined => (n.metadata as Meta | undefined)?.path;
  const expandedIds = useMemo<NodeId[]>(
    () => data.filter((n) => { const p = pathOf(n); return p != null && expandedPaths.has(p); }).map((n) => n.id),
    [data, expandedPaths],
  );

  const setExpanded = (path: string, open: boolean) =>
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  // New Folder destination from the current selection: a folder -> inside it; a
  // file -> its parent; nothing -> the workspace root.
  const newFolderParent = (): string => {
    if (!selected) return "";
    return selected.type === "dir" ? selected.path : dirOf(selected.path);
  };

  const beginNewFolder = () => {
    setError(null);
    setEditingPath(null);
    setCreating({ parent: newFolderParent() });
  };

  const commitNewFolder = async (name: string) => {
    const parent = creating?.parent ?? "";
    setCreating(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    const msg = await mkdirFolder(parent, trimmed);
    if (msg) { setError(msg); return; }
    setError(null);
    if (parent) setExpanded(parent, true);
    refresh();
  };

  const commitRename = async (path: string, name: string) => {
    setEditingPath(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    const msg = await renameEntry(path, trimmed);
    if (msg) { setError(msg); setEditingPath(path); return; } // keep editing on error
    setError(null);
    refresh();
  };

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="files-title">Workspace</span>
        <span className="files-actions">
          <button className="files-action" title="New folder" aria-label="New folder" onClick={beginNewFolder}>
            <NewFolderIcon />
          </button>
          <button className="files-action" title="Refresh" aria-label="Refresh workspace" onClick={refresh}>
            ⟳
          </button>
        </span>
      </div>
      {error && (
        <div className="files-error" role="alert" onClick={() => setError(null)} title="Dismiss">
          {error}
        </div>
      )}
      <div className="files-body rail-files-drop">
        {creating && (
          <NameInput
            className="files-new-row"
            placeholder="New folder name"
            initial=""
            onCommit={commitNewFolder}
            onCancel={() => setCreating(null)}
          />
        )}
        {loadError ? (
          <div className="files-empty">Workspace unavailable</div>
        ) : roots.length === 0 && !creating ? (
          <div className="files-empty">No files yet</div>
        ) : (
          <TreeView
            data={data}
            className="files-tree"
            aria-label="Workspace files"
            expandedIds={expandedIds}
            onNodeSelect={({ element, isSelected }) =>
              setSelected(isSelected ? (element.metadata as Meta) : null)
            }
            onExpand={({ element, isExpanded }) => {
              const p = pathOf(element);
              if (p != null) setExpanded(p, isExpanded);
            }}
            nodeRenderer={({ element, isExpanded, getNodeProps, level }) => (
              <FileRow
                element={element}
                isExpanded={isExpanded}
                level={level}
                getNodeProps={getNodeProps}
                editing={editingPath === pathOf(element)}
                onOpen={openFile}
                onBeginRename={(path) => { setError(null); setCreating(null); setEditingPath(path); }}
                onCommitRename={commitRename}
                onCancelRename={() => setEditingPath(null)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

function FileRow({
  element,
  isExpanded,
  level,
  getNodeProps,
  editing,
  onOpen,
  onBeginRename,
  onCommitRename,
  onCancelRename,
}: {
  element: INode;
  isExpanded: boolean;
  level: number;
  getNodeProps: () => React.HTMLAttributes<HTMLDivElement>;
  editing: boolean;
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
      className={"files-row " + (isDir ? "files-dir" : "files-file")}
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
      {meta?.type === "dir" ? (
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
function NameInput({
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

function FileIcon() {
  return (
    <svg className="files-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5L13 5.5v8.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5a.5.5 0 00.5.5H13" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.5 4.5l1-1.5h3l1 1.5h6a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1v-6z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M11 7v3M9.5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// --- server calls (return an error string, or null on success) ---

function openFile(path: string): void {
  fetch("/api/workspace/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}

async function mkdirFolder(parent: string, name: string): Promise<string | null> {
  return post("/api/workspace/mkdir", { parent, name });
}

async function renameEntry(path: string, name: string): Promise<string | null> {
  return post("/api/workspace/rename", { path, name });
}

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.error ?? "Request failed.";
  } catch {
    return "Dev server unavailable.";
  }
}
