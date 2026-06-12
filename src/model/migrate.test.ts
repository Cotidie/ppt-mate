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
