// Execution modes for the chat dock: an explicit hint the user can pick instead
// of relying on the agent inferring intent from prose. The selected mode's `id`
// rides the chat payload; the server maps it to a directive prepended to the turn
// (see EXEC_HINTS in vite-plugin-deck-api.ts, keyed by the same ids).
//
// To add a mode later (e.g. "Extract Design"): add one entry here and one hint on
// the server. No UI or payload changes needed.
export type ExecMode = { id: string; label: string };

export const EXEC_MODES: ExecMode[] = [
  { id: "default", label: "Default" },
  { id: "fix-layout", label: "Fix Layout" },
];

export const DEFAULT_MODE = EXEC_MODES[0].id;
