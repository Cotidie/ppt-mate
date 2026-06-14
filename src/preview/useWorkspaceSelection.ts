// Selection model for the workspace tree. The library owns the visible selection
// (aria-selected from its internal selectedIds); this hook mirrors it into paths
// for the toolbar, tracks the last-clicked anchor (New Folder destination), and
// encapsulates the one-shot controlled "select none" the library lacks.

import { useMemo, useState } from "react";
import type { INode, NodeId } from "react-accessible-treeview";
import { type Meta, pathsForIds } from "./workspaceTree";

export function useWorkspaceSelection(data: INode[]) {
  const [anchor, setAnchor] = useState<Meta | null>(null); // last clicked, for New Folder
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  // Bumped to clear the library's internal selection: each bump yields a fresh
  // `selectedIds={[]}` reference, applied once as a controlled "select none";
  // undefined the rest of the time so selection stays uncontrolled.
  const [clearTick, setClearTick] = useState(0);

  const clearedIds = useMemo<NodeId[] | undefined>(() => (clearTick ? [] : undefined), [clearTick]);

  // Cancel the selection in both the library (via the controlled clear) and here.
  const clearSelection = () => {
    if (selectedPaths.size === 0 && !anchor) return;
    setSelectedPaths(new Set());
    setAnchor(null);
    setClearTick((t) => t + 1);
  };

  // Drop our mirrored selection without bumping the controlled clear (used after a
  // remove, where the refresh reloads the tree anyway).
  const reset = () => {
    setSelectedPaths(new Set());
    setAnchor(null);
  };

  const onNodeSelect = ({ element, isSelected }: { element: INode; isSelected: boolean }) =>
    setAnchor(isSelected ? (element.metadata as Meta) : null);

  const onSelect = ({ treeState }: { treeState: { selectedIds: Set<NodeId> } }) =>
    setSelectedPaths(new Set(pathsForIds(data, treeState.selectedIds)));

  return { selectedPaths, anchor, clearedIds, clearSelection, reset, onNodeSelect, onSelect };
}
