// Resolved element types. Geometry is in INCHES; text sizes in POINTS.
// The preview converts inches->px (x96); the exporter passes inches straight to pptxgenjs.
// This file has no DOM and no Node deps so both renderers can import it.

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  highlight?: string;
};

export type Para = {
  runs: Run[];
  align?: Align;
  bullet?: boolean;
  indentLevel?: number; // 0 | 1
  size?: number; // pt, overrides element default
  color?: string;
  bold?: boolean;
  font?: string;
  spaceAfterPt?: number;
  // Dotted path (relative to the slide) of the deck field this text came from.
  // Present => the preview renders it inline-editable (rich text, multiple runs).
  source?: string;
};

export type TextEl = {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs: Para[];
  font: string; // default face
  size: number; // default pt
  color: string; // default color
  align?: Align;
  valign?: VAlign;
  lineHeightPt?: number;
};

export type RectEl = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  line?: string;
  lineWidthPt?: number;
  radius?: number; // inches (corner radius)
};

export type ImageEl = {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  path: string;
};

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

export type Element = TextEl | RectEl | ImageEl | TableEl;
