// Deck content model = single source of truth. Both the React preview and the PPTX
// exporter read this. Conversational edits mutate this data (deck.json), never the DOM.

export type Emphasis = "green" | "red" | "bold";

export type Bullet = {
  text: string;
  level?: 0 | 1; // 0 = top-level, 1 = sub-bullet
  emphasis?: Emphasis;
};

export type Card = {
  header: string;
  bullets: Bullet[];
};

export type CellColor = "green" | "red" | undefined;

export type TableRow = {
  cells: string[];
  // optional per-cell semantic color, index-aligned to cells
  cellColors?: CellColor[];
};

// navLabel: sidebar-only display name. Never rendered on the slide itself;
// purely an authoring aid. Falls back to `title` when absent.
export type Slide =
  | {
      id: string;
      layout: "cover";
      navLabel?: string;
      kicker?: string;
      title: string;
      citation?: string;
      authors?: string[];
    }
  | {
      id: string;
      layout: "body";
      navLabel?: string;
      kicker?: string;
      title: string;
      bullets: Bullet[];
      note?: string;
    }
  | {
      id: string;
      layout: "comparison";
      navLabel?: string;
      kicker?: string;
      title: string;
      cards: Card[]; // 2-3
      note?: string;
    }
  | {
      id: string;
      layout: "table";
      navLabel?: string;
      kicker?: string;
      title: string;
      verdict?: string;
      columns: string[];
      rows: TableRow[];
      highlightRow?: number; // 0-based index into rows
    }
  | {
      id: string;
      layout: "closing";
      navLabel?: string;
      title: string;
      subtitle?: string;
    };

export type Deck = {
  meta: { title: string; footer: string };
  slides: Slide[];
};
