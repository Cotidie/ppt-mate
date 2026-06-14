// Workspace HTTP layer. Filesystem mutations are server-authoritative and
// sandboxed to files/; each mutation returns an error string, or null on success.

import type { TreeNode } from "./workspaceTree";

export async function fetchTree(): Promise<TreeNode> {
  const r = await fetch("/api/workspace");
  if (!r.ok) throw new Error("workspace fetch failed");
  return r.json();
}

// Open a workspace file with the host's default app (dev server runs locally).
export function openFile(path: string): void {
  fetch("/api/workspace/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}

export async function mkdir(parent: string, name: string): Promise<string | null> {
  return post("/api/workspace/mkdir", { parent, name });
}

export async function renamePath(path: string, name: string): Promise<string | null> {
  return post("/api/workspace/rename", { path, name });
}

export async function removePaths(paths: string[]): Promise<string | null> {
  return post("/api/workspace/remove", { paths });
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
