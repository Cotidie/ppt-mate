# Specialized in-app Claude agent for slide authoring

## Context

The in-app chat (`vite-plugin-deck-api.ts` → `ClaudeSession`) runs the Claude
Agent SDK `query()` with only `cwd / model / permissionMode / includePartialMessages`.
With `settingSources` omitted the SDK loads **user + project + local** settings,
so the user's global `~/.claude/CLAUDE.md` (graphify / no-em-dash / git rules)
leaks into the deck agent, and with no `systemPrompt` it behaves like a general
coding assistant. It also has no awareness of *runtime UI state* — which slide is
active, what is selected — because that lives only in the browser, not in any file.

Goal: turn it into a specialized slide-authoring agent that (1) is isolated from
user-scope CLAUDE.md, (2) still follows project CLAUDE.md, (3) is reframed for
slide work, (4) sees the live deck/slide/selection/design-system, and (5) is
structured so pointer/region/selected-text awareness can be added later with no
re-architecture.

Decisions (confirmed with user): keep **raw file edits** (agent edits `deck.json`
directly, as today — no new mutation tools); **hybrid** context delivery (inject a
compact pointer each turn + on-demand MCP tools for detail).

All SDK semantics below verified against the installed type defs
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, v0.3.177).

## Approach

Four configuration groups on the existing `query()` call + a server-side live UI
context store + an in-process MCP server. No new agent process, no new framework.

### 1. Identity + isolation + lockdown — `query()` options (`vite-plugin-deck-api.ts`, `ensureStarted`)
Add to the existing `options` object:
- `systemPrompt: { type: "preset", preset: "claude_code", append: BRIEF }` — keeps
  CC's file-edit competence **and** the automatic project-CLAUDE.md memory
  injection (a full custom string would lose both); `BRIEF` specializes behavior.
- `settingSources: ["project"]` — loads only project settings + project CLAUDE.md.
  Doc verbatim (sdk.d.ts:1878): *"Must include 'project' to load CLAUDE.md files."*
  Excludes `user` (the leak) and `local`. Satisfies requirements 1 + 2.
- `strictMcpConfig: true` — ignore any stray `.mcp.json` / user MCP; use only our
  in-process server.
- `disallowedTools: ["WebFetch", "WebSearch"]` — no web wandering. (Leave
  Read/Grep/Glob/Edit/Write/Bash so it can read+edit the deck. Can tighten to an
  `allowedTools` allowlist later if desired.)
- `mcpServers: { deck: deckMcp }` (see §3).
- Keep `permissionMode: "bypassPermissions"` (local dev tool editing local files).

### 2. Specialization brief — new file `agent/SLIDE_AGENT.md`
Markdown, read once at session start (`readFile(resolve(HERE, "agent/SLIDE_AGENT.md"))`,
fall back to empty string), passed as `append`. Editable like `design/DESIGN.md`.
Content: the agent's role (slide-authoring assistant for this deck, not a general
coder); that `deck.json` is the single source of truth (never edit the DOM);
the dotted-path field model + layout families (cover/body/comparison/table/closing);
that visual tokens live in `theme.json` / `design/DESIGN.md`; behavioral rules
(stay on slide tasks, prefer minimal targeted edits, keep replies short); and a
note that it can call the `deck` MCP tools to inspect live UI state.

### 3. Live UI context store + MCP tools (`vite-plugin-deck-api.ts`)
- Module-level store: `let uiContext: { activeSlideId?: string; selection?: string[] } = {}`.
  (Future fields: `selectedText`, `region`, `pointer` — additive only.)
- New route `POST /api/context` (register beside `/api/footer`): merge the partial
  body into `uiContext` (`Object.assign`), return `{ ok: true }`. Reuse
  `readJsonBody` / `sendJson`.
- `const deckMcp = createSdkMcpServer({ name: "deck", instructions, tools: [...] })`
  with three `tool(name, desc, zodShape, handler)` tools (empty `{}` zod shape for
  no-arg tools). Tools are exposed to the model as `mcp__deck__<name>`:
  - `get_active_slide` — read `uiContext.activeSlideId`, load `deck.json`, return
    that slide's JSON **plus** its resolved `Element[]` (positions/sizes in inches)
    computed via `devServer.ssrLoadModule("/src/layout/resolve.ts")` →
    `resolveSlide(slide, theme)` (same `ssrLoadModule` mechanism the export route
    already uses, `streamExport` line ~512). theme from `theme.json`.
  - `get_selection` — return `uiContext.selection` keys and, for each, the matching
    resolved element's geometry + content from the active slide. (This is the seam
    that grows to selected-text / region / pointer.)
  - `get_design_system` — return `theme.json` tokens + a pointer to `design/DESIGN.md`.
  - Each handler returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.
- Add `zod` to `package.json` dependencies (already present transitively at 4.4.3;
  `tool()` requires a zod raw shape).

