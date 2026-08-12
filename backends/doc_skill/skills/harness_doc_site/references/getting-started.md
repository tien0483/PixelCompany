# Getting started — your first doc site in about an hour

For someone who has never used this. You need Python 3.10+ and a repo. No pip installs, no server —
the output is a folder of HTML files you open by double-clicking.

If you have Claude Code with a harness team, the audit steps go faster. **You do not need it** — you
can write the audit yourself, or ask any AI assistant, as long as every claim carries a `file:line`.

---

## 0. What you are making, and why it is not normal documentation

You are documenting **software that does not exist yet** — the thing you plan to build — and then
checking that plan against the code you actually have. So parts of your document will be wrong. That
is the point. Nothing gets deleted when a claim turns out wrong: it gets struck through, dated, and a
green "here is what is actually true" goes underneath.

The result is a site where every `file:line` is a click away from the real function, and where you can
see what you believed, when you believed it, and what changed your mind.

---

## 1. Scaffold (2 minutes)

```bash
python <skill>/scripts/init_doc_site.py \
    --project "Flange Viewer" \
    --dir .agent/_workspace/flange_viewer \
    --repo-root ../../.. \
    --source tools/flanges/loader.py \
    --source tools/flanges/cache.py
```

- `--repo-root` is the path **from your new folder back to the repo root**. `../../..` is right for
  `.agent/_workspace/<name>/`. Get it wrong and `code_index.py` reports every file as missing, which
  is how you will know.
- `--source` once per file your docs will cite. You can add more later in `site.json`.

You get the generators, a `site.json` (all the config — you never edit Python), an empty
`verdicts.json`, and three starter docs. Read `README_FIRST.md` in there.

## 2. Bring in what you already know

**Start with what exists, not with a blank template.** You almost certainly already have the material:
an AI chat session where you thought the problem through, a requirements CSV, notes from a meeting, a
spec, a mail thread. Put the files in `inputs/` and convert them:

```bash
python intake.py inputs/*                    # auto-detects per file
python intake.py chat.txt --kind chat --title "Session: why the loader blocks" --date 2026-07-18
```

| Input | Becomes |
|---|---|
| `.md` | passed through |
| `.txt` / `.log` | paragraphs kept; a chat transcript gets speaker labels and quoted turns |
| `.csv` / `.tsv` | a markdown table |
| `.json` | fenced, pretty-printed |
| anything else | fenced verbatim |

Each becomes `00_input_<name>.md`, registered in `site.json`, with a header saying where it came from
and when. **Originals are never modified**, and the generated file is an artifact — re-running
overwrites it, so edit the original or promote the content into a hand-written doc.

Any `file:line` you happened to mention in those notes becomes a live code link, same as anywhere else.

### If you are starting from scratch instead

The scaffolder also writes three files that work well as a shape — **use them or delete them**:

| File | What goes in it | The trap |
|---|---|---|
| `PLAN.csv` | One row per step: task, description, priority, dependency, effort, key tech, **success metric** | A success metric that cannot be checked. "Draw calls drop 10-100x" is checkable; "improve performance" is not. Every unmeasurable row becomes an unresolvable argument later. |
| `SUMMARY.md` | The conclusions that drive decisions | Conclusions nobody can act on. If a bullet does not change what you would build, cut it. |
| `MISCONCEPTIONS_AND_FAQ.md` | Myth → reality | Skipping it. This is the file that pays off when someone new joins, because it kills wrong mental models directly. |

### One rule for this whole phase

This material is **prior knowledge, not audited claims** — no code assertions yet. Keeping it separate
from the audit is what stops a guess being read as a measurement later. Imported docs carry a header
that says so.

**Expect the technology choices to be wrong.** On the first real run of this method, 6 of 17 plan rows
named external libraries the codebase already implemented, or that would have replaced it — because the
plan was written before anyone opened the code. That is normal. The audit is what catches it, and the
correction layer is where it gets recorded rather than quietly rewritten.

## 3. Get the audit written

One reviewer per domain, read-only. Give each an explicit scope. Demand:

- **A `file:line` on every status claim.** A row saying "ABSENT" with no anchor is an opinion.
- **A fixed vocabulary**: `PRESENT / PARTIAL / ABSENT` per plan row.
- **The worktree path and branch at the top.** Line numbers mean nothing without a checkout.
- **Conflicts reported, not resolved.** Two sources disagreeing is a finding, not a mess to tidy.

Save as `01_audit_<topic>.md`, then add it to `docs` in `site.json`:

```json
"docs": [
  ["doc_summary.html", "Findings summary", "SUMMARY.md"],
  ["doc_faq.html", "Misconceptions & FAQ", "MISCONCEPTIONS_AND_FAQ.md"],
  ["doc_01_audit.html", "01 · Audit", "01_audit_loader.md"]
]
```

## 4. Build (seconds)

```bash
python code_index.py     # pulls every cited item + its doc comment out of your source
python build_site.py     # writes the site
```

Open `index.html`. **Read the build report** — it is the quality gate:

```
citations: 3 distinct items referenced
  unresolved files (cited, not in sources): …    <- add them to site.json
  bare `:n` continuations re-attached: …         <- it guessed; check it guessed right
  line drift, resolved by symbol/nearest: …      <- your line numbers are stale
checking links…
  OK — every local link and anchor resolves
```

## 5. Re-verify, and record what was wrong

A **fresh** reviewer re-checks the audit — ideally one that only runs commands (build, lint, test),
because reviewers who read code do not catch "this never compiled". Then record each finding:

```bash
python round_tool.py open --at 2026-07-31 --trigger "first review" --reports 02_review_loader.md

python round_tool.py check \
    --doc 01_audit_loader.md --match "Capability audit" \
    --verdict WRONG --by 02_review_loader.md \
    --claim "Row 2 is ABSENT because caching is a stub." \
    --now "The stub is real, but CHUNK_SIZE (loader.py:4) shows chunking was intended, so the gap is the streaming read." \
    --target "A streaming read that honours CHUNK_SIZE."

python build_site.py
```

`--match` is a **substring of the heading** the claim sits under. If you later rename that heading,
the build fails rather than silently orphaning the correction.

The claim now renders as layers: the original struck through and dated, the current statement in
green, and the target underneath. **The markdown is never edited** — it stays as the record of what
you believed.

## 6. Later rounds — after code changes, or when you find something

```bash
# you changed the code, or a reviewer looked again
python round_tool.py open --at 2026-08-04 --trigger "streaming read landed"
python round_tool.py check --doc 01_audit_loader.md --match "Capability audit" \
    --verdict CONFIRMED --now "Streaming read landed; peak memory is one chunk."

# you read something elsewhere and want the team's take on it in the record
python round_tool.py check --doc SUMMARY.md --match "core conclusions" \
    --verdict ADDED --provenance external --url https://example.com/post \
    --claim "(not stated) per-frame upload budget" \
    --now "Their guidance matches the chunk size we already have." \
    --target "Budget honoured under load." --fix-state PROPOSED
```

Rounds are **append-only**: round 2 never edits round 1. The claim ends up with three visible layers,
each dated. `rounds.html` shows what moved this round and which claims nobody re-checked;
`round_tool.py status` says the same in the shell.

---

## The rules that matter

1. **Green means "build this".** Nothing else is green. A proposal gets `--fix-state PROPOSED` so it
   cannot be mistaken for a verified fact.
2. **History is for text only.** Diagrams, charts and tables show the newest confirmed state and
   nothing else, each stamped with its date. Nobody should be able to implement a superseded design
   from a picture.
3. **Green is current, not permanent.** The next round can turn it amber or red. The timestamp, not
   the colour, tells a reader whether to trust it or look again.
4. **Never edit generated HTML.** Markdown and `verdicts.json` are the inputs; everything else is a
   build artifact.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `MISSING (cited but not found)` for everything | `repo_root` in `site.json` is wrong | Point it at your repo root, relative to the workspace folder |
| A citation links to the wrong function | Line numbers came from a different checkout | Add the real span to `citation_overrides.json`, or name the symbol in the prose — the resolver prefers a name over a number |
| `unresolved files (cited, not in sources)` | The docs cite a file you did not list | Add it to `sources` in `site.json`, re-run `code_index.py` |
| `!! verdict match failed` | A heading was renamed | Update `match` in `verdicts.json` to a substring of the new heading |
| `N BROKEN` in the link check | A page links somewhere that does not exist | Read the listed lines; usually a doc removed from `site.json` |
| Snippet shows 300 lines of an `impl` block | The citation points between methods | Cite a line inside the method, or accept the `region` label — it is honest about what it is |
| Diagrams look wrong in light mode | Colours hardcoded in the SVG | Use the `--d-*` variables from `theme_shared.DIAGRAM_CSS`, including on `<marker>` children |

## What it costs

The BIM-viewer instance: 12 docs, 93 pages, 53 code-atlas pages from 1171 extracted items, 233 code
citations, 43 tracked claims. Building it takes seconds; the thinking took two days. A scaffolded
project with 2 source files and 3 docs comes out at 12 pages, which is the useful floor.
