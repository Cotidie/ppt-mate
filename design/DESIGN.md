# Design System: KAIST Light Academic Research Deck

Source: `docs/source/03-project-progress.pdf` (27 slides, 16:9). Reverse-engineered
visual system, not content. Hex values are approximate unless noted.

## 1. Design Intent
- **Observed from reference:** Light, near-white slides; KAIST navy/blue identity;
  kicker + bold title top-left; generous whitespace; rounded cards with navy filled
  headers; color-coded data tables; centered copyright footer on every slide; matplotlib
  charts and flaticon-style mascots dropped in as raster images.
- **Inferred but not directly visible:** A master template with three zones (kicker,
  body, footer). Most interior slides are built from a small set of reusable card and
  table layouts. Brand color is KAIST royal blue; green/red are semantic (factual vs
  hallucinated), amber is "attention/callout".
- **Overall impression:** Academic, corporate-clean, restrained, slightly utilitarian.
  Presentation-led with strong report/analyst-note streaks (dense tables, methods diagrams).
- **Appropriate use cases:** University/research progress decks, ML method replication
  reports, technical project reviews, results readouts with tables and PR curves.

## 2. Color System
- **Canvas / background:** very light cool off-white, approx `#F7F9FC` (some slides pure
  white `#FFFFFF`).
- **Primary text / titles:** dark navy-slate, approx `#1F2A44`.
- **Secondary text:** mid slate gray, approx `#5B6677`.
- **Kicker / eyebrow:** muted gray, approx `#9AA3AF` (consistent across all slides).
- **Accent 1 (brand blue):** KAIST royal blue, approx `#2B4FA0`; brighter link blue for
  emphasis/cover/closing, approx `#3B6FD4`.
- **Accent 2 (semantic):** success green `#2E8B57`/`#1F9D55` (factual, "Done", good
  metrics, closing underline); alert red `#D64545` (hallucinated, bad metrics); amber
  `#F2A93B` with pale-yellow fill `#FFE08A` (callouts, warnings, "OUTCOME" pill).
- **Card header fill:** dark navy `#2C3E5C` with white text.
- **Panel fill (insight/note bands):** pale blue `#EAF0FB`.
- **Dividers / borders:** light gray hairlines, approx `#D9DEE6`; dashed gray for diagram
  containers.
- **Chart colors:** NOT part of the deck system. Embedded matplotlib defaults
  (green/red/orange/purple/blue legend). See anti-patterns.
- **Banned / avoid:** dark IDE backgrounds inside light slides; saturated default chart
  palettes that ignore the brand; more than one accent hue per slide beyond the
  green/red/amber semantic set.

## 3. Typography System
- **Title style:** bold sans, large (approx 32-40pt), dark navy-slate, left-aligned,
  may run 2-4 lines on cover. WARNING: deck mixes TWO title families: a rounded
  geometric display (Poppins-like) on some slides and a plain neo-grotesk
  (Arial/Helvetica-like) on others. Pick ONE; see anti-patterns.
- **Section header / kicker:** small (approx 14-16pt), gray `#9AA3AF`, regular weight,
  Title case ("Replication approach", "Improvement Progress"), sits above the title.
- **Body style:** neo-grotesk sans, approx 16-18pt, slate gray; bullets use round
  markers and sub-bullets use hollow circles.
- **Caption / source / footnote:** approx 10-11pt, light gray, centered footer line
  "© 2026 Korea Advanced Institute of Science and Technology. KAIST. All rights reserved."
- **Numeric emphasis:** bold, semantic color (green for strong/good, red for weak/bad);
  inline keywords bolded in body text.
- **Observed casing:** Title case for kickers and most titles; occasional ALL-CAPS pill
  labels (INPUT, PROCESS, OUTCOME).
- **Observed line-length:** titles kept wide and short on body slides; cover title wraps
  to 4 lines. A few slides over-wrap awkwardly (see anti-patterns).

