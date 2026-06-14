# fix-layout: visual scanning (agent renders + sees the slide)

## Context

`fix-layout` today only sees content + resolved geometry + the render-fact flags;
it never looks at pixels. The agent has no way to render a slide itself - the only
images it ever gets are user-attached Visual Selection crops. That blind spot is
why subtle visual issues slip (a contrast clash, a collision, an overflow a flag
missed). The skill should: **(1) scan a slide using content AND a visual, (2)
review/find issues, (3) fix** - and re-scan to verify.

Decisions (confirmed): reuse the Visual Selection capture path (client
`html-to-image` of the live stage - pixel-faithful, correct web fonts) rather than
a server pptx/soffice render (font/autofit drift) or a new Playwright dep. Scope:
**active slide only** - `render_slide` captures the slide currently on screen.

Verified: the MCP tool result schema supports `type: "image"` content
(`sdk-tools.d.ts`), so a tool can hand the model a rendered PNG.

## Approach

The agent (server-side) triggers a client capture over the **chat turn's already-
open SSE stream**: a `render_slide` MCP tool emits a `render-request` event on the
active stream, the browser rasterizes the stage and POSTs the PNG back, and the
tool returns it as an image block the model sees - all within the one turn.

### 1. Reusable full-stage capture — `src/preview/SlideCanvas.tsx`
Factor a `captureStage(stageEl): Promise<string>` (dataURL) out of `captureRegion`
(the `htmlToImage.toCanvas(stageEl, { pixelRatio, width, height, style:{transform:
"none"} })` part, no crop). `captureRegion` calls it then crops. Register a capturer
for the active slide: `setSlideCapturer(() => captureStage(stageRef.current))` in an
effect, cleared on unmount.

### 2. Capture channel — `src/preview/agentContext.ts`
Add a module slot `setSlideCapturer(fn)` / `getSlideCapturer()` (client-only, like
`pendingVisual`). `fn: () => Promise<string|null>` returns the active slide PNG.

### 3. Server: render request over the active turn — `vite-plugin-deck-api.ts`
- `ClaudeSession.requestClientRender(): Promise<string|null>`: if no `activeRes`,
  resolve null; else make a `requestId`, `sendEvent(activeRes, "render-request",
  JSON.stringify({requestId}))`, and return a promise stored in a module
  `pendingRenders: Map<id,{resolve,timer}>` with an ~8s timeout (resolve null).
- New route `POST /api/render-result` (register beside `/api/context`): body
  `{requestId, image}` -> resolve the pending render with the dataURL; `{ok:true}`.
- New MCP tool `render_slide` on `deckMcp`: calls `claude.requestClientRender()`;
  on a dataURL return image content `{ content: [{ type:"image", data:<base64,
  prefix stripped>, mimeType:"image/png" }] }`; on null return text ("couldn't
  capture - is the preview open?"). Add an `imageResult()` helper beside
  `textResult()`. Describe it as "render the slide the user is viewing to an image
  and see it" in the tool + server instructions.

### 4. Client handles the request — `src/preview/ChatDock.tsx`
In `streamReply`'s `onmessage`, when `ev.event === "render-request"`: parse
`{requestId}`, call `getSlideCapturer()?.()`, then `POST /api/render-result`
`{requestId, image}` (fire-and-forget, `.catch`). It is a side effect, not a chat
message - do not push it to the log.

### 5. Skill: scan -> review -> fix — `.claude/skills/fix-layout/SKILL.md`
Restructure into the three explicit phases:
1. **Scan**: gather content + geometry (`get_active_slide`, `get_design_system`)
   AND **render the slide** (`render_slide`) and inspect the image pixel-by-pixel.
2. **Review / find issues**: run the geometric containment checklist (already in
   the skill) AND the visual checklist (overlaps, cut-off text, collisions, low
   contrast, uneven spacing, misalignment) against the rendered image; cross-check
   - believe the pixels over the flags.
3. **Fix**: minimal targeted edit, then **re-render (`render_slide`) to verify**;
   one fix often exposes another - loop until a clean visual + geometric pass.

## Critical files
- `vite-plugin-deck-api.ts` — `requestClientRender`, `/api/render-result`,
  `render_slide` tool + `imageResult` helper.
- `src/preview/SlideCanvas.tsx` — `captureStage` (factored from `captureRegion`) +
  register capturer.
- `src/preview/agentContext.ts` — `setSlideCapturer`/`getSlideCapturer`.
- `src/preview/ChatDock.tsx` — handle the `render-request` SSE event.
- `.claude/skills/fix-layout/SKILL.md` — scan/review/fix phases.
- Reuse: `htmlToImage.toCanvas` (SlideCanvas), `sendEvent`/`openEventStream`,
  MCP image content (`sdk-tools.d.ts`), `readJsonBody`/`sendJson`, `activeRes`.

## Risk to verify first
**Does an MCP tool's image result actually reach the model as a viewable image?**
This is the linchpin. Verify on a throwaway server: drive a turn that calls
`render_slide`, confirm the agent then describes the slide's actual visuals (e.g.
names the right-card overflow on slide 2). If image tool-results are NOT surfaced,
fall back to delivering the PNG as a user image block on the next turn (the proven
Visual Selection path). Also verify capture timing fits inside the ~8s SSE await.

## Verification
- `npm run build` clean.
- Throwaway `npx vite --port 519X --strictPort` (never 5173). DevTools MCP: open
  slide 2; drive a chat turn "use fix-layout to review this slide" -> observe a
  `render-request` round-trip, the agent describes the rendered slide (mentions the
  card.1 overflow visually), proposes/makes a fix, re-renders to verify.
- Confirm a normal turn (no render) still works; the render event never appears in
  the chat log.
- `git checkout HEAD -- deck.json theme.json`; clean tree; commit.

## Future (not now)
Auto-navigate to render any slide / whole-deck unattended scan; a deck thumbnail
montage; cache the last render to skip a re-capture when nothing changed.
