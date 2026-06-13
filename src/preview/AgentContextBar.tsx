// "Claude sees" strip above the chat input: a live, compact view of what the
// in-app agent is currently aware of. Reads the same client mirror that feeds the
// agent (useAgentContext), so it never drifts from what the agent receives.
// Clicking the strip expands the literal [context] line stitched into each turn.

import { useEffect, useState } from "react";
import type { Deck, RichText } from "../model/deck";
import { useAgentContext, type UiContext } from "./agentContext";
import deckJson from "../../deck.json";

const deck = deckJson as Deck;

function flatten(rt: RichText | undefined): string {
  return rt ? rt.map((s) => s.text).join("") : "";
}

// One issue per element with a render problem, e.g. "bullets overflows ~2 lines".
function issueMessages(render: UiContext["render"]): string[] {
  if (!render) return [];
  const msgs: string[] = [];
  for (const [key, f] of Object.entries(render)) {
    if (f.overflowLines) msgs.push(`${key} overflows ~${f.overflowLines} line(s)`);
    else if (f.overflowInches) msgs.push(`${key} overflows ~${f.overflowInches}in`);
    if (f.offCanvas) msgs.push(`${key} off-canvas`);
  }
  return msgs;
}

// Mirrors the server's contextHeader() in vite-plugin-deck-api.ts. KEEP IN SYNC:
// this is the literal line the agent receives at the top of each turn.
function formatContextLine(ctx: UiContext): string {
  const id = ctx.activeSlideId;
  if (!id) return "(no active slide reported yet)";
  const slide = deck.slides.find((s) => s.id === id);
  const layout = slide?.layout ?? "";
  const title = flatten(slide?.title);
  const sel = ctx.selection?.length ? ctx.selection.join(", ") : "none";
  const parts = [
    `active slide: ${id}${layout ? ` (${layout})` : ""}${title ? ` "${title}"` : ""}`,
    `selection: ${sel}`,
  ];
  const st = ctx.selectedText;
  if (st?.text) {
    const snippet = st.text.length > 80 ? st.text.slice(0, 80) + "…" : st.text;
    parts.push(`text: "${snippet}" in ${st.elementKey}${st.path ? ` (${st.path})` : ""}`);
  }
  const issues = issueMessages(ctx.render);
  if (issues.length) parts.push(`issues: ${issues.join(", ")}`);
  return `[context] ${parts.join("; ")}`;
}

export function AgentContextBar() {
  const ctx = useAgentContext();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  const id = ctx.activeSlideId;
  const idx = id ? deck.slides.findIndex((s) => s.id === id) : -1;
  const slide = idx >= 0 ? deck.slides[idx] : undefined;
  const layout = slide?.layout;
  const title = flatten(slide?.title);
  const selection = ctx.selection ?? [];
  const selText = ctx.selectedText?.text ?? "";
  const issues = issueMessages(ctx.render);
  const line = formatContextLine(ctx);

  // Pulse the strip whenever the agent's awareness changes, so the user notices.
  useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [line]);

  return (
    <div className="ctx-wrap">
      <button
        className={"ctx-bar" + (flash ? " flash" : "")}
        onClick={() => setOpen((o) => !o)}
        title="What Claude is aware of right now (click for detail)"
        aria-expanded={open}
      >
        <span className="ctx-eye" aria-hidden="true">
          {/* eye glyph */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <span className="ctx-label">Claude sees</span>
        <span className="ctx-chip" title={title || undefined}>
          {slide ? `Slide ${idx + 1}${layout ? ` · ${layout}` : ""}` : "no slide"}
        </span>
        <span className="ctx-chip" title={selection.length ? selection.join(", ") : undefined}>
          {selection.length === 0
            ? "nothing selected"
            : selection.length === 1
              ? selection[0]
              : `${selection.length} selected`}
        </span>
        {selText && (
          <span className="ctx-chip" title={selText}>
            “{selText.length > 24 ? selText.slice(0, 24) + "…" : selText}”
          </span>
        )}
        {issues.length > 0 && (
          <span className="ctx-chip warn" title={issues.join("; ")}>
            ⚠ layout issue{issues.length > 1 ? `s (${issues.length})` : ""}
          </span>
        )}
        <span className="ctx-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="ctx-pop" role="dialog" aria-label="Agent context detail">
          <div className="ctx-pop-title">Context sent to Claude each turn</div>
          <pre className="ctx-pop-line">{line}</pre>
        </div>
      )}
    </div>
  );
}
