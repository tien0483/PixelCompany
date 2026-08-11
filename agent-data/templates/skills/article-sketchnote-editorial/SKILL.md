---
name: article-sketchnote-editorial
en_name: "Editorial Sketchnote"
emoji: "📒"
description: "Cast a concept into a magazine feature dossier — real problem → failure → turning point → insight → naming, with 6 layout moulds, 4-typeface contrast and detective-dossier details"
category: article
scenario: education
aspect_hint: "1080 × adaptive (vertical long image)"
tags: ["sketchnote", "magazine", "editorial", "narrative", "concept-history"]
example_id: sample-sketchnote-emergence
example_name: "Sketchnote · The Naming of Emergence"
example_format: markdown
example_tagline: "Reductionism fails → Anderson 1972"
example_desc: "A concept-history feature that ends with 'emergence', paced by 6 layouts = open → tight → tight → burst → open → still"
example_source_url: "https://github.com/lijigang/ljg-skills/tree/master/skills/ljg-card"
example_source_label: "lijigang/ljg-skills · ljg-card"
---

# Template: Editorial Sketchnote

**Soul** — cast a **concept** into an editorial illustrated dossier. Reading it is like flipping through a magazine special issue: from a real problem (issue masthead) → a failed attempt (sticky-note annotations, dossier labels) → a "wait —" turning point (cross-column headline) → seeing the thing (hero spread) → the name (closing nameplate).

**Not a museum display — a magazine column. Not a textbook definition — a detective dossier.** Visuals and narrative together make the reader live through the arc of "stuck — dead end — turn the page — you see it". Restrained copy; never spell it out.

[Six Axioms — if any fails, redo]

1. **A real problem up front** — the starting point is a concrete, touchable, stuck problem. Not "what is X", but "the tools people had — A, B, C — were not enough". The problem must have a crack.
2. **There must be a failure** — at least one failure (or detour, half-right attempt) along the way. A linear "therefore" kills the tension.
3. **Insight first, naming last** — the reader "sees" first, then is told "this is called …". **The concept name must not appear in the title.**
4. **"Now" perspective** — each station is "what he/she could see at that moment", not "we, looking back 100 years later". Later judgments stay out of the frame.
5. **Restrained copy, no signposting** — no meta self-reference like "you just learned a concept" or "you gave birth to it". Let the narrative tension produce the sense of invention itself. Poetic resonance is allowed ("and so, you see the mountain").
6. **Write in the content's language (English by default)** — verb-driven, concrete objects, colloquial rhythm. Forbidden translation-ese: "was X-ed", "carry out X", "in the context of ...", "with the development of X", "this method shows advantages across multiple dimensions".

[Six Layout Moulds — rhythm locked]

Each station must use a **different** layout for rhythm to emerge:

| # | Station | class | Visual signature |
|---|---|---|---|
| 01 | Start / Feature | `.feature` | Cream ground + 6fr/6fr grid, large SVG left / text right; kicker + Serif headline + italic lead + drop-cap body |
| 02 | Failure 1 / Note | `.note` | Two-column grid (left sidekick doodle area + right 540px sticky note); note rotated 0.5deg + dashed perforation on top + red strikethrough + scribble + footnote ¹ |
| 03 | Failure 2 / Archive | `.archive` | Full width + black stamp (168px, with big ✕) + right body + SVG grid figure + red italic verdict |
| 04 | Turning point / Cross | `.cross` | Full width + Serif 200px **content-driven turning burst** (no generic "wait") + amber highlight + two columns |
| 05 | Insight / Hero | `.hero` | Blue 4px top border + 7fr/5fr grid; large SVG left / pull-quote right + drop-cap body |
| 06 | Naming / Closing | `.closing` | Cream ground + double top border + centered symmetry + huge Serif name + byline between hairlines + epilogue |

**Rhythm rule**: open (feature) → tight (note, offset) → tight (archive, wide) → burst (cross 200px) → open (hero) → still (closing, centered). Not evenly spaced — it breathes: open and tight alternate, the turning point explodes, and the end returns to centered symmetry.

**Forbidden**: all 6 sections evenly spaced with 60-80px margin-top = gallery display, not comic panels — redo.

[Typeface Contrast — all four must appear]

