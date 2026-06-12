// Theme tokens compiled from design/DESIGN.md. The JSON is the editable source;
// this module gives it a type and a couple of unit constants shared by both renderers.

import themeJson from "../../theme.json";

export const PX_PER_IN = 96; // 13.333 in * 96 = 1280 px, 7.5 in * 96 = 720 px (16:9)
export const PT_PER_IN = 72;

export type Theme = {
  canvas: { w: number; h: number };
  colors: Record<string, string>;
  fonts: { title: string; body: string };
  type: {
    kicker: number;
    title: number;
    coverTitle: number;
    closingTitle: number;
    body: number;
    caption: number;
  };
  margin: { x: number; top: number; bottom: number };
  layout: {
    cardGap: number;
    cardRadius: number;
    cardHeaderH: number;
    footerH: number;
    lineHeightPt: number;
  };
};

export const theme = themeJson as Theme;

// pt height of a line of text, in inches (used for vertical stacking in resolvers).
export const ptToIn = (pt: number) => pt / PT_PER_IN;