### 4. Per-turn context injection (server-side, `handleChat`)
Before `claude.runTurn(...)`, compose the outgoing message: prepend a 1-2 line
header built from `uiContext` + a `deck.json` lookup, e.g.
`[context] active slide: s3 (comparison) "Methodology"; selection: card.0.title`
(or `selection: none`). Frontend stays dumb — it only keeps the store fresh; the
freshest snapshot is stitched in at send time. The agent thus always has minimal
awareness and pulls full detail via the MCP tools when needed.

### 5. Client context reporting
- New `src/preview/agentContext.ts`: `reportContext(partial)` — debounced
  `POST /api/context` (fire-and-forget, `.catch(() => {})`).
- `src/App.tsx`: effect on active-slide change → `reportContext({ activeSlideId: slides[i].id })`.
- `src/preview/selection.tsx` (or `SlideCanvas`): on `selected` change →
  `reportContext({ selection: [...selected] })`. The frontend already holds both
  pieces (`i` in App, `selected: Set<string>` in `useSelectionState`).

## Visual / rendered-state awareness (extension)

The agent sees text + *intended* geometry + tokens, but not *rendered* truth:
whether text **overflows** its box, gets **clipped**, **collides**, or runs
**off-canvas**. Those are facts that only exist once the browser paints (real font
metrics + wrapping), so neither `deck.json` nor `resolveSlide` knows them — e.g. a
card body whose bullets spill past the card's bottom edge.

Decision (confirmed with user): the **live tab measures itself** and reports render
facts into the *same* context store. This is faithful to exactly what the user
sees (their fonts/zoom), cheap, and keeps the agent locked-down — no second browser.

- **Where:** the renderer (`SlideCanvas` / `Element`). After paint, measure each
  element's real box vs its allotted box: `scrollHeight` vs `clientHeight` on the
  text container for vertical overflow; resolved box vs the 13.333×7.5in canvas for
  off-canvas. Convert px overrun to lines (via line-height) or inches (via
  `PX_PER_IN` / live scale).
- **Report:** extend `reportContext` with a `render` field, e.g.
  `reportContext({ render: { "card.1.body": { overflow: { lines: 2, inches: 0.4 }, clipped: false, offCanvas: false } } })`,
  debounced on slide change / content change / resize. Server stores it on
  `uiContext.render`.
- **Surface:** `get_active_slide` / `get_selection` include the render facts per
  element; the injected pointer adds a terse flag when something is wrong, e.g.
  `… ⚠ card.1 body overflows ~2 lines`.
- **Effect:** the agent gets a concrete, actionable signal and can respond — trim
  text, drop a font-size token, enlarge/move the box (geometry override), or switch
  to a roomier layout. The overflow in the screenshot becomes a fact it can fix.

Same seam as selection: a new field on the store + new tool output, nothing
structural. Off-canvas is pure geometry and could also be flagged server-side in
`resolveSlide` as a deterministic backstop (and would help the export path too).

## Critical files
- `vite-plugin-deck-api.ts` — query options, MCP server + tools, context store, `/api/context`, chat injection.
- `agent/SLIDE_AGENT.md` (new) — specialization brief.
- `src/preview/agentContext.ts` (new) — client reporter (`activeSlideId`, `selection`, `render`).
- `src/App.tsx`, `src/preview/selection.tsx` (or `SlideCanvas.tsx`) — report active slide + selection.
- `src/preview/SlideCanvas.tsx` / `Element.tsx` — measure rendered overflow/clip/off-canvas and report it.
- `package.json` — add `zod` dependency.
- Reuse: `resolveSlide` (`src/layout/resolve.ts`), `theme` (`theme.json`), `PX_PER_IN` (`src/theme/theme.ts`), `devServer.ssrLoadModule`, `readJsonBody`/`sendJson`.

## Verification
- `npm run build` clean (SDK + zod types).
- Throwaway `npx vite --port 519X --strictPort` (never touch 5173).
- `curl -X POST :519X/api/context -d '{"activeSlideId":"<id>"}'` → `{ok:true}`.
- **Awareness**: chat "which slide am I on and what's its layout?" → answers from the
  injected header; "use your tools to list the elements and their positions on the
  active slide" → returns inches geometry via `get_active_slide`.
- **Isolation**: chat "write one sentence containing an em dash" → the deck agent
  complies (proves the user-scope no-em-dash rule did NOT leak). Ask "where does
  slide content live, and may you edit the DOM?" → answers per project CLAUDE.md
  (deck.json is source of truth; never the DOM) — proves project CLAUDE.md loaded.
- `git checkout HEAD -- deck.json theme.json`; confirm clean tree; commit.

## Future extension (designed-in, not built now)
- pointer / selected region / selected text = new fields on `uiContext`, new keys in
  the `/api/context` payload, extra lines in the injected header, and richer
  `get_selection` output. No change to identity/isolation/transport.
- **Headless render-oracle** (e.g. Playwright MCP or a headless screenshot): the
  live-tab measurement above covers interactive editing. For self-verification
  ("did my fix actually render correctly?"), batch overflow-linting across all
  slides, or the deployed/no-user-tab case, add a headless renderer the agent can
  drive. Complementary to live-tab measurement, not a replacement — and a larger,
  more powerful capability surface, so weigh it against the locked-down design.
