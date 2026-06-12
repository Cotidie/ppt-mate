# Rich Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user apply per-character formatting (bold, italic, underline, text color, highlight) to any inline-editable slide text via a floating TipTap toolbar, storing the result as span arrays in `deck.json`.

**Architecture:** `deck.json` text fields move from plain strings to `Span[]`. The shared `resolveSlide` engine maps spans to resolved `Run`s, which both the React preview and the pptxgenjs exporter render (with two new marks: underline, highlight). A TipTap single-paragraph editor with a `BubbleMenu` replaces the current plaintext `EditableText`, serializing selections back to `Span[]` through the existing `/api/slides/edit` route.

**Tech Stack:** TypeScript, React 18, Vite, pptxgenjs, TipTap v2 (ProseMirror), vitest (new, for pure-module tests).

---

## File map

**Create:**
- `src/preview/richtext.ts` — `Span[]` ↔ ProseMirror-doc serializer (pure).
- `src/preview/richtext.test.ts` — serializer round-trip tests.
- `src/model/migrate.ts` — pure `deck.json` migration transform.
- `src/model/migrate.test.ts` — migration tests.
- `scripts/migrate-deck-richtext.mts` — file-IO runner for the migration.
- `src/preview/RichTextEditor.tsx` — TipTap editor + `BubbleMenu`.
- `vitest.config.ts` — test config.

**Modify:**
- `package.json` — deps + `test`/`migrate:deck` scripts.
- `src/model/deck.ts` — `Span`/`RichText` types, fields → rich text.
- `src/layout/element.ts` — `Run` gains underline/highlight; `TableEl` cells become runs.
- `src/layout/shared.ts` — `spansToRuns` helper; header/footer/bullets read spans.
- `src/layout/families/{cover,body,comparison,table,closing}.ts` — map spans → runs.
- `src/preview/Element.tsx` — per-run styling, table runs, mount the new editor.
- `export/export-pptx.mts` — render underline/highlight + run-based table cells.

---

## Task 0: Tooling — dependencies and scripts

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install TipTap + vitest**

Run:
```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-underline @tiptap/extension-text-style \
  @tiptap/extension-color @tiptap/extension-highlight
npm install -D vitest
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add `test` and `migrate:deck`:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "export": "tsx export/export-pptx.mts",
    "test": "vitest run",
    "migrate:deck": "tsx scripts/migrate-deck-richtext.mts"
  },
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify the test runner starts**

Run: `npm test`
Expected: vitest runs and reports "No test files found" (no tests yet) and exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add tiptap and vitest tooling"
```

---

## Task 1: Add Span/RichText types (additive)

Adds the new stored types without yet changing existing fields, so the project still compiles.

**Files:**
- Modify: `src/model/deck.ts:4` (top of file, before `Bullet`)

- [ ] **Step 1: Add the `Span` and `RichText` types**

At the top of `src/model/deck.ts`, immediately after the opening comment block, add:
```ts
// A styled run of text as STORED in deck.json. Mirrors the resolved layout Run.
// Marks are user overrides; element-level defaults (title bold, kicker gray) are
// applied by resolvers, not baked into spans.
export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;     // hex
  highlight?: string; // hex
};

export type RichText = Span[];
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/model/deck.ts
git commit -m "feat: add Span/RichText model types"
```

---

## Task 2: Resolved Run gains underline + highlight; renderers honor them

Additive: extends the resolved `Run` and teaches both renderers the two new marks. No spans produce these yet, so behavior is unchanged.

**Files:**
- Modify: `src/layout/element.ts:8`
- Modify: `src/preview/Element.tsx:185-196` (non-source run rendering)
- Modify: `export/export-pptx.mts:25-39` (run options)

- [ ] **Step 1: Extend `Run`**

In `src/layout/element.ts`, replace the `Run` type:
```ts
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  highlight?: string;
};
```

- [ ] **Step 2: Add a shared run-style helper in the preview**

In `src/preview/Element.tsx`, add this helper above the `Paragraph` component (after the `box` function, around line 132):
```ts
function runStyle(r: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string }): CSSProperties {
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? "italic" : undefined,
    textDecoration: r.underline ? "underline" : undefined,
    color: r.color,
    background: r.highlight,
  };
}
```

- [ ] **Step 3: Use the helper for non-source runs**

In `src/preview/Element.tsx`, replace the `runs` map inside `Paragraph` (the block currently building `<span>` per run, ~lines 185-196) with:
```ts
  const runs = p.runs.map((r, i) => (
    <span key={i} style={runStyle(r)}>
      {r.text}
    </span>
  ));
```

- [ ] **Step 4: Render the marks in the exporter**

In `export/export-pptx.mts`, inside `addTextEl`, replace the `runs.push({...})` options object so it includes underline and highlight:
```ts
      runs.push({
        text: r.text,
        options: {
          bold: r.bold ?? p.bold ?? false,
          italic: r.italic,
          underline: r.underline ? { style: "sng" } : undefined,
          highlight: r.highlight ? hex(r.highlight) : undefined,
          color: hex(r.color ?? p.color ?? e.color),
          fontFace: p.font ?? e.font,
          fontSize: p.size ?? e.size,
          align: p.align ?? e.align ?? "left",
          bullet: p.bullet ? { indent: 14 + (p.indentLevel ?? 0) * 14 } : false,
          indentLevel: p.indentLevel ?? 0,
          breakLine: isLast,
          paraSpaceAfter: isLast ? p.spaceAfterPt ?? 0 : 0,
        },
      });
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/layout/element.ts src/preview/Element.tsx export/export-pptx.mts
git commit -m "feat: render underline and highlight on resolved runs"
```

