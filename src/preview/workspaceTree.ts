// Pure tree-data glue between the server's workspace tree and the
// react-accessible-treeview node array. No React, no DOM: shapes, conversions,
// and the id<->path mapping the explorer relies on.

import { flattenTree, type INode, type NodeId } from "react-accessible-treeview";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
  children?: TreeNode[];
};

export type Meta = { path: string; type: "dir" | "file"; size?: number };

// Sentinel path for the transient "new folder" row (no real file can have it).
export const NEW_SENTINEL = " new-folder";

type FlatInput = { name: string; metadata: Meta; children?: FlatInput[] };

function toInput(node: TreeNode): FlatInput {
  return {
    name: node.name,
    metadata: { path: node.path, type: node.type, size: node.size },
    children: node.children?.map(toInput),
  };
}

// Flatten workspace roots into the library's node array (one synthetic parent).
export function flattenRoots(roots: TreeNode[]): INode[] {
  return flattenTree({ name: "", children: roots.map(toInput) });
}

// Parent folder of a workspace path ("" for a top-level item).
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function pathOf(n: INode): string | undefined {
  return (n.metadata as Meta | undefined)?.path;
}

// Map library node ids back to real workspace paths, dropping the transient
// new-folder placeholder.
export function pathsForIds(data: INode[], ids: Iterable<NodeId>): string[] {
  const byId = new Map(data.map((n) => [n.id, pathOf(n)]));
  return [...ids]
    .map((id) => byId.get(id))
    .filter((p): p is string => p != null && p !== NEW_SENTINEL);
}

// Walk a workspace tree and collect every entry (folders and files) as a flat
// list of { path, type } in depth-first, dir-first order, mirroring how the tree
// is built (and the per-turn manifest). Used by the chat "@" file picker.
export function collectEntries(tree: TreeNode): { path: string; type: "dir" | "file" }[] {
  const out: { path: string; type: "dir" | "file" }[] = [];
  const walk = (nodes: TreeNode[] | undefined) => {
    for (const n of nodes ?? []) {
      out.push({ path: n.path, type: n.type });
      if (n.type === "dir") walk(n.children);
    }
  };
  walk(tree.children);
  return out;
}

// Return a copy of the tree with a placeholder folder appended under `parent`
// ("" = root), so the create input renders at that position in the tree.
export function injectPlaceholder(nodes: TreeNode[], parent: string): TreeNode[] {
  const placeholder: TreeNode = { name: "", path: NEW_SENTINEL, type: "dir" };
  if (parent === "") return [...nodes, placeholder];
  return nodes.map((n) => {
    if (n.path === parent) return { ...n, children: [...(n.children ?? []), placeholder] };
    if (n.children) return { ...n, children: injectPlaceholder(n.children, parent) };
    return n;
  });
}
