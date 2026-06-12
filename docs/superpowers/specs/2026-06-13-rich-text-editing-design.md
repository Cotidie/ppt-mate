# Per-span rich text editing — design

Date: 2026-06-13
Status: approved, ready for implementation planning

## Goal

Let the user apply character-level formatting to slide text directly in the
preview, via a floating toolbar that appears on selection. v1 marks: **bold,
italic, underline, text color, highlight**. The editor library is TipTap
(ProseMirror); we do not hand-roll a rich-text editor.

## Decisions (locked)

- **Marks in scope (v1):** bold, italic, underline, text color, highlight. Per
  character span. Deferred: font family, font size, alignment, link, image insert.
- **Fields affected:** every field that is already inline-editable becomes rich
  text (full list in §1). Footer and `meta.title` stay plain.
- **Representation:** every rich field is **always** an array of spans
  (`Span[]`). No plain-string shorthand. The repo's `deck.json` is migrated once
  by a script. The existing whole-field `emphasis` enum is removed; its meaning
  folds into spans.
- **Toolbar UX:** floating on selection (TipTap `BubbleMenu`). No fixed bar.
- **Editor:** TipTap, headless, single-paragraph schema per field.

## Architecture context

`deck.json` (content) + `theme.json` (tokens) feed `resolveSlide`
(`src/layout/resolve.ts`), a DOM-free, inch-based geometry engine imported by
BOTH the React preview (`SlideCanvas` → `Element.tsx`) and the PPTX exporter
(`export/export-pptx.mts`). Because both consume the same resolved `Run`s, the
`.pptx` matches the browser by construction. This design preserves that
invariant: spans flow into resolved runs, and both renderers learn the two new
run marks.

Today's inline editor (`EditableText` in `Element.tsx`) is a **plaintext,
single-run `contentEditable`** that commits a string through `/api/slides/edit`.
This is what TipTap replaces.

## 1. Data model (`src/model/deck.ts`)

New stored unit (mirrors the resolved `Run`):

```ts
export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;      // hex
  highlight?: string;  // hex
};
export type RichText = Span[];
```

Field changes (every inline-editable field → `RichText`):

- `Bullet` becomes `{ runs: Span[]; level?: 0 | 1 }`. Removes `text`,
  `emphasis`, and the `Emphasis` type.
- Cover: `title`, `kicker?`, `citation?` → `RichText`; `authors?: RichText[]`.
- Body: `title`, `kicker?`, `note?` → `RichText`; `bullets` as above.
- Comparison: `title`, `kicker?`, `note?` → `RichText`; `Card.header` →
  `RichText`; card bullets as above.
- Table: `title`, `kicker?`, `verdict?` → `RichText`; `columns: RichText[]`;
  `TableRow.cells: RichText[]`. **`TableRow.cellColors` removed** — cell color
  lives in spans now. `highlightRow` stays (row tint, not text).
- Closing: `title`, `subtitle?` → `RichText`.
- **Unchanged plain strings:** `meta.title` (nav only), `meta.footer` (not
  editable).

**Default styling stays element-level.** Title bold, card-header white+bold,
kicker gray remain resolver defaults on the text element. Spans carry only user
*overrides* (the marks applied in the bubble). A migrated title is `[{text}]`,
not `[{text, bold:true}]`.

## 2. One-time migration (`scripts/migrate-deck-richtext.mts`)

Rewrites `deck.json` in place. Each rich field `"foo"` → `[{ text: "foo" }]`.
Carries the two existing *user* style systems into spans:

- bullet `emphasis`: `green` → `{ color: <green>, bold: true }`, `red` →
  `{ color: <red>, bold: true }`, `bold` → `{ bold: true }`.
- table `cellColors[i]`: `green`/`red` → that cell's span `color`.

Green/red hex come from `theme.json` colors. Run once; commit the migrated
`deck.json`. Script is idempotent (skips fields already arrays) and kept for
repeatability. Add an `npm run migrate:deck` script entry.