- **Serif** (`Noto Serif SC`): magazine main title, mega-name, italic lead, pull-quote
- **Sans** (`Noto Sans SC`): body-sans, failed-station heads, text after kicker
- **Mono** (`JetBrains Mono` / `SF Mono`): number num, kicker label, byline, footnote ¹, stamp
- **Hand** (`Caveat` / cursive): handwritten annotations, ask questions, captions

**Any one missing = the visual collapses back to AI's single-typeface uniformity — the soul breaks.**

[Colour System — ≤4 primary colours]

```
--bg:          #FAF7EF   /* warm cream ground */
--paper:       #F5F1E5   /* cream card (feature/closing ground) */
--ink-strong:  #0F0F0F   /* important text, avoid #000 */
--ink:         #1F1F1F   /* body */
--ink-light:   #6B6B6B   /* kicker, caption */
--red:         #B23A2C   /* error, annotation, emphasis */
--blue-deep:   #3D5A80   /* insight visual */
--amber:       #BB8A2B   /* turning-point cue */
--amber-soft:  #D7A85A   /* highlight ground */
```

**No pure `#000` black.** ≤4 primary colours (red + blue + amber + neutrals).

[Mandatory Structural Pieces]

`kicker / drop-cap / byline / stamp` are structural requirements. Others used as needed:

- **kicker** — station number + type label: Mono uppercase 13px + black number chip + 36px dash
- **drop-cap** — body first letter: `::first-letter` float left, 96px Serif
- **lead** — feature intro: italic 23px Serif + red 2px left border
- **pull-quote** — hero key line: italic 38px Serif + blue 4px border + floating 100px \201C quote mark
- **strike** — failed body keyword: `text-decoration: line-through` red 2.5px
- **scribble** — note red-pen annotation: Caveat 24px + 6deg rotation + red + dashed red border
- **stamp** — archive failure stamp: black ground white 12px Mono + ✕ Serif 64px
- **verdict** — archive closing statement: italic 19px Serif red + dashed top separator
- **footnote** — note footnote: Mono 13px + ¹ superscript
- **byline** — closing attribution: Mono 14px uppercase + letter-spacing 0.18em + top/bottom hairlines
- **mega** — cross turning-point burst: Serif 200px + amber gradient highlight (1-3 key characters)
- **epilogue** — closing resonance: italic 26px Serif + red `—` dash prefix

[sidekick doodle area — note mould left column must not be empty]

Three ways to fill it (choose by content, don't pile up):
- **SVG sketch** — the essence of the failure can be drawn in 1-2 visual poses → `<svg viewBox="0 0 280 220">` line drawing + red-pen annotation
- **Handwritten formula** (`.formula`) — the failure essence compresses into a 1-3 line textual relationship → Caveat 22px + dashed left border + slight -1deg rotation
- **Arrow annotation** (`.arrow`) — single-point emphasis → Caveat 26px + 6deg rotation + red

**Constraints**: sidekick is a footnote, doesn't steal the show / doodle feel over polish (askew, dashed, gaps) / restrained colour (black-grey + red) / low content density (prefer less, don't cram three figures).

[HTML Skeleton (agent reuses structure; content follows the narrative arc)]