---

## Task 3: Span ↔ ProseMirror serializer (TDD)

**Files:**
- Create: `src/preview/richtext.ts`
- Create: `src/preview/richtext.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/preview/richtext.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { spansToDoc, docToSpans } from "./richtext";
import type { Span } from "../model/deck";

describe("richtext serializer", () => {
  it("round-trips plain text", () => {
    const spans: Span[] = [{ text: "hello" }];
    expect(docToSpans(spansToDoc(spans))).toEqual([{ text: "hello" }]);
  });

  it("round-trips marks", () => {
    const spans: Span[] = [
      { text: "a", bold: true },
      { text: "b", italic: true, underline: true },
      { text: "c", color: "#D64545" },
      { text: "d", highlight: "#FFE08A" },
    ];
    expect(docToSpans(spansToDoc(spans))).toEqual(spans);
  });

  it("merges adjacent runs with identical marks", () => {
    const doc = spansToDoc([
      { text: "foo", bold: true },
      { text: "bar", bold: true },
    ]);
    expect(docToSpans(doc)).toEqual([{ text: "foobar", bold: true }]);
  });

  it("drops empty-text spans on serialize", () => {
    const doc = spansToDoc([{ text: "" }, { text: "x" }]);
    expect(docToSpans(doc)).toEqual([{ text: "x" }]);
  });

  it("represents an empty field as an empty paragraph", () => {
    const doc = spansToDoc([]);
    expect(doc.content[0].content).toBeUndefined();
    expect(docToSpans(doc)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `./richtext` (module not found).

- [ ] **Step 3: Implement the serializer**

Create `src/preview/richtext.ts`:
```ts
// Serializes between deck Span[] and a single-paragraph ProseMirror document.
// The TipTap editor edits one field, which is exactly one paragraph of inline
// runs — no block structure. Marks map 1:1 to Span fields.

import type { Span } from "../model/deck";

type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "textStyle"; attrs: { color: string } }
  | { type: "highlight"; attrs: { color: string } };

type TextNode = { type: "text"; text: string; marks?: Mark[] };

export type PMDoc = {
  type: "doc";
  content: [{ type: "paragraph"; content?: TextNode[] }];
};

export function spansToDoc(spans: Span[]): PMDoc {
  const content: TextNode[] = spans
    .filter((s) => s.text.length > 0)
    .map((s) => {
      const marks: Mark[] = [];
      if (s.bold) marks.push({ type: "bold" });
      if (s.italic) marks.push({ type: "italic" });
      if (s.underline) marks.push({ type: "underline" });
      if (s.color) marks.push({ type: "textStyle", attrs: { color: s.color } });
      if (s.highlight) marks.push({ type: "highlight", attrs: { color: s.highlight } });
      return marks.length ? { type: "text", text: s.text, marks } : { type: "text", text: s.text };
    });
  return {
    type: "doc",
    content: [{ type: "paragraph", content: content.length ? content : undefined }],
  };
}

export function docToSpans(doc: PMDoc): Span[] {
  const nodes = doc.content[0]?.content ?? [];
  const spans: Span[] = nodes
    .filter((n) => n.text.length > 0)
    .map((n) => {
      const span: Span = { text: n.text };
      for (const m of n.marks ?? []) {
        if (m.type === "bold") span.bold = true;
        else if (m.type === "italic") span.italic = true;
        else if (m.type === "underline") span.underline = true;
        else if (m.type === "textStyle" && m.attrs.color) span.color = m.attrs.color;
        else if (m.type === "highlight" && m.attrs.color) span.highlight = m.attrs.color;
      }
      return span;
    });
  return mergeAdjacent(spans);
}

function mergeAdjacent(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, s)) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

function sameMarks(a: Span, b: Span): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.highlight === b.highlight
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/preview/richtext.ts src/preview/richtext.test.ts
git commit -m "feat: add Span <-> ProseMirror serializer"
```

---

## Task 4: Migration transform (TDD)

Pure transform that rewrites an old-shape deck to the rich-text shape. Not yet run on `deck.json`.

**Files:**
- Create: `src/model/migrate.ts`
- Create: `src/model/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/model/migrate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { migrateDeck } from "./migrate";

