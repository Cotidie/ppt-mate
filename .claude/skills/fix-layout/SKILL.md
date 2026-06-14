---
name: fix-layout
description: "Use when a slide looks visually wrong - text overflowing its box, elements off-canvas or overlapping, a footer/citation colliding with content above, columns or cards misaligned, low-contrast text, or cramped/uneven spacing - to review the active slide against this deck's layout rules and fix it by editing deck.json / theme.json. Also use proactively after a content edit that may have broken the layout, or when the context header flags a render issue (overflow / off-canvas)."
---

# Fix layout

Review the active slide for layout/formatting problems and fix them. **Assume there
are problems and hunt for them** - the slide is rarely perfect on first look. If you
found nothing, you did not look hard enough.

This deck is rendered from `deck.json` + `theme.json` by a shared layout engine
(inches, fixed 16:9 canvas = 13.333 x 7.5 in). You never touch the DOM or CSS; you
fix layout by editing the model.

Work in three phases: **scan** (content + geometry + a rendered image), **review**
(find issues against the checklist), **fix** (minimal edit, then re-render to
verify). Loop until a clean pass.

## 1. Scan (gather evidence - don't guess)

Get both the data AND a picture of the slide:

- `mcp__deck__get_active_slide` - the slide's JSON **and** its resolved elements
  with positions/sizes in inches, **and** the measured render issues (text
  overflowing, elements off-canvas) the browser reported.
- `mcp__deck__render_slide` - **renders the slide the user is viewing to an image
  and shows it to you.** Always do this: look at the actual pixels, do not reason
  from JSON alone. It is the same fonts/layout the user sees.
- `mcp__deck__get_design_system` - margins, type sizes, colors, layout spacing
  (the `theme.json` tokens) and the canvas size.
- `mcp__deck__get_selection` - if the user selected an element or attached a visual
  crop of a region, start there.
- If the user attached an image crop, inspect it pixel-by-pixel for the issues below.

**The reported render flags are hints, not ground truth — never stop at them.**
They can be masked: e.g. a geometry `override` that enlarges a text element's box
means its text no longer exceeds *its own* box, so a naive check sees no overflow,
yet the text still spills past the card/container it visually sits in. Do your own
geometric pass (step 2) over the resolved boxes AND read the rendered image, and
trust the pixels over any flag. If a slide looks wrong but nothing is flagged,
believe your eyes and the geometry.

## 2. Review (find issues)

Walk every element of the active slide against this list, cross-checking the
rendered image against the geometry. List what you find before fixing anything.

**Inspect the rendered image** for things geometry can't show: text visibly cut off
or overlapping, elements colliding, low-contrast text, uneven/cramped spacing,
misalignment, a title that doesn't read as the title. Then confirm each against the
boxes below.

- **Overflow**: an element's rendered height exceeds its box (the render facts flag
  this). Text spilling past a card / off the slide.
- **Containment** (check geometrically, don't trust flags): for every element,
  verify its resolved box stays inside whatever it visually sits within. In
  particular a card's body/text must stay inside that card's background rect -
  i.e. `body.y + body.h <= cardRect.y + cardRect.h` (and the same for x/width).
  An `override` on the text but not on the card rect is the classic way text ends
  up poking out the bottom of a card while nothing is flagged. Compare each
  sibling pair (e.g. all `card.N.*`) this way.
- **Off-canvas**: an element's box extends past 0..13.333 in x or 0..7.5 in y.
- **Overlap / collision**: two boxes overlap when they shouldn't; the footer or a
  citation colliding with content above it.
- **Margins**: content closer than the deck's `margin` tokens to the slide edge
  (default x 0.9, top 0.7, bottom 0.5 in). Keep at least the margin.
- **Alignment**: columns/cards/comparison panels not sharing the same x / width /
  top; bullets at inconsistent indents.
- **Spacing**: gaps smaller than the `layout.cardGap` token, or wildly uneven
  empty space (cramped in one place, large void in another).
- **Contrast**: text color too close to its background (e.g. light text on the
  light `bg`, or a card body color near its card fill).
- **Type hierarchy**: title not clearly larger than body; a wall of same-size text.
- **Never** add a decorative accent line under a title - it reads as AI-generated;
  use whitespace or a background tone instead.

## 3. Diagnose root cause

Map each issue to why it happens before fixing: too much text for the box, a
geometry `override` pushing an element out, a type token too large, a layout family
that's wrong for the content amount.

## 4. Fix with the right lever (minimal change)

In rough order of preference:

1. **Trim / tighten the text** (`deck.json` field) - usually the real fix for
   overflow; slide copy should be terse.
2. **Adjust a type token** (`theme.json` `type.*`) - if the whole deck runs large;
   changes every slide consistently, so prefer this over per-element hacks only
   when the size is globally wrong.
3. **Geometry override** - set/adjust the slide's `overrides[<elementKey>]`
   (`dx/dy/dw/dh`, inches) to move/resize one element. Use for a one-off nudge.
   Note a *stale* override can be the cause (e.g. a text box enlarged past its
   card): removing or shrinking that override is often the fix, not adding one.
4. **Restructure / change layout** - if the content simply doesn't fit the family
   (e.g. too many bullets for `body`), move to a roomier layout or split the slide.

Keep edits minimal and targeted; change the one thing, leave the rest.

## 5. Re-verify (loop)

After an edit the preview hot-reloads and the render facts update. **Re-check the
slide** with `get_active_slide` AND **`render_slide` again to SEE the result** - one
fix often exposes or causes another (trimming text shifts everything below it), and
the image is the only way to confirm the visual problem is actually gone. Repeat
scan -> review -> fix until a full pass (clean image + clean geometry) turns up
nothing new. Do not declare done after a single fix without re-rendering.
