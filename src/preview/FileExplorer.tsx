// Workspace file explorer for the lower left rail (VS Code-style). Renders the
// `files/` tree from GET /api/workspace as a collapsible nested list. Read-only
// for now: clicking a file is a stub for a future preview, and the body carries a
// stable drop-target class for future drag-and-drop uploads.

import { useCallback, useEffect, useState } from "react";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
  children?: TreeNode[];
  truncated?: boolean;
};

export function FileExplorer() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/workspace")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((t: TreeNode) => {
        setTree(t);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const roots = tree?.children ?? [];

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="files-title">Workspace</span>
        <button className="files-refresh" title="Refresh" aria-label="Refresh workspace" onClick={refresh}>
          ⟳
        </button>
      </div>
      {/* Body is the future drag-and-drop upload target (class is stable; no
          handlers wired yet). */}
      <div className="files-body rail-files-drop">
        {error ? (
          <div className="files-empty">Workspace unavailable</div>
        ) : roots.length === 0 ? (
          <div className="files-empty">No files yet</div>
        ) : (
          roots.map((n) => <Node key={n.path} node={n} depth={0} />)
        )}
      </div>
    </div>
  );
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1); // top level expanded by default
  const pad = { paddingLeft: 8 + depth * 12 } as const;

  if (node.type === "dir") {
    return (
      <div>
        <button className="files-row files-dir" style={pad} onClick={() => setOpen((o) => !o)}>
          <span className={"files-caret" + (open ? " open" : "")}>›</span>
          <span className="files-name">{node.name}</span>
        </button>
        {open && node.children?.map((c) => <Node key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <button
      className="files-row files-file"
      style={pad}
      data-path={node.path}
      title={node.path + (node.size != null ? ` · ${fmtBytes(node.size)}` : "")}
      // Future: open a preview pane for this file (read_workspace_file).
      onClick={() => {}}
    >
      <span className="files-icon" aria-hidden="true" />
      <span className="files-name">{node.name}</span>
    </button>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