describe("migrateDeck", () => {
  it("wraps plain strings as single spans", () => {
    const out = migrateDeck({
      meta: { title: "t", footer: "f" },
      slides: [{ id: "c", layout: "closing", title: "Hi", subtitle: "there" }],
    });
    expect(out.slides[0].title).toEqual([{ text: "Hi" }]);
    expect(out.slides[0].subtitle).toEqual([{ text: "there" }]);
    expect(out.meta).toEqual({ title: "t", footer: "f" });
  });

  it("folds bullet emphasis into span marks", () => {
    const out = migrateDeck({
      meta: { title: "t", footer: "f" },
      slides: [
        {
          id: "b",
          layout: "body",
          title: "T",
          bullets: [
            { text: "ok", emphasis: "green" },
            { text: "bad", emphasis: "red" },
            { text: "strong", emphasis: "bold" },
            { text: "sub", level: 1 },
          ],
        },
      ],
    });
    expect(out.slides[0].bullets).toEqual([
      { runs: [{ text: "ok", color: "#1F9D55", bold: true }] },
      { runs: [{ text: "bad", color: "#D64545", bold: true }] },
      { runs: [{ text: "strong", bold: true }] },
      { runs: [{ text: "sub" }], level: 1 },
    ]);
  });

  it("folds table cellColors into cell spans and drops cellColors", () => {
    const out = migrateDeck({
      meta: { title: "t", footer: "f" },
      slides: [
        {
          id: "tb",
          layout: "table",
          title: "T",
          columns: ["A", "B"],
          rows: [{ cells: ["x", "y"], cellColors: [undefined, "green"] }],
        },
      ],
    });
    expect(out.slides[0].columns).toEqual([[{ text: "A" }], [{ text: "B" }]]);
    expect(out.slides[0].rows).toEqual([
      { cells: [[{ text: "x" }], [{ text: "y", color: "#1F9D55" }]] },
    ]);
    expect("cellColors" in out.slides[0].rows[0]).toBe(false);
  });

  it("is idempotent", () => {
    const input = {
      meta: { title: "t", footer: "f" },
      slides: [{ id: "c", layout: "closing", title: "Hi" }],
    };
    const once = migrateDeck(input);
    const twice = migrateDeck(once);
    expect(twice).toEqual(once);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `./migrate`.

- [ ] **Step 3: Implement the migration**

Create `src/model/migrate.ts`:
```ts
// One-time transform: rewrites an old-shape deck (plain-string fields, bullet
// emphasis enum, table cellColors) into the rich-text shape (Span[] everywhere).
// Pure and idempotent: fields already in array form are passed through unchanged.

import theme from "../../theme.json";
import type { Span } from "./deck";

const GREEN = theme.colors.green;
const RED = theme.colors.red;

function toRich(v: unknown): Span[] {
  if (Array.isArray(v)) return v as Span[];
  return [{ text: String(v ?? "") }];
}

function emphasisToSpans(text: string, emphasis?: string): Span[] {
  if (emphasis === "green") return [{ text, color: GREEN, bold: true }];
  if (emphasis === "red") return [{ text, color: RED, bold: true }];
  if (emphasis === "bold") return [{ text, bold: true }];
  return [{ text }];
}

function migrateBullet(b: any): any {
  if (Array.isArray(b.runs)) return b;
  const out: any = { runs: emphasisToSpans(b.text, b.emphasis) };
  if (b.level != null) out.level = b.level;
  return out;
}

function colorCell(text: string, color?: string): Span[] {
  if (color === "green") return [{ text, color: GREEN }];
  if (color === "red") return [{ text, color: RED }];
  return [{ text }];
}

function migrateSlide(s: any): any {
  const out: any = { ...s };
  if (s.kicker != null) out.kicker = toRich(s.kicker);
  if (s.title != null) out.title = toRich(s.title);

  switch (s.layout) {
    case "cover":
      if (s.citation != null) out.citation = toRich(s.citation);
      if (s.authors) out.authors = s.authors.map(toRich);
      break;
    case "body":
      out.bullets = s.bullets.map(migrateBullet);
      if (s.note != null) out.note = toRich(s.note);
      break;
    case "comparison":
      out.cards = s.cards.map((c: any) => ({
        ...c,
        header: toRich(c.header),
        bullets: c.bullets.map(migrateBullet),
      }));
      if (s.note != null) out.note = toRich(s.note);
      break;
    case "table":
      if (s.verdict != null) out.verdict = toRich(s.verdict);
      out.columns = s.columns.map(toRich);
      out.rows = s.rows.map((r: any) => ({
        cells: r.cells.map((cell: any, i: number) =>
          Array.isArray(cell) ? cell : colorCell(cell, r.cellColors?.[i])
        ),
      }));
      break;
    case "closing":
      if (s.subtitle != null) out.subtitle = toRich(s.subtitle);
      break;
  }
  return out;
}

export function migrateDeck(deck: any): any {
  return { ...deck, slides: deck.slides.map(migrateSlide) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all migrate + serializer tests green).

- [ ] **Step 5: Commit**

```bash
git add src/model/migrate.ts src/model/migrate.test.ts
git commit -m "feat: add deck rich-text migration transform"
```

---

## Task 5: Flip the model to rich text and run the migration

The atomic breaking change: model fields become `RichText`, all resolvers and renderers consume `Span[]`/`Run[]`, `emphasis`/`cellColors` are removed, and `deck.json` is migrated. Inline editing is rendered **read-only** here (the TipTap editor arrives in Task 6).

**Files:**
- Modify: `src/model/deck.ts`
- Modify: `src/layout/shared.ts`
- Modify: `src/layout/families/cover.ts`
- Modify: `src/layout/families/body.ts`
- Modify: `src/layout/families/comparison.ts`
- Modify: `src/layout/families/table.ts`
- Modify: `src/layout/families/closing.ts`
- Modify: `src/layout/element.ts`
- Modify: `src/preview/Element.tsx`
- Modify: `export/export-pptx.mts`
- Modify: `deck.json` (via `npm run migrate:deck`)
- Create: `scripts/migrate-deck-richtext.mts`

- [ ] **Step 1: Replace the model field types**

Replace everything in `src/model/deck.ts` from the `Bullet` type downward (keep the `Span`/`RichText` block from Task 1) with:
```ts
export type Bullet = {
  runs: Span[];
  level?: 0 | 1; // 0 = top-level, 1 = sub-bullet
};

export type Card = {
  header: RichText;
  bullets: Bullet[];
};

export type TableRow = {
  cells: RichText[];
};

// navLabel: sidebar-only display name. Never rendered on the slide itself.
export type Slide =
  | {
      id: string;
      layout: "cover";
      navLabel?: string;
      kicker?: RichText;
      title: RichText;
      citation?: RichText;
      authors?: RichText[];
    }
  | {
      id: string;
      layout: "body";
      navLabel?: string;
      kicker?: RichText;
      title: RichText;
      bullets: Bullet[];
      note?: RichText;
    }
  | {
      id: string;
      layout: "comparison";
      navLabel?: string;
      kicker?: RichText;
      title: RichText;
      cards: Card[]; // 2-3
      note?: RichText;
    }
  | {
      id: string;
      layout: "table";
      navLabel?: string;
      kicker?: RichText;
      title: RichText;
      verdict?: RichText;
      columns: RichText[];
      rows: TableRow[];
      highlightRow?: number; // 0-based index into rows
    }
  | {
      id: string;
      layout: "closing";
      navLabel?: string;
      title: RichText;
      subtitle?: RichText;
    };

export type Deck = {
  meta: { title: string; footer: string };
  slides: Slide[];
};
```

- [ ] **Step 2: Update the resolved `TableEl` to carry runs**

In `src/layout/element.ts`, replace the `TableCell` and `TableEl` types:
```ts
export type TableCellEl = { runs: Run[]; source?: string };

export type TableEl = {
  kind: "table";
  x: number;
  y: number;
  w: number;
  h: number;
  columns: TableCellEl[];
  rows: TableCellEl[][];
  headerFill: string;
  headerColor: string;
  highlightRow?: number;
  highlightFill?: string;
  font: string;
  size: number; // pt
  borderColor: string;
  textColor: string;
};
```

- [ ] **Step 3: Replace `shared.ts` styling helpers**

Replace the contents of `src/layout/shared.ts` with:
```ts
// Shared layout helpers used by every family resolver: the persistent header
// (kicker + title, top-left) and the centered footer band.

import type { Theme } from "../theme/theme";
import { ptToIn } from "../theme/theme";
import type { Element, Para, Run, TextEl } from "./element";
import type { Span, Bullet } from "../model/deck";

export const CANVAS = { w: 13.333, h: 7.5 };

// Stored spans -> resolved runs. An empty field becomes one empty run so the
// renderers always have something to lay out.
export function spansToRuns(spans: Span[]): Run[] {
  if (!spans.length) return [{ text: "" }];
  return spans.map((s) => ({
    text: s.text,
    bold: s.bold,
    italic: s.italic,
    underline: s.underline,
    color: s.color,
    highlight: s.highlight,
  }));
}

// Header zone: gray kicker then bold navy title, both anchored to the left margin.
export function header(
  t: Theme,
  title: Span[],
  kicker?: Span[],
  opts?: { titleSize?: number; titleColor?: string }
): { elements: Element[]; contentTop: number } {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const els: Element[] = [];
  let y = t.margin.top;

  if (kicker) {
    els.push({
      kind: "text",
      x,
      y,
      w,
      h: ptToIn(t.type.kicker) * 1.4,
      paragraphs: [{ runs: spansToRuns(kicker), source: "kicker" }],
      font: t.fonts.body,
      size: t.type.kicker,
      color: t.colors.kicker,
      align: "left",
      valign: "top",
    });
    y += ptToIn(t.type.kicker) * 1.6;
  }

  const titleSize = opts?.titleSize ?? t.type.title;
  const titleH = ptToIn(titleSize) * 2.2;
  els.push({
    kind: "text",
    x,
    y,
    w,
    h: titleH,
    paragraphs: [{ runs: spansToRuns(title), bold: true, source: "title" }],
    font: t.fonts.title,
    size: titleSize,
    color: opts?.titleColor ?? t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: titleSize * 1.1,
  });

  return { elements: els, contentTop: y + titleH + 0.15 };
}

// Centered copyright footer (plain string; not user-editable).
export function footer(t: Theme, text: string): TextEl {
  return {
    kind: "text",
    x: t.margin.x,
    y: CANVAS.h - t.margin.bottom - t.layout.footerH,
    w: CANVAS.w - t.margin.x * 2,
    h: t.layout.footerH,
    paragraphs: [{ runs: [{ text }] }],
    font: t.fonts.body,
    size: t.type.caption,
    color: t.colors.kicker,
    align: "center",
    valign: "bottom",
  };
}

// One text element, one paragraph per bullet, so both renderers wrap natively.
export function bulletsElement(
  bullets: Bullet[],
  t: Theme,
  box: { x: number; y: number; w: number; h: number },
  opts?: { size?: number; sourcePrefix?: string }
): TextEl {
  const size = opts?.size ?? t.type.body;
  const prefix = opts?.sourcePrefix ?? "bullets";
  const paragraphs: Para[] = bullets.map((b, i) => ({
    runs: spansToRuns(b.runs),
    bullet: true,
    indentLevel: b.level ?? 0,
    spaceAfterPt: 6,
    align: "left",
    source: `${prefix}.${i}.runs`,
  }));
  return {
    kind: "text",
    ...box,
    paragraphs,
    font: t.fonts.body,
    size,
    color: t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: size * 1.35,
  };
}

// Full-width pale-blue note band with centered text.
export function noteBand(t: Theme, note: Span[]): Element[] {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const h = 0.8;
  const y = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - h;
  return [
    { kind: "rect", x, y, w, h, fill: t.colors.panel, radius: t.layout.cardRadius },
    {
      kind: "text",
      x: x + 0.3,
      y,
      w: w - 0.6,
      h,
      paragraphs: [{ runs: spansToRuns(note), source: "note" }],
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.brand,
      align: "center",
      valign: "middle",
    },
  ];
}
```

Note: `noteBand` now takes a `Span[]`. Callers pass `s.note` (already `RichText`). The `emphasis()` helper and `Emphasis` import are gone.

- [ ] **Step 4: Update `cover.ts`**

Replace `src/layout/families/cover.ts` with:
```ts
import type { Theme } from "../../theme/theme";
import { ptToIn } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, footer, spansToRuns } from "../shared";

type Cover = Extract<import("../../model/deck").Slide, { layout: "cover" }>;

export function resolveCover(s: Cover, t: Theme, footerText: string): Element[] {
  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const els: Element[] = [];
  let y = t.margin.top + 0.5;

  if (s.kicker) {
    els.push({
      kind: "text",
      x,
      y,
      w,
      h: ptToIn(t.type.kicker) * 1.4,
      paragraphs: [{ runs: spansToRuns(s.kicker), source: "kicker" }],
      font: t.fonts.body,
      size: t.type.kicker,
      color: t.colors.brandBright,
      align: "left",
      valign: "top",
    });
    y += ptToIn(t.type.kicker) * 2.0;
  }

  const titleW = w * 0.66;
  const titleH = ptToIn(t.type.coverTitle) * 5 * 1.12;
  els.push({
    kind: "text",
    x,
    y,
    w: titleW,
    h: titleH,
    paragraphs: [{ runs: spansToRuns(s.title), bold: true, source: "title" }],
    font: t.fonts.title,
    size: t.type.coverTitle,
    color: t.colors.textPrimary,
    align: "left",
    valign: "top",
    lineHeightPt: t.type.coverTitle * 1.12,
  });
  y += titleH + 0.1;

  if (s.citation) {
    const h = 0.6;
    els.push({
      kind: "text",
      x,
      y,
      w: w * 0.62,
      h,
      paragraphs: [{ runs: spansToRuns(s.citation), source: "citation" }],
      font: t.fonts.body,
      size: t.type.caption,
      color: t.colors.textSecondary,
      align: "left",
      valign: "top",
    });
    y += h + 0.15;
  }

  if (s.authors?.length) {
    els.push({
      kind: "text",
      x,
      y,
      w: w * 0.62,
      h: 1.6,
      paragraphs: s.authors.map((a, i) => ({
        runs: spansToRuns(a),
        spaceAfterPt: 4,
        source: `authors.${i}`,
      })),
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.textSecondary,
      align: "left",
      valign: "top",
      lineHeightPt: t.type.body * 1.5,
    });
  }

  els.push(footer(t, footerText));
  return els;
}
```

- [ ] **Step 5: Update `body.ts`**

In `src/layout/families/body.ts`, the only change is that `noteBand` already receives `s.note` (now `RichText`). Replace the file with:
```ts
import type { Theme } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, header, footer, bulletsElement, noteBand } from "../shared";

type Body = Extract<import("../../model/deck").Slide, { layout: "body" }>;

export function resolveBody(s: Body, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const noteH = s.note ? 1.0 : 0;
  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - noteH;

  els.push(
    bulletsElement(s.bullets, t, {
      x,
      y: contentTop + 0.1,
      w,
      h: bottomLimit - (contentTop + 0.1),
    })
  );

  if (s.note) els.push(...noteBand(t, s.note));
  els.push(footer(t, footerText));
  return els;
}
```

- [ ] **Step 6: Update `comparison.ts`**

Replace `src/layout/families/comparison.ts` with:
```ts
import type { Theme } from "../../theme/theme";
import type { Element, Para } from "../element";
import { CANVAS, header, footer, noteBand, spansToRuns } from "../shared";

type Comparison = Extract<import("../../model/deck").Slide, { layout: "comparison" }>;

export function resolveComparison(s: Comparison, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  const noteH = s.note ? 1.0 : 0;
  const top = contentTop + 0.15;
  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.2 - noteH;
  const cardH = bottomLimit - top;

  const n = s.cards.length;
  const gap = t.layout.cardGap;
  const cardW = (w - gap * (n - 1)) / n;
  const headerH = t.layout.cardHeaderH;
  const r = t.layout.cardRadius;

  s.cards.forEach((card, i) => {
    const cx = x + i * (cardW + gap);

    els.push({ kind: "rect", x: cx, y: top, w: cardW, h: cardH, fill: t.colors.cardBody, radius: r });
    els.push({ kind: "rect", x: cx, y: top, w: cardW, h: headerH, fill: t.colors.cardHeader, radius: r });
    els.push({
      kind: "text",
      x: cx + 0.25,
      y: top,
      w: cardW - 0.5,
      h: headerH,
      paragraphs: [{ runs: spansToRuns(card.header), bold: true, source: `cards.${i}.header` }],
      font: t.fonts.title,
      size: t.type.body + 2,
      color: t.colors.white,
      align: "left",
      valign: "middle",
    });

    const paragraphs: Para[] = card.bullets.map((b, j) => ({
      runs: spansToRuns(b.runs),
      bullet: true,
      indentLevel: b.level ?? 0,
      spaceAfterPt: 6,
      align: "left",
      source: `cards.${i}.bullets.${j}.runs`,
    }));
    els.push({
      kind: "text",
      x: cx + 0.3,
      y: top + headerH + 0.2,
      w: cardW - 0.6,
      h: cardH - headerH - 0.4,
      paragraphs,
      font: t.fonts.body,
      size: t.type.body,
      color: t.colors.textPrimary,
      align: "left",
      valign: "top",
      lineHeightPt: t.type.body * 1.35,
    });
  });

  if (s.note) els.push(...noteBand(t, s.note));
  els.push(footer(t, footerText));
  return els;
}
```

- [ ] **Step 7: Update `table.ts`**

Replace `src/layout/families/table.ts` with:
```ts
import type { Theme } from "../../theme/theme";
import type { Element, TableCellEl } from "../element";
import { CANVAS, header, footer, spansToRuns } from "../shared";

type TableSlide = Extract<import("../../model/deck").Slide, { layout: "table" }>;

export function resolveTable(s: TableSlide, t: Theme, footerText: string): Element[] {
  const { elements, contentTop } = header(t, s.title, s.kicker);
  const els: Element[] = [...elements];

  const x = t.margin.x;
  const w = CANVAS.w - t.margin.x * 2;
  let top = contentTop + 0.1;

  if (s.verdict) {
    const h = 0.5;
    els.push({
      kind: "text",
      x,
      y: top,
      w,
      h,
      paragraphs: [{ runs: spansToRuns(s.verdict), bold: true, source: "verdict" }],
      font: t.fonts.title,
      size: t.type.body + 4,
      color: t.colors.textPrimary,
      align: "center",
      valign: "middle",
    });
    top += h + 0.2;
  }

  const bottomLimit = CANVAS.h - t.margin.bottom - t.layout.footerH - 0.3;

  const columns: TableCellEl[] = s.columns.map((c, ci) => ({
    runs: spansToRuns(c),
    source: `columns.${ci}`,
  }));
  const rows: TableCellEl[][] = s.rows.map((r, ri) =>
    r.cells.map((cell, ci) => ({
      runs: spansToRuns(cell),
      source: `rows.${ri}.cells.${ci}`,
    }))
  );

  els.push({
    kind: "table",
    x,
    y: top,
    w,
    h: bottomLimit - top,
    columns,
    rows,
    headerFill: t.colors.cardHeader,
    headerColor: t.colors.white,
    highlightRow: s.highlightRow,
    highlightFill: t.colors.panel,
    font: t.fonts.body,
    size: t.type.body - 2,
    borderColor: t.colors.border,
    textColor: t.colors.textPrimary,
  });

  els.push(footer(t, footerText));
  return els;
}
```

- [ ] **Step 8: Update `closing.ts`**

Replace `src/layout/families/closing.ts` with:
```ts
import type { Theme } from "../../theme/theme";
import { ptToIn } from "../../theme/theme";
import type { Element } from "../element";
import { CANVAS, footer, spansToRuns } from "../shared";

type Closing = Extract<import("../../model/deck").Slide, { layout: "closing" }>;

export function resolveClosing(s: Closing, t: Theme, footerText: string): Element[] {
  const els: Element[] = [];
  const w = CANVAS.w - t.margin.x * 2;
  const x = t.margin.x;

  const titleH = ptToIn(t.type.closingTitle) * 1.4;
  const cy = CANVAS.h / 2 - titleH / 2 - 0.3;

  els.push({
    kind: "text",
    x,
    y: cy,
    w,
    h: titleH,
    paragraphs: [{ runs: spansToRuns(s.title), bold: true, source: "title" }],
    font: t.fonts.title,
    size: t.type.closingTitle,
    color: t.colors.brand,
    align: "center",
    valign: "middle",
  });

  let y = cy + titleH + 0.1;
  if (s.subtitle) {
    const h = 0.5;
    els.push({
      kind: "text",
      x,
      y,
      w,
      h,
      paragraphs: [{ runs: spansToRuns(s.subtitle), source: "subtitle" }],
      font: t.fonts.body,
      size: t.type.body + 1,
      color: t.colors.textSecondary,
      align: "center",
      valign: "top",
    });
    y += h + 0.15;
  }

  const ruleW = 1.2;
  els.push({
    kind: "rect",
    x: CANVAS.w / 2 - ruleW / 2,
    y,
    w: ruleW,
    h: 0.05,
    fill: t.colors.green,
    radius: 0.025,
  });

  els.push(footer(t, footerText));
  return els;
}
```

- [ ] **Step 9: Render runs read-only in the preview (text + table)**

In `src/preview/Element.tsx`:

(a) Replace the `Paragraph` component's source branch so a sourced paragraph renders its runs read-only (the editor is added in Task 6). Replace the whole `if (p.source) { ... }` block with:
```ts
  if (p.source) {
    return (
      <p style={style} data-source={p.source}>
        {bullet}
        {p.runs.map((r, i) => (
          <span key={i} style={runStyle(r)}>
            {r.text}
          </span>
        ))}
      </p>
    );
  }
```

(b) Replace the table rendering branch (`if (e.kind === "table") { ... }`) so header and body cells render runs:
```ts
  if (e.kind === "table") {
    const fs = e.size * PT_PX;
    return (
      <table
        style={{
          ...box(e),
          borderCollapse: "collapse",
          fontFamily: `'${e.font}', sans-serif`,
          fontSize: fs,
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr>
            {e.columns.map((c, i) => (
              <th
                key={i}
                data-source={c.source}
                style={{
                  background: e.headerFill,
                  color: e.headerColor,
                  textAlign: i === 0 ? "left" : "center",
                  padding: "6px 8px",
                  fontWeight: 600,
                  border: `1px solid ${e.borderColor}`,
                }}
              >
                {c.runs.map((r, ri) => (
                  <span key={ri} style={runStyle(r)}>
                    {r.text}
                  </span>
                ))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {e.rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri === e.highlightRow ? e.highlightFill : undefined }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  data-source={cell.source}
                  style={{
                    color: e.textColor,
                    fontWeight: ci === 0 ? 600 : 400,
                    fontStyle: ri === e.highlightRow ? "italic" : undefined,
                    textAlign: ci === 0 ? "left" : "center",
                    padding: "5px 8px",
                    border: `1px solid ${e.borderColor}`,
                  }}
                >
                  {cell.runs.map((r, rri) => (
                    <span key={rri} style={runStyle(r)}>
                      {r.text}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
```

(c) Delete the now-unused `EditableText`, `selectWordAt`, `caretRangeAt`, and `commitEdit` functions from the file. (They are replaced in Task 6.)

- [ ] **Step 10: Render run-based table cells in the exporter**

In `export/export-pptx.mts`, replace `addTableEl` so cells are built from runs:
```ts
function runsToTextProps(
  runs: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string }[],
  fallback: { color?: string; bold?: boolean; italic?: boolean }
): pptxgen.TextProps[] {
  return runs.map((r) => ({
    text: r.text,
    options: {
      bold: r.bold ?? fallback.bold,
      italic: r.italic ?? fallback.italic,
      underline: r.underline ? { style: "sng" } : undefined,
      highlight: r.highlight ? hex(r.highlight) : undefined,
      color: hex(r.color ?? fallback.color),
    },
  }));
}

function addTableEl(slide: pptxgen.Slide, e: Extract<Element, { kind: "table" }>) {
  const border = { type: "solid" as const, color: hex(e.borderColor), pt: 1 };

  const headerRow: pptxgen.TableRow = e.columns.map((c, ci) => ({
    text: runsToTextProps(c.runs, { color: e.headerColor, bold: true }),
    options: {
      fill: { color: hex(e.headerFill) },
      color: hex(e.headerColor),
      align: ci === 0 ? "left" : "center",
      valign: "middle",
    },
  }));

  const dataRows: pptxgen.TableRow[] = e.rows.map((row, ri) =>
    row.map((cell, ci) => ({
      text: runsToTextProps(cell.runs, {
        color: e.textColor,
        bold: ci === 0,
        italic: ri === e.highlightRow,
      }),
      options: {
        fill: ri === e.highlightRow && e.highlightFill ? { color: hex(e.highlightFill) } : undefined,
        align: ci === 0 ? "left" : "center",
        valign: "middle",
      },
    }))
  );

  const colW = e.columns.map((_, ci) =>
    ci === 0 ? e.w * 0.28 : (e.w * 0.72) / (e.columns.length - 1)
  );

  slide.addTable([headerRow, ...dataRows], {
    x: e.x,
    y: e.y,
    w: e.w,
    colW,
    border,
    fontFace: e.font,
    fontSize: e.size,
    valign: "middle",
    autoPage: false,
  });
}
```

- [ ] **Step 11: Create the migration runner**

Create `scripts/migrate-deck-richtext.mts`:
```ts
// Rewrites deck.json from the old plain-string shape to the rich-text Span[]
// shape. Idempotent: safe to run more than once.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrateDeck } from "../src/model/migrate";

const here = dirname(fileURLToPath(import.meta.url));
const deckPath = resolve(here, "..", "deck.json");
const deck = JSON.parse(readFileSync(deckPath, "utf8"));
const migrated = migrateDeck(deck);
writeFileSync(deckPath, JSON.stringify(migrated, null, 2) + "\n", "utf8");
console.log("migrated", deckPath);
```

- [ ] **Step 12: Run the migration on deck.json**

Run: `npm run migrate:deck`
Expected: prints `migrated .../deck.json`. Open `deck.json` and confirm bullets now have `runs`, the red/green issues bullets carry `color` + `bold`, and the table cells are arrays of `{text}`.

- [ ] **Step 13: Typecheck the whole project**

Run: `npx tsc -b`
Expected: no errors. (If `noteBand`, `header`, or family callers still reference `.text`/`emphasis`/`cellColors`, fix per the code above.)

- [ ] **Step 14: Manual smoke — view only**

Run: `npm run dev`, open http://localhost:5173. Confirm every slide renders, the red/green issue bullets keep their colors, and the table renders. (Double-click editing does nothing yet — expected; restored in Task 6.)

- [ ] **Step 15: Commit**

```bash
git add src/model/deck.ts src/layout export/export-pptx.mts src/preview/Element.tsx scripts/migrate-deck-richtext.mts deck.json
git commit -m "feat: migrate deck text fields to rich-text spans"
```

---

## Task 6: TipTap editor with floating toolbar

Replaces read-only sourced text with an in-place TipTap editor; a `BubbleMenu` toggles the five marks; commits serialize to `Span[]` and POST to the edit API.

**Files:**
- Create: `src/preview/RichTextEditor.tsx`
- Modify: `src/preview/Element.tsx` (mount the editor on sourced text + table cells)

- [ ] **Step 1: Build the editor component**

Create `src/preview/RichTextEditor.tsx`:
```tsx
// In-place rich-text editor for a single deck field. Renders the field's runs;
// double-click enters edit mode with a TipTap single-paragraph editor and a
// floating BubbleMenu (B/I/U/color/highlight). Enter or blur commits the
// serialized Span[] to deck.json via /api/slides/edit; Escape discards.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import type { Span } from "../model/deck";
import { spansToDoc, docToSpans, type PMDoc } from "./richtext";

const COLOR = "#D64545";
const HIGHLIGHT = "#FFE08A";

// Single-paragraph schema: no hard breaks, so Enter is free to commit.
const OneLineDocument = Document.extend({ content: "paragraph" });

export function RichTextEditor({
  slideId,
  path,
  spans,
  runStyle,
  children,
}: {
  slideId: string;
  path: string;
  spans: Span[];
  runStyle: (r: Span) => CSSProperties;
  children: React.ReactNode; // read-only run rendering, shown when not editing
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span
        className="slide-editable"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {children}
      </span>
    );
  }
  return (
    <EditorInstance
      slideId={slideId}
      path={path}
      spans={spans}
      onClose={() => setEditing(false)}
    />
  );
}

function EditorInstance({
  slideId,
  path,
  spans,
  onClose,
}: {
  slideId: string;
  path: string;
  spans: Span[];
  onClose: () => void;
}) {
  const editor = useEditor({
    extensions: [
      OneLineDocument,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: spansToDoc(spans),
    autofocus: "end",
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return true;
        }
        return false;
      },
    },
  });

  const commit = async () => {
    if (!editor) return;
    const next = docToSpans(editor.getJSON() as PMDoc);
    onClose();
    await commitSpans(slideId, path, next);
  };

  // Keep arrow keys from flipping slides while the editor is focused.
  useEffect(() => {
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, []);

  if (!editor) return null;

  return (
    <span className="slide-editable editing">
      <BubbleMenu editor={editor} className="rt-bubble">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "on" : ""}><b>B</b></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "on" : ""}><i>I</i></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive("underline") ? "on" : ""}><u>U</u></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setColor(COLOR).run()} title="Text color">A</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().unsetColor().run()} title="Clear color">A×</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run()} className={editor.isActive("highlight") ? "on" : ""} title="Highlight">H</button>
      </BubbleMenu>
      <EditorContent editor={editor} onBlur={commit} />
    </span>
  );
}

async function commitSpans(id: string, path: string, value: Span[]): Promise<void> {
  const res = await fetch("/api/slides/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, path, value }),
  });
  if (!res.ok) alert("Edit failed. Is the dev server running?");
}
```

- [ ] **Step 2: Mount the editor on sourced text in `Element.tsx`**

In `src/preview/Element.tsx`, import the editor at the top:
```ts
import { RichTextEditor } from "./RichTextEditor";
```

Then replace the sourced-paragraph branch from Task 5 Step 9(a) with a version that wraps the runs in the editor:
```ts
  if (p.source) {
    return (
      <p style={style} data-source={p.source}>
        {bullet}
        <RichTextEditor
          slideId={slideId}
          path={p.source}
          spans={p.runs as unknown as import("../model/deck").Span[]}
          runStyle={runStyle}
        >
          {p.runs.map((r, i) => (
            <span key={i} style={runStyle(r)}>
              {r.text}
            </span>
          ))}
        </RichTextEditor>
      </p>
    );
  }
```

Note: resolved `Run` and stored `Span` are structurally identical (text + the five optional marks), so passing `p.runs` as `Span[]` is sound; the cast documents that.

- [ ] **Step 3: Mount the editor on table cells**

In the table branch of `Element.tsx`, wrap each header cell's and body cell's run rendering in `RichTextEditor`, keyed by the cell's `source`. For a header cell:
```tsx
                {c.source ? (
                  <RichTextEditor
                    slideId={slideId}
                    path={c.source}
                    spans={c.runs as unknown as import("../model/deck").Span[]}
                    runStyle={runStyle}
                  >
                    {c.runs.map((r, ri) => (
                      <span key={ri} style={runStyle(r)}>{r.text}</span>
                    ))}
                  </RichTextEditor>
                ) : (
                  c.runs.map((r, ri) => <span key={ri} style={runStyle(r)}>{r.text}</span>)
                )}
```
Apply the identical pattern to the body `<td>`, using `cell.source` and `cell.runs`.

- [ ] **Step 4: Add minimal bubble-menu styling**

In `src/styles.css`, append:
```css
.rt-bubble {
  display: flex;
  gap: 2px;
  background: #1f2a44;
  border-radius: 6px;
  padding: 3px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.rt-bubble button {
  min-width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.rt-bubble button.on {
  background: #3b6fd4;
}
.slide-editable.editing {
  outline: 1px solid #3b6fd4;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Manual smoke — full editing loop**

Run: `npm run dev`. For a body bullet: double-click → editor appears → select a word → bubble shows → click **B**, **I**, **U**, **A** (color), **H** (highlight) → press Enter. Confirm the mark renders and `deck.json` now stores the run with the matching field (e.g. `{ "text": "...", "bold": true }`). Repeat once for a table cell and once for a title.

- [ ] **Step 7: Commit**

```bash
git add src/preview/RichTextEditor.tsx src/preview/Element.tsx src/styles.css
git commit -m "feat: in-place TipTap rich-text editor with floating toolbar"
```

---

## Task 7: Full verification and export parity

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: PASS (serializer + migration suites).

- [ ] **Step 2: Typecheck + production build**

Run: `npm run build`
Expected: `tsc -b` clean, `vite build` succeeds.

- [ ] **Step 3: Export and inspect the PPTX**

Run: `npm run export`, then open `out/deck.pptx` in a viewer. Confirm: the red/green issue bullets are colored, any marks you applied in Task 6 Step 6 survive into the file, and the table renders with the highlighted last row italicized.

- [ ] **Step 4: Migration idempotency**

Run: `npm run migrate:deck` a second time, then `git diff deck.json`.
Expected: no diff (already migrated).

- [ ] **Step 5: Final commit (if anything changed)**

```bash
git add -A
git commit -m "test: verify rich-text editing end to end" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** §1 model → Task 1 + Task 5 Step 1; §2 migration → Task 4 + Task 5 Steps 11-12; §3 engine → Task 2 + Task 5 Steps 2-8; §4 renderers → Task 2 + Task 5 Steps 9-10; §5 TipTap editor → Task 6; §6 edit API (client sends `Span[]`, server unchanged) → Task 6 Step 1 `commitSpans`; §7 verification → Task 7.
- **Type consistency:** `Span` (model) and `Run` (layout) share the same five optional marks; `spansToRuns` is the only span→run bridge; `TableCellEl` is used by `table.ts`, `element.ts`, `Element.tsx`, and `export-pptx.mts` consistently. Serializer exports `spansToDoc`/`docToSpans`/`PMDoc` used by `RichTextEditor.tsx`.
- **Deferred (not in any task):** font family, size, alignment, link, image insert; footer/meta rich text; multi-paragraph fields.
