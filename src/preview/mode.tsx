// Editor interaction mode, shared across the deeply-nested preview tree. Strict
// modes: "move" drags elements (no text edit), "edit" edits text (no drag),
// "select" picks slide context for Claude (whole element or a text range; no edit,
// no drag). Provided in App; consumed by useElementDrag and RichTextEditor via
// useMode().

import { createContext, useContext } from "react";

export type Mode = "move" | "edit" | "select";

export const ModeContext = createContext<Mode>("edit");

export const useMode = (): Mode => useContext(ModeContext);
