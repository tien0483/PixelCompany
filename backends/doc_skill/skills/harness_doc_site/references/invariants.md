# Invariants, and the failure modes that produced them

Every rule here was paid for. The failure it prevents is named.

## 1. Resolve citations by symbol, not by line number

Docs outlive line numbers. The BIM-viewer audit was written against `akselos-dev-2`; by the time it
was published, every anchor in `web_app.rs` had shifted ~35 lines and `worker.py` had shifted ~50.

`citations.py` resolves in this order:

1. an explicit entry in `citation_overrides.json` (drift someone measured);
2. a symbol named in the surrounding prose — `create_buffer_init` (`render_list.rs:336`) — because a
   name survives drift;
3. the line number, mapped to the innermost item containing it.

**Failure it prevents:** a citation silently pointing at the wrong function. Silent is the problem —
a broken link gets fixed, a link to plausible-but-wrong code gets believed.

Corollaries:
- **Never let a container win.** `impl Foo` spans 500 lines, "contains" every claim, and explains
  nothing. Sort candidates so non-containers win, then smallest span.
- **Fill the gaps.** Synthesise a `region` item for lines no real item covers (module headers, import
  blocks, space between functions), computed from *leaf* items only. A region is honest; the nearest
  function is a lie.
- **Trim long items.** A 250-line function shown whole buries the one line cited. Window it, and say
  in the UI that it was trimmed.
- **Expand to the whole cited range.** `:432-457` covering a struct *and* its impl must show both —
  the impl is usually the point.
- **Bare `:123` continuations only count inside backticks.** In prose, a colon-number is a ratio or a
  section. And when the doc names a second file mid-sentence (`Cargo.toml:14`) then continues citing
  the first, keep a short file history and re-attach out-of-range continuations to a file the line can
  exist in. Report every such guess.
- **Report, do not hide.** Print unresolved files, recovered continuations, drift, and out-of-range
  lines on every build. On the BIM run this surfaced 13 mis-attributed continuations and one genuine
  off-by-one.

## 2. Markdown is canonical; HTML is an artifact; corrections are an overlay

**Failure it prevents:** doc-vs-doc contradiction. Doc 01 said culling was structurally impossible;
doc 03 retracted it — but only inside doc 03. Anyone reading 01 first got the wrong blocker. Three
such retractions were live simultaneously.

So: corrections live in `verdicts.json`, render as badges *on the claim*, and the source markdown is
never edited. A reader sees what we believed and what is true, together. That is what makes
documenting the future safe.

## 2b. Layer history in text; show a single current state everywhere else

Prose gets all three layers (struck claim → green current → target). Diagrams, interactive
explainers, plan tables and discussion pages get **only the newest confirmed state**, stamped with the
date it reflects.

**Failure it prevents:** somebody implementing a superseded design because a picture showed it. Text
can say "this was wrong, here is what is true" in one glance; a diagram showing two versions is just
ambiguous, and a reader skimming for the design will pick whichever they saw first. The user who
commissioned this said it plainly: *"if it is too much I will get confused by wrong implement."*

Corollary: **green means "build this"** and nothing else may be green. Never colour a retracted claim
green because it was once correct, and never colour a proposal green without marking it
`fix_state: PROPOSED` — a reader has to be able to trust green on sight.

## 2c. Every layer carries its own timestamp

Three dates per correction: when the claim was written, when the harness checked it, and (implicitly)
the vintage of the current-state pages. Without them a colour is an assertion; with them it is
evidence.

**Failure it prevents:** treating green as permanent. Code moves, so today's verified statement is
tomorrow's stale one — that is the normal lifecycle of this kind of document, not a defect. The date
tells a reader whether to trust the colour or re-run the harness. `claim_written` also exposes the
single most common root cause of a wrong claim: it was written before anyone read the code.

## 3. The build fails loudly

Fail on: a dead local link, a missing anchor, a `verdicts.json` entry whose heading no longer exists,
a cited file missing from `SOURCES`.

**Failure it prevents:** `index.html` shipped with **zero** links to the capability gallery or any of
its 17 explainers, because it was generated before the paragraph that referenced them. Nothing
checked, so nobody knew. Regeneration alone does not save you — only a check does.

## 4. One entry point

`build_site.py` runs the sub-generators, then generates, then injects shared nav. Two generators
writing the same file will drift.

**Failure it prevents:** the old one-pager had its own markdown renderer and its own doc list. It
never picked up the four review reports, and its overview still asserted claims the review had
disproved. Same content, two renderers, guaranteed divergence.

## 5. Dead code must announce itself

If you find shadowed or unreachable code, **do not delete it** (harness contract) — make it say so.

**Failure it prevents:** seven builder functions in `deep_dive_more.py` / `deep_dive_rest.py` are
shadowed by later imports. Editing them changes nothing in the output. Someone would have "fixed" a
chart repeatedly with no effect. Each file now carries a header naming the shadowed functions and
where to edit instead.

## 6. Theme is a first-class requirement for diagrams

Diagrams authored light-first with hardcoded hex cannot be themed; the only escape is painting a grey
plate behind them, which is what had happened. Drive every colour from CSS variables with light and
dark values, fallbacks inline so a standalone SVG still reads. Colour attributes on `<marker>` elements
are easy to miss and class-based theming will not catch them.

For canvas charts drawn dark-first and inverted wholesale in light mode: keep the element's backdrop
**dark** in light mode. Otherwise the backdrop is remapped to near-white first and the invert turns it
near-black — black chart panels on a white page.

**Measure contrast, do not eyeball it.** Compute the ratio for text, gutters, comment tokens and badge
tints in both modes; anything under 4.5:1 for small text is a bug. That found a code gutter at 2.4:1
and three tokens between 4.2 and 4.4.

## 7. Verify what the environment can actually verify

A screenshot proves nothing if the pane is not composited — the viewport reads 0x0, every canvas
reports `clientWidth: 0`, and no layout happens. Say so, and substitute a check that works: for the
canvas palettes, extract every drawn colour statically and compute what `invert(1) hue-rotate(180deg)`
turns it into, then flag any large light fill.

Report the limit explicitly. "Verified the CSS mechanism, did not see it rendered" is a true statement;
"looks good" would not have been.

## Failure modes to look for in any audit you inherit

| Smell | What it usually means |
|---|---|
| A claim with no `file:line` | Opinion, or copied from an older doc |
| Retraction written only in the newer doc | Readers who start at the older doc get it wrong |
| "All N passes" / "N of M variants" counts | Goes stale the moment anyone adds a stage — recount |
| A doc citing its own line numbers from another worktree | Every anchor is drifted; overrides needed |
| Generated HTML older than its generator | Regenerate before believing it, then diff |
| A cost estimate with no measurement behind it | On the BIM run, one "M–L Rust rewrite" was actually a JS change with zero Rust edits |
| An entry-point doc that never got the scope change | `SUMMARY.md` still pointed at a plan the manager had retired |
