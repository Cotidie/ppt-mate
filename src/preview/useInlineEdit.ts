// The explorer's two inline-edit flows (rename an existing row, name a new
// folder) are mutually exclusive, so one discriminated-union state models both -
// starting one implicitly cancels the other, no manual cross-clearing.

import { useState } from "react";

export type Edit =
  | { kind: "rename"; path: string }
  | { kind: "create"; parent: string } // parent dir of the new folder ("" = root)
  | null;

export function useInlineEdit() {
  const [edit, setEdit] = useState<Edit>(null);
  return {
    edit,
    beginRename: (path: string) => setEdit({ kind: "rename", path }),
    beginCreate: (parent: string) => setEdit({ kind: "create", parent }),
    cancel: () => setEdit(null),
    isRenaming: (path: string) => edit?.kind === "rename" && edit.path === path,
  };
}