## 4. Layout Families
- **Cover / opener:** kicker top-left; large multi-line title; small citation under
  title; author list (name + ID) lower-left; KAIST circular seal top-right; centered
  footer.
- **Section divider:** near-blank slide, one bold centered phrase/word ("Math & Coding";
  "Consistent across samples = factual..."). Minimal or no kicker.
- **Insight / claim slide:** kicker + title top-left, then a large centered statement,
  sometimes with a downward arrow to a conclusion.
- **Chart / data slide:** kicker + title; embedded chart image(s); amber callout box with
  arrow connector annotating the takeaway.
- **Comparison slide:** 2-3 rounded cards side by side, each with a navy filled header
  bar and bulleted body; optional full-width note band beneath.
- **Table slide:** centered title + short verdict line ("Identical", "Coherent"); full
  bleed-ish table with navy header row and color-coded cells; reference/paper row tinted
  pale blue and italicized.
- **Process / timeline slide:** labeled boxes joined by connector arrows, dashed-line
  phase dividers, emoji/mascot actors; gantt timeline with Done/Active/Planned legend.
- **Closing / CTA:** centered "Thank You!" in brand blue, gray subtitle, short green
  underline rule, centered footer.

## 5. Flow Architecture
- **Title page flow:** kicker -> title -> citation -> authors -> seal -> footer.
- **Body page flow:** kicker (gray, top-left) -> bold title directly below -> content
  zone (cards / table / diagram / statement) -> optional full-width note band -> footer.
- **End page flow:** centered headline + subtitle + accent rule; footer retained.
- **Header / body / footer structure:** three persistent horizontal zones. Header =
  kicker + title (top-left aligned). Body = flexible content. Footer = centered copyright,
  present on nearly every slide including section dividers.
- **Header zone placement:** top-left, fixed left margin; kicker and title share the same
  left baseline.
- **Body zone placement:** below header with a clear gap; content blocks aligned to the
  same left margin or centered for divider/insight slides.
- **Footer zone placement:** horizontally centered at bottom; one gray line; never
  competes with body.

## 6. Grid, Alignment, and Spacing
- **Outer margins:** wide and consistent; comfortable left margin anchors kicker, title,
  and body. Generous top and bottom safe areas.
- **Column behavior:** 2-column for comparison cards, 3-column for process pills and
  three-card layouts; single column for statements/tables.
- **Text alignment:** left-aligned for kicker/title/body; centered for dividers, verdict
  lines, and the closing slide.
- **Whitespace philosophy:** airy; lots of empty canvas, especially on divider and
  insight slides. Avoids edge-to-edge density except in tables.
- **Density level:** low-to-medium on most slides; high on table and "issues" matrix
  slides (3-column problem/mitigation grids).
- **Object anchoring:** kicker/title pinned top-left; footer pinned bottom-center; seal
  pinned top-right on cover; callouts float near the element they annotate with an arrow.

## 7. Components
- **Title block:** gray kicker + bold navy title, stacked, top-left.
- **Subtitle / kicker:** gray Title-case eyebrow above the title; also used as a thin
  descriptor under big titles ("Zero-resource Black-box hallucination detection").
- **Bullets / key points:** round solid markers, hollow-circle sub-bullets; bold inline
  keywords.
- **Cards / callouts:** rounded rectangles; comparison cards have a navy filled header
  bar + light body; callouts are amber/pale-yellow rounded boxes, often with an arrow.
- **Tables:** navy header row with white labels; numeric cells color-coded (green good,
  red bad); paper/reference row tinted pale blue and italic; light row separators.
- **Charts:** embedded matplotlib raster images (PR curves, sample-size lines); not
  restyled to brand.
- **Legends / labels:** pill-shaped labels with light fill (INPUT/PROCESS/OUTCOME,
  Generate/Sample/Check, Team 1/Team 2); timeline legend swatches (green/navy/gray).
