// Expansion model for the workspace tree. Tracked by path (stable across
// refreshes / id reassignment) and mapped to the library's node ids; seeds the
// top-level folders open once after the first load.

import { useEffect, useMemo, useRef, useState } from "react";
import type { INode, NodeId } from "react-accessible-treeview";
import { type TreeNode, pathOf } from "./workspaceTree";

export function useWorkspaceExpansion(roots: TreeNode[], data: INode[]) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || roots.length === 0) return;
    seeded.current = true;
    setExpandedPaths(new Set(roots.filter((n) => n.type === "dir").map((n) => n.path)));
  }, [roots]);

  const expandedIds = useMemo<NodeId[]>(
    () =>
      data
        .filter((n) => {
          const p = pathOf(n);
          return p != null && expandedPaths.has(p);
        })
        .map((n) => n.id),
    [data, expandedPaths],
  );

  const setExpanded = (path: string, open: boolean) =>
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  return { expandedIds, setExpanded };
}
