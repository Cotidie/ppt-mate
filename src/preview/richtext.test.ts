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
