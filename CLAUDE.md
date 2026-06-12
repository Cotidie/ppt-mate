# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ppt-mate: an app for interactively building a PPTX slide deck by chatting with a
local coding agent. The browser preview has a chat dock that drives a real
`claude` CLI process; the agent edits `deck.json`, and the preview hot-reloads to
show the result. Claude Code is the only supported agent today (Codex is planned).

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173. This is the app; the
  chat-to-edit loop only works here (the deck API is a dev-server plugin).
- `npm run build` — `tsc -b` typecheck + `vite build`.
- `npm run preview` — serve the production build.
- `npm run export` — render `deck.json` + `theme.json` to `out/deck.pptx` via pptxgenjs.

No test runner or linter is configured. `tsc -b` (via build) is the typecheck.

Env knobs for the chat backend: `CLAUDE_BIN` (default `claude`), `CLAUDE_MODEL`
(default `opus`).

## Architecture

Two data files are the source of truth, read by every renderer:

- `deck.json` — slide **content** (typed by `src/model/deck.ts`).
- `theme.json` — visual **tokens** (colors/fonts/spacing, typed by `src/theme/theme.ts`),
  compiled by hand from `design/DESIGN.md`. DESIGN.md is the design-system spec for
  this deck's look; consult it before changing theme tokens or adding a layout.

**Shared geometry engine.** `src/layout/resolve.ts` (`resolveSlide`) turns a slide +
theme into positioned `Element`s in **inches**. It has no DOM and no Node deps, and
is imported by BOTH the React preview (`src/preview/SlideCanvas.tsx`) and the PPTX
exporter (`export/export-pptx.mts`). Because both consume the same resolved
coordinates, the `.pptx` matches the browser by construction. Layout logic lives in
`src/layout/families/{cover,body,comparison,table,closing}.ts`, one per slide
`layout`. Adding a slide type = new variant in `deck.ts` + new family file + a case
in `resolve.ts`.

**Deck mutation is server-authoritative.** `vite-plugin-deck-api.ts` is a dev-only
Vite plugin exposing `/api/*` routes. The server reads, edits, and rewrites
`deck.json` by slide `id` (client never ships a whole deck back). Every write
triggers Vite HMR, which reloads the preview. Routes:
- `/api/slides/delete`, `/api/slides/rename` (sidebar nav label only), `/api/slides/edit`
  (sets one field by dotted path, e.g. `bullets.2.text`, `cards.0.bullets.1.text`).
- `/api/chat`, `/api/chat/reset`.

**Chat backend.** `/api/chat` drives a single long-lived `claude` process
(`ClaudeSession`) in `--input-format stream-json --output-format stream-json` mode,
spawned with `cwd` = repo root and `--dangerously-skip-permissions`. The agent edits
files directly from there. Turns are serialized over one stdin; the child's NDJSON
output streams to the browser as SSE until each turn's `result` line. The browser
(`src/preview/ChatDock.tsx`) extracts `text_delta`s for display. "New chat" kills the
process; it respawns on the next turn. The process is bound to die with the dev server.

## Conventions

- Slide edits flow through `deck.json`, never the DOM — the model is the single source
  of truth shared by preview and export.
- `navLabel` is a sidebar-only authoring aid; it is never rendered on a slide and falls
  back to `title` when absent.
- Geometry is always in inches inside the layout engine; `PX_PER_IN`/`PT_PER_IN` in
  `theme.ts` convert for the preview. Canvas is fixed 16:9 (13.333 × 7.5 in).
