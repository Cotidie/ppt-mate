// Workspace file explorer for the lower left rail (VS Code-style). Renders the
// `files/` tree from GET /api/workspace. The tree widget itself is
// react-accessible-treeview, which provides the ARIA tree roles, keyboard
// navigation, and expand/collapse state - we only supply the data and a row
// renderer. Read-only for now: a file click is a stub for a future preview, and
// the body carries a stable drop-target class for future drag-and-drop uploads.

import { useCallback, useEffect, useMemo, useState } from "react";
import TreeView, { flattenTree, type INode } from "react-accessible-treeview";
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

// Map our server tree into the {name, children, metadata} shape flattenTree wants.
function toInput(node: TreeNode): { name: string; metadata: Meta; children?: ReturnType<typeof toInput>[] } {
  return {
    name: node.name,
    metadata: { path: node.path, type: node.type, size: node.size },
    children: node.children?.map(toInput),
  };
}

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
  // flattenTree always emits a (hidden) root as element 0; the visible items are
  // its children. Expand the top-level folders by default.
  const data = useMemo(() => flattenTree({ name: "", children: roots.map(toInput) }), [tree]);
  const defaultExpandedIds = useMemo(
    () => data.filter((n) => n.parent === 0 && n.children.length > 0).map((n) => n.id),
    [data],
  );

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
          <TreeView
            data={data}
            className="files-tree"
            aria-label="Workspace files"
            defaultExpandedIds={defaultExpandedIds}
            nodeRenderer={({ element, isBranch, isExpanded, getNodeProps, level }) => (
              <FileRow element={element} isBranch={isBranch} isExpanded={isExpanded} level={level} getNodeProps={getNodeProps} />
            )}
          />
        )}
      </div>
    </div>
  );
}

function FileRow({
  element,
  isBranch,
  isExpanded,
  level,
  getNodeProps,
}: {
  element: INode;
  isBranch: boolean;
  isExpanded: boolean;
  level: number;
  getNodeProps: () => React.HTMLAttributes<HTMLDivElement>;
}) {
  const meta = element.metadata as Meta | undefined;
  const title = meta ? meta.path + (meta.size != null ? ` · ${prettyBytes(meta.size)}` : "") : element.name;
  return (
    <div
      {...getNodeProps()}
      className={"files-row " + (isBranch ? "files-dir" : "files-file")}
      style={{ paddingLeft: 8 + (level - 1) * 12 }}
      title={title}
      data-path={meta?.path}
    >
      {isBranch ? (
        <span className={"files-caret" + (isExpanded ? " open" : "")}>›</span>
      ) : (
        <span className="files-icon" aria-hidden="true" />
      )}
      <span className="files-name">{element.name}</span>
    </div>
  );
}
