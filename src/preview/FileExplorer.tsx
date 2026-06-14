// Workspace file explorer for the lower left rail (VS Code-style). Renders the
// `files/` tree from GET /api/workspace via react-accessible-treeview, which owns
// the ARIA tree roles, keyboard navigation, selection, and expand/collapse state.
// This component is orchestration only: the subtle concerns live in focused
// modules - tree-data glue (workspaceTree), the HTTP layer (workspaceApi), and
// the selection / expansion / inline-edit hooks.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import TreeView from "react-accessible-treeview";
import { type Meta, type TreeNode, dirOf, flattenRoots, injectPlaceholder, pathOf, NEW_SENTINEL } from "./workspaceTree";
import { fetchTree, mkdir, openFile, removePaths, renamePath } from "./workspaceApi";
import { useWorkspaceSelection } from "./useWorkspaceSelection";
import { useWorkspaceExpansion } from "./useWorkspaceExpansion";
import { useWorkspaceDrop } from "./useWorkspaceDrop";
import { useInlineEdit } from "./useInlineEdit";
import { FileRow, NameInput } from "./FileRow";
import { NewFolderIcon, TrashIcon } from "./fileIcons";

export type { TreeNode } from "./workspaceTree";

export function FileExplorer() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inline = useInlineEdit();

  const refresh = useCallback(() => {
    fetchTree()
      .then((t) => {
        setTree(t);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const roots = tree?.children ?? [];
  const creating = inline.edit?.kind === "create";
  // While creating, inject a transient placeholder folder under the target parent
  // so its name input renders at the right position in the tree (nested), not at
  // the root. Detected later in nodeRenderer by its sentinel path.
  const inputRoots = useMemo(
    () => (inline.edit?.kind === "create" ? injectPlaceholder(roots, inline.edit.parent) : roots),
    [roots, inline.edit],
  );
  const data = useMemo(() => flattenRoots(inputRoots), [inputRoots]);

  const sel = useWorkspaceSelection(data);
  const expand = useWorkspaceExpansion(roots, data);
  const drop = useWorkspaceDrop({ refresh, setExpanded: expand.setExpanded, setError });

  // Every mutation follows the same choreography: run it, surface an error or
  // clear the banner and refresh. Returns whether it succeeded.
  const run = async (call: () => Promise<string | null>, onError?: () => void): Promise<boolean> => {
    const msg = await call();
    if (msg) {
      setError(msg);
      onError?.();
      return false;
    }
    setError(null);
    refresh();
    return true;
  };

  // Clicking blank space in the panel (header gaps or the area below the rows)
  // cancels the selection; clicks on a row, button, input, or error stay put.
  const onPanelClick = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest(".files-row, button, input, .files-error")) return;
    sel.clearSelection();
  };

  // New Folder destination from the current anchor: a folder -> inside it; a
  // file -> its parent; nothing -> the workspace root.
  const beginNewFolder = () => {
    setError(null);
    const a = sel.anchor;
    const parent = !a ? "" : a.type === "dir" ? a.path : dirOf(a.path);
    if (parent) expand.setExpanded(parent, true); // reveal the placeholder inside it
    inline.beginCreate(parent);
  };

  const commitNewFolder = async (name: string) => {
    const parent = inline.edit?.kind === "create" ? inline.edit.parent : "";
    inline.cancel();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await run(() => mkdir(parent, trimmed));
    if (ok && parent) expand.setExpanded(parent, true);
  };

  const commitRename = async (path: string, name: string) => {
    inline.cancel();
    const trimmed = name.trim();
    if (!trimmed) return;
    await run(() => renamePath(path, trimmed), () => inline.beginRename(path)); // keep editing on error
  };

  const removeSelected = async () => {
    const paths = [...sel.selectedPaths];
    if (!paths.length) return;
    const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} items`;
    if (!confirm(`Remove ${what} from the workspace? This cannot be undone.`)) return;
    const ok = await run(() => removePaths(paths));
    if (ok) sel.reset();
  };

  return (
    <div className="files-panel" onClick={onPanelClick}>
      <div className="files-head">
        <span className="files-title">Workspace</span>
        <span className="files-actions">
          <button className="files-action" title="New folder" aria-label="New folder" onClick={beginNewFolder}>
            <NewFolderIcon />
          </button>
          <button className="files-action" title="Refresh" aria-label="Refresh workspace" onClick={refresh}>
            ⟳
          </button>
          <button
            className="files-action danger"
            title="Remove selected (Ctrl/⌘+click to select multiple)"
            aria-label="Remove selected"
            onClick={removeSelected}
            disabled={sel.selectedPaths.size === 0}
          >
            <TrashIcon />
          </button>
        </span>
      </div>
      {error && (
        <div className="files-error" role="alert" onClick={() => setError(null)} title="Dismiss">
          {error}
        </div>
      )}
      <div
        className={"files-body rail-files-drop" + (drop.dropTarget === "" ? " drop-target" : "")}
        {...drop.bodyHandlers}
      >
        {loadError ? (
          <div className="files-empty">Workspace unavailable</div>
        ) : roots.length === 0 && !creating ? (
          <div className="files-empty">No files yet</div>
        ) : (
          <TreeView
            data={data}
            className="files-tree"
            aria-label="Workspace files"
            // Plain click selects exactly one (EXCLUSIVE_SELECT); Ctrl/Cmd+click
            // adds/toggles (multiSelect + togglableSelect); selecting a folder
            // selects its descendants, and all-children-selected marks the parent.
            multiSelect
            togglableSelect
            clickAction="EXCLUSIVE_SELECT"
            propagateSelect
            propagateSelectUpwards
            selectedIds={sel.clearedIds}
            expandedIds={expand.expandedIds}
            onNodeSelect={sel.onNodeSelect}
            onSelect={sel.onSelect}
            onExpand={({ element, isExpanded }) => {
              const p = pathOf(element);
              if (p != null && p !== NEW_SENTINEL) expand.setExpanded(p, isExpanded);
            }}
            nodeRenderer={({ element, isExpanded, getNodeProps, level }) =>
              pathOf(element) === NEW_SENTINEL ? (
                // The transient "new folder" row: a caret + inline name input, at
                // this position in the tree (nested under its parent).
                <div
                  {...getNodeProps()}
                  className="files-row files-dir"
                  style={{ paddingLeft: 8 + (level - 1) * 12 }}
                >
                  <span className="files-caret" aria-hidden="true">›</span>
                  <NameInput
                    className="files-edit"
                    placeholder="New folder name"
                    initial=""
                    onCommit={commitNewFolder}
                    onCancel={inline.cancel}
                  />
                </div>
              ) : (
                <FileRow
                  element={element}
                  isExpanded={isExpanded}
                  level={level}
                  getNodeProps={getNodeProps}
                  editing={inline.isRenaming(pathOf(element) ?? "")}
                  dragHandlers={drop.rowHandlers(element.metadata as Meta)}
                  isDropTarget={
                    (element.metadata as Meta).type === "dir" &&
                    drop.dropTarget === (element.metadata as Meta).path
                  }
                  onOpen={openFile}
                  onBeginRename={(path) => {
                    setError(null);
                    inline.beginRename(path);
                  }}
                  onCommitRename={commitRename}
                  onCancelRename={inline.cancel}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