- **Icons / illustrations / photography:** flaticon-style mascots (blue blob human, blue
  robot, globe, Border Collie for Math-Shepherd), used as diagram actors; no photography.
- **Icon placement and usage:** decorative-to-explanatory; mascots sit inside process
  diagrams as actors. Emoji (⚠️ ✅ ❗ 🤔 ☹️) used as inline status markers, semi-systematic.
- **Infographic cards / metric cards:** navy-headed comparison cards and pill-labeled
  zone diagrams are the main infographic pattern; metric emphasis lives in tables, not
  standalone metric cards.
- **Diagram / flow modules:** left-to-right box-and-arrow flows with dashed phase
  dividers; downward arrows for cause/conclusion.

## 8. Data Visualization Language
- **Preferred chart families:** precision-recall curves (replication results) and
  line charts (metric vs sample size); gantt bars for timeline.
- **Axis / gridline treatment:** matplotlib defaults (visible axes, light gridlines).
  Not brand-aligned.
- **Labeling style:** small legends inside the plot; titles above each subplot.
- **Annotation style:** amber callout box + arrow pointing from the takeaway to the chart.
- **When to avoid charts:** for verdicts/comparisons, the deck prefers color-coded tables
  with a one-word verdict ("Identical", "Coherent") over charts.
- **Infographic composition:** card-led and pill-labeled-zone-led, not chart-led.
- **Icon-led data communication:** minimal; data lives in tables/charts, icons are
  actors not data carriers.
- **Diagram flow direction:** predominantly left-to-right with top-down arrows for
  conclusions; simple straight/elbow connectors.

## 9. Imagery and Graphic Treatment
- **Image crop / masking:** rectangular, no rounded masking on raster figures; figures
  placed as-is.
- **Gradients / fills:** mostly flat fills; pale tints for panels; no heavy gradients.
- **Shapes / panels / bands:** rounded rectangles for cards/callouts; full-width pale-blue
  note bands; dashed rounded containers for process diagrams.
- **Texture / shadows:** minimal, soft or no shadow; flat design overall.

## 10. Slide-System Rules
- **Repeats across most slides:** gray kicker + bold navy title top-left; centered
  copyright footer; rounded cards/callouts; brand-blue accents; green/red semantic coding.
- **Vary cautiously:** card count per row, presence of a bottom note band, chart vs table.
- **Body-slide layout discipline:** every interior slide = kicker + title + one primary
  content block (cards, table, diagram, or statement) + optional full-width note band.
  Keep the left margin and footer fixed.
- **Must remain consistent:** title family (CHOOSE ONE), kicker gray, footer text and
  placement, navy card headers, semantic color meanings.
- **Consistent across title/body/end pages:** brand blue, footer, left-aligned kicker/
  title on content pages (centered only for divider/insight/closing).
- **Icons/infographics repetition:** reuse the same mascot set and pill-label style; keep
  emoji status markers consistent in meaning if used at all.

## 11. Anti-Patterns
- Mixing two title font families across slides (rounded display vs plain neo-grotesk).
  Standardize on one.
- Modal-overlay slides: dark scrim + floating white cards layered on top of a still-visible
  previous slide (the "Confidence Prediction" pair). Build a clean standalone slide instead.
- Embedded matplotlib charts using default palettes that clash with the brand. Restyle to
  navy/blue + green/red semantics, or frame them as clearly-labeled figures.
- Dropping a dark-themed code screenshot into a light deck. Use a light code block or a
  restyled snippet.
- Off-topic / leftover slide from another deck (the cropped "Privacy Leakage in LLM Agents"
  slide) with a different illustration style. Remove or restyle to the system.
- Awkward title overflow ("...Compute bottlenecks on" with a hanging word). Keep titles
  wide and short; never let one word wrap alone.
- Near-empty placeholder dividers with only large centered text and no system framing
  (acceptable as intentional section breaks, but keep them deliberate, not unfinished).
- Inconsistent emoji as semantic markers. Either define a small fixed set or drop them.
