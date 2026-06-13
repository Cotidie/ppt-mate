// Right-edge vertical toolbox over the slide area. Grouped icon buttons: the
// Move/Edit mode toggle, a position reset, zoom out/fit/in, and a Settings panel
// toggle. New tools are added as another <ToolButton> (or group) below.

import type { ReactNode } from "react";
import type { Mode } from "./mode";

export type ZoomAction = "in" | "out" | "fit";

export function Toolbox({
  mode,
  onMode,
  onZoom,
  onResetPosition,
  settingsOpen,
  onToggleSettings,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onZoom: (a: ZoomAction) => void;
  onResetPosition: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <div className="toolbox" role="toolbar" aria-label="Slide tools">
      <ToolButton label="Move mode" active={mode === "move"} onClick={() => onMode("move")}>
        <HandIcon />
      </ToolButton>
      <ToolButton label="Edit mode" active={mode === "edit"} onClick={() => onMode("edit")}>
        <PencilIcon />
      </ToolButton>

      <div className="toolbox-divider" />

      <ToolButton label="Reset layout" onClick={onResetPosition}>
        <ResetIcon />
      </ToolButton>

      <div className="toolbox-divider" />

      <ToolButton label="Zoom out" onClick={() => onZoom("out")}>
        <MinusIcon />
      </ToolButton>
      <ToolButton label="Fit to screen" onClick={() => onZoom("fit")}>
        <FitIcon />
      </ToolButton>
      <ToolButton label="Zoom in" onClick={() => onZoom("in")}>
        <PlusIcon />
      </ToolButton>

      <div className="toolbox-divider" />

      <ToolButton label="Settings" active={settingsOpen} onClick={onToggleSettings}>
        <GearIcon />
      </ToolButton>

      {settingsOpen && (
        <div className="settings-panel" role="dialog" aria-label="Settings">
          <div className="settings-panel-title">Settings</div>
          <div className="settings-panel-body">Coming soon.</div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"toolbox-btn" + (active ? " active" : "")}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Inline SVGs (no icon lib in deps). 18px, stroke = currentColor.
const svg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const HandIcon = () =>
  svg(
    <>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-7-4l-2.5-4a2 2 0 0 1 3.5-2l1.5 2" />
    </>
  );

const PencilIcon = () =>
  svg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  );

const ResetIcon = () =>
  svg(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  );

const MinusIcon = () => svg(<path d="M5 12h14" />);
const PlusIcon = () =>
  svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  );

const FitIcon = () =>
  svg(
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
    </>
  );

const GearIcon = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  );
