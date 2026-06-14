// Editor interaction mode, shared across the deeply-nested preview tree. Strict
// modes: "move" drags elements (no text edit), "edit" edits text (no drag),
// "select" picks slide context for Claude (whole element or a text range),
// "visual" drag-selects a region captured as an image for the agent. Provided in
// App; consumed by useElementDrag and RichTextEditor via useMode().

import { createContext, useContext } from "react";

export type Mode = "move" | "edit" | "select" | "visual";

export const ModeContext = createContext<Mode>("edit");

export const useMode = (): Mode => useContext(ModeContext);