## 3. Layout engine (`layout/element.ts`, `shared.ts`, `families/*`)

- `Run` (`element.ts`) gains `underline?: boolean; highlight?: string`.
- Each family resolver maps a field's `Span[] → Run[]` (near 1:1). Element-level
  defaults still applied; spans override per run.
- Delete the `emphasis()` helper and `Emphasis` import from `shared.ts`.
  `bulletsElement` reads `b.runs` instead of `b.text`/`b.emphasis`.
- `Para.source` loses its "single-run only" constraint: a sourced paragraph may
  now carry multiple runs. The whole field is the editable unit. Multi-run
  output already flows through `Para.runs` in both renderers.

## 4. Renderers — add underline + highlight

Preview and export already render per-run bold/italic/color. Add the two new
marks in both:

- **Export** (`export-pptx.mts`, `addTextEl`): per run, add
  `underline: r.underline ? { style: "single" } : undefined` and
  `highlight: r.highlight ? hex(r.highlight) : undefined`.
- **Preview** (`Element.tsx`, per-run span style): add
  `textDecoration: r.underline ? "underline" : undefined` and
  `background: r.highlight`.

## 5. TipTap editor (`src/preview/RichTextEditor.tsx`, `src/preview/richtext.ts`)

Replaces `EditableText`. Double-clicking a sourced text mounts a TipTap editor
seeded from the field's `Span[]`, in a **single-paragraph schema** (Enter
commits, no block breaks; Escape discards).

- Extensions: `Document`, `Paragraph`, `Text`, `Bold`, `Italic`, `Underline`,
  `TextStyle`, `Color`, `Highlight`.
- `BubbleMenu` floating on selection: **B / I / U / text-color swatch /
  highlight swatch**, each toggling the matching mark command. Active-state
  reflects the current selection's marks.
- Serializer `richtext.ts`: `spansToDoc(spans: Span[])` → ProseMirror JSON, and
  `docToSpans(doc)` → `Span[]`, mapping marks ↔ Span fields. Adjacent runs with
  identical marks are merged on serialize.
- Commit path: on blur/Enter, serialize the doc → `Span[]`, POST to the edit API
  using the field's existing slide-relative `source` path. Escape restores the
  original spans without a write.

Dependencies (TipTap v2, MIT): `@tiptap/react`, `@tiptap/starter-kit` (or the
individual core extensions), `@tiptap/extension-underline`,
`@tiptap/extension-text-style`, `@tiptap/extension-color`,
`@tiptap/extension-highlight`, `@tiptap/extension-bubble-menu`.

## 6. Edit API (`vite-plugin-deck-api.ts`)

`/api/slides/edit` now writes a `Span[]` to the field path (`bullets.2.runs`,
`rows.0.cells.1`, `title`). `value` is already typed `unknown` and `setByPath`
writes arrays unchanged. Only the client-sent path/value shape changes — **no new
routes, no server logic change**. The `editSlideField` guard `leaf in node`
still holds because the target field already exists post-migration.

## 7. Scope and verification

**Deferred (not v1):** font family, font size, alignment, link, image insert;
footer/meta rich text; multi-paragraph fields.

**Verification:**

- `tsc -b` typecheck (build) passes after the model + renderer changes.
- Manual: `npm run dev`, edit a bullet, apply each of the five marks, confirm the
  preview renders them and `deck.json` stores spans.
- `npm run export`, open `out/deck.pptx`, confirm marks survive. Preview and
  export share `resolveSlide`, so parity is structural, but underline/highlight
  are new on both sides and must be eyeballed once.
- Migration idempotency: running the script twice leaves `deck.json` unchanged.

**Breaking change:** removing `emphasis` and `cellColors` is a hard model break.
The migration covers the repo's `deck.json`; any other hand-authored deck must
re-run the migration before it loads.
