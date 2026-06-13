// Deck content model = single source of truth. Both the React preview and the PPTX
// exporter read this. Conversational edits mutate this data (deck.json), never the DOM.

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

// Sentinel `source` marking the deck-wide footer (deck.meta.footer) as inline-
// editable. Not a slide field path: the editor commits it via /api/footer, which
// updates the single meta string shown on every slide.
export const FOOTER_SOURCE = "meta.footer";

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

// Per-element geometry overrides (inches), keyed by the resolver's stable element
// key. Deltas (not absolute) so a moved/resized element survives content/theme
// reflow: dx/dy shift position, dw/dh adjust size. All optional.
export type Overrides = Record<string, { dx?: number; dy?: number; dw?: number; dh?: number }>;

// navLabel: sidebar-only display name. Never rendered on the slide itself.
export type Slide =
  | {
      id: string;
      layout: "cover";
      navLabel?: string;
      overrides?: Overrides;
      kicker?: RichText;
      title: RichText;
      citation?: RichText;
      authors?: RichText[];
    }
  | {
      id: string;
      layout: "body";
      navLabel?: string;
      overrides?: Overrides;
      kicker?: RichText;
      title: RichText;
      bullets: Bullet[];
      note?: RichText;
    }
  | {
      id: string;
      layout: "comparison";
      navLabel?: string;
      overrides?: Overrides;
      kicker?: RichText;
      title: RichText;
      cards: Card[]; // 2-3
      note?: RichText;
    }
  | {
      id: string;
      layout: "table";
      navLabel?: string;
      overrides?: Overrides;
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
      overrides?: Overrides;
      title: RichText;
      subtitle?: RichText;
    };

export type Deck = {
  meta: { title: string; footer: string };
  slides: Slide[];
};
