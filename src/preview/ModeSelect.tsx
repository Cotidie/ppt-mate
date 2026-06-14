// Execution-mode picker for the chat dock: a pill-style trigger that opens a
// popover menu (Radix DropdownMenu - accessible keyboard nav / focus / outside
// click / positioning, skinned to the dock). Single-select over EXEC_MODES; the
// menu opens upward since the dock sits at the bottom of the screen.

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { EXEC_MODES } from "./execModes";

export function ModeSelect({
  mode,
  onChange,
  disabled,
}: {
  mode: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const current = EXEC_MODES.find((m) => m.id === mode) ?? EXEC_MODES[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="mode-trigger"
          disabled={disabled}
          title="Execution mode: an explicit hint sent with your message"
          aria-label="Execution mode"
        >
          <FlowIcon />
          <span className="mode-trigger-label">{current.label}</span>
          <CaretIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="mode-menu" side="top" align="start" sideOffset={6}>
          <DropdownMenu.Label className="mode-menu-label">Execution mode</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={mode} onValueChange={onChange}>
            {EXEC_MODES.map((m) => (
              <DropdownMenu.RadioItem key={m.id} value={m.id} className="mode-item">
                <span className="mode-item-check">
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon />
                  </DropdownMenu.ItemIndicator>
                </span>
                {m.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function FlowIcon() {
  return (
    <svg className="mode-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg className="mode-caret" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