```html
<div class="magazine-head">
  <div class="top-bar">
    <div class="left"><span class="badge">№ 01</span><span>[FIELD · YEAR]</span></div>
    <div class="right">[ENGLISH CATEGORY]</div>
  </div>
  <h1>[non-spoiler title]<br>[optional second line]</h1>
  <p class="deck">[italic intro: hint at the problem without revealing the answer]</p>
</div>

<section class="feature">
  <div class="visual"><svg>[large SVG, max-width 540]</svg></div>
  <div class="meta">
    <div class="kicker"><span class="num">01</span><span class="rule"></span>Start · [time-place anchor]</div>
    <h2 class="head-serif">[the stuck problem]</h2>
    <p class="lead">[one concise line framing the problem]</p>
    <div class="body-sans drop-cap"><p>[concrete example]</p><p>[key turning point emphasised with <em></em>]</p><span class="ask">[open question?]</span></div>
  </div>
</section>

<aside class="note">
  <div class="sidekick">
    <!-- pick one: SVG / .formula / .arrow + optional .doodle-caption -->
  </div>
  <div class="paper">
    <div class="kicker"><span class="num">02</span>First attempt</div>
    <h3 class="head-sans">[action name]</h3>
    <div class="body-serif"><p>[the idea]</p><p>the failure uses <span class="strike">strikethrough</span></p></div>
    <div class="footnote"><span class="mark">¹</span><span>[root cause]</span></div>
    <div class="scribble">[one red-pen annotation]</div>
  </div>
</aside>

<section class="archive">
  <div class="stamp"><div class="label">EX-02</div><div class="x">✕</div><div class="case">Failed</div></div>
  <div class="body-area">
    <div class="kicker"><span>Second attempt</span></div>
    <h3 class="head-sans">[action name]</h3>
    <div class="visual"><svg>[failure diagram]</svg></div>
    <div class="body-serif"><p>[idea + failure]</p></div>
    <div class="verdict">[closing statement]</div>
  </div>
</section>

<section class="cross">
  <h2 class="mega"><span class="em">[turning-point burst, 1-3 words]</span>[optional suffix]</h2>
  <div class="grid">
    <div class="left">
      <div class="kicker"><span class="num">04</span>Turning point</div>
      <div class="body-serif"><p>[counter-statement]</p></div>
      <span class="ask">[turning-point question?]</span>
    </div>
    <div class="right"><svg>[counter-pose]</svg><p class="caption">[caption]</p></div>
  </div>
</section>

<section class="hero">
  <div class="layout">
    <div class="visual"><svg>[large hero figure]</svg><p class="caption">[caption]</p></div>
    <div class="text">
      <div class="kicker"><span class="num">05</span>Insight</div>
      <h2 class="head-serif">[pose name, no concept name]</h2>
      <div class="pull-quote">[core sentence]</div>
      <div class="body-serif drop-cap"><p>[concrete statement of the insight]</p></div>
    </div>
  </div>
</section>

<section class="closing">
  <p class="approach">[this study of X is called —]</p>
  <h1 class="mega-name">[CONCEPT NAME]</h1>
  <div class="en-name">[English Name]</div>
  <div class="byline"><span><strong>[NAME]</strong></span><span class="sep">·</span><span>[YEAR]</span><span class="sep">·</span><span>[REFERENCE]</span></div>
  <div class="closing-body"><p>[what it opened up]</p><p>[what lens it swapped in]</p></div>
  <p class="epilogue">[poetic resonance, no self-reference]</p>
</section>
```

**Font sizes & rhythm padding reference**:

| section | padding top / bottom | margin-top | whitespace |
|---|---|---|---|
| feature | 38 / 44 | — | medium |
| note | 22 / 22 | 24 | small |
| archive | 22 / 24 | 24 | small |
| cross | 64 / 60 | 30 | large |
| hero | 52 / 48 | 32 | medium-small |
| closing | 60 / 64 | 32 | large |

Full CSS reference is in the same directory's `example.html` (every class implemented there).

[Output Contract]

Output a **single-file HTML**, inline CSS + Google Fonts CDN (Noto Serif SC / Noto Sans SC / Caveat / JetBrains Mono). No JS, static long image. Container 1080px wide, auto height.

[Self-check — 6 items, redo if any fails]

1. **Problem station**: title has no concept name / the problem is concrete and touchable / "what he/she saw at that moment" perspective
2. **Failure station**: at least 1 failure / the failure has clues (strikethrough / verdict / footnote)
3. **Insight before naming**: naming only in closing / hero title does not spoil
4. **Restrained copy**: no "you thought you just learned..." self-referential phrasing
5. **Native English**: no "was X-ed" / "carry out X" / "with the development of X" translation-ese
6. **Uneven rhythm**: 6 sections' margin-top are not all equal / whitespace concentrated at cross and closing

[Forbidden]
- The concept name must not appear in the title (spoiler)
- No icons / emoji as decoration
- No pure `#000` black
- Don't center all headings (feature/note/archive left-aligned; only cross/closing centered)
- Don't make all 6 sections' padding equal
- No Inter font
- No signposting self-reference
- sidekick must not be empty

[Credits]
This skill is adapted from [lijigang/ljg-skills · ljg-card -v sketchnote](https://github.com/lijigang/ljg-skills/tree/master/skills/ljg-card) (v2.3.0). The original outputs a PNG (via playwright screenshot); the html-anything version outputs a single-file HTML directly. 6 axioms + 6 layouts + 4 typefaces + rhythm match the original.
