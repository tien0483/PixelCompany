---
name: harness_doc_site
description: "Forward documentation: document software we intend to build, audit it against the code we actually have, and publish it as a browsable site where every claim links to real code. Use when scoping a new capability or a big change (BIM viewer, renderer rework, new epic) and you want a shareable artifact that survives being wrong — research bundle -> harness-team audit -> generated doc site -> re-verification pass -> corrections overlay. Also use for follow-up requests like 'update the doc site', 'recheck these claims', 'why is this doc stale'."
---

# harness_doc_site — document the software you are *about* to build

Normal documentation describes what exists. This describes what we intend to build — the proposed
features, the development plan, and the gap to today's code — and then keeps itself honest by
re-auditing against the real source. The value is not the prose. It is that **every claim is anchored
to `file:line`, and every claim that later turns out wrong stays visible next to the claim.**

Cycle, repeatable: **harness → document → correct the document → change the code → run it again.**

```
round 1                                    round 2, 3, … (same commands)
─────────────────────────────────────      ────────────────────────────────────────
research bundle                            code changed / you found something
  plan + conclusions, no code yet            new evidence to check against
   ↓                                          ↓
harness team audit                         round_tool.py open   ← declare the round
  N specialists, read-only                    ↓
  every claim anchored to file:line         harness team re-audits, or explains
   ↓                                          your finding and proposes from it
generated doc site                            ↓
  markdown -> pages                        round_tool.py check  ← APPEND a layer
  citations -> code atlas                     never edits round 1
   ↓                                          ↓
re-verification pass                       build_site.py
   ↓                                          new green layer on top,
corrections overlay                           round 1 struck through and dated,
  round 1 checks                              rounds.html shows what changed
```

**Rounds are append-only.** A re-run adds a check to a claim; it never edits or deletes the previous
one. So the old document state stays readable and dated, and `rounds.html` answers "which is new,
which is old" directly — including which claims *nobody re-checked*, whose green is simply older.

**Your findings are first-class.** Hand the team something you read elsewhere; it enters the same
timeline with `--provenance user` or `external --url …`, so your evidence and the team's response sit
in one place, and the next round can supersede either.

## When to use

- Scoping a capability we do not have yet (a viewer, a streaming loader, an epic's worth of work).
- Auditing an existing crate/module against a plan, and needing the result to be *shareable* and
  *checkable* rather than a wall of markdown.
- Re-checking a doc set that has gone stale, or that contradicts itself across files.

Not for: API reference of shipped code (use Sphinx, `docs/src/`), a single ticket's design note (write
the note), or anything where nobody will read it twice.

## Phase 1 — whatever you already know

**Not a template to fill in.** This phase is the prior knowledge that already exists in the engineer's
head, chat history and inbox — in whatever format it arrived. An exported AI session where you worked
the problem out. A requirements CSV. Meeting notes. A spec. A mail thread pasted into a `.txt`. Half a
plan in a spreadsheet. All of it counts, and none of it needs retyping.

Drop the files into `inputs/` and convert them:

```bash
python intake.py inputs/*                    # auto-detects per file
python intake.py chat.txt --kind chat --title "Session: why the loader blocks" --date 2026-07-18
```

| Input | Becomes |
|---|---|
| `.md` | passed through |
| `.txt` / `.log` | paragraphs kept; a transcript gets speaker labels and quoted turns automatically |
| `.csv` / `.tsv` | a markdown table |
| `.json` | fenced, pretty-printed |
| anything else | fenced verbatim — still better than living outside the site |

Each becomes `00_input_<name>.md` with a header recording **where it came from and when**, and is
registered in `site.json`. The originals are never modified. Any `file:line` you happened to mention in
those notes becomes a live code link like anywhere else.

**The one thing that matters here:** this material is *prior knowledge, not audited claims*. Keep it
separate from the audit so a guess cannot masquerade as a measurement — the header on every imported
doc says so explicitly, and everything the harness later confirms or contradicts lands as a dated layer
on top.

If you are starting from nothing rather than from existing material, the scaffolder also writes a
plan-CSV / conclusions / myths trio as **one shape that works well** — not a requirement. Delete what
you do not need. If you do keep the plan CSV, make the **Success Metric** column checkable: "draw calls
drop 10-100x" can be audited, "improve performance" cannot, and every unmeasurable row becomes an
unresolvable argument later.

## Phase 2 — harness team audit

Use the domain orchestrator (`wgpu_orchestrator`, `hui_perf_orchestrator`, or write one per
`skills/harness`). Rules that make the output usable downstream:

- **Every status claim carries `file:line`.** A row that says "ABSENT" without an anchor is an
  opinion.
- **Verdict vocabulary is fixed**: `PRESENT / PARTIAL / ABSENT` per plan row, and per claim
  `CONFIRMED / STALE / WRONG / UNVERIFIABLE`. Ambiguity is what rots.
- **Conflicts are reported, never silently resolved.** Two sources disagreeing is a finding.
- **Say which tree you audited.** Worktree path and branch, at the top. Line numbers are only
  meaningful relative to a checkout.
- Read-only. The audit does not edit the code it audits.

Output: `01_explorer_<topic>.md` with a per-plan-row capability table, cross-cutting hazards, what is
genuinely reusable, and a recommended order.

## Phase 3 — generate the site

Scaffold it — this copies the generators and writes the config, so **no Python needs editing**:

```bash
python <skill>/scripts/init_doc_site.py --project "My thing"     --dir .agent/_workspace/mything --repo-root ../../..     --source tools/mything/loader.py --source tools/mything/cache.py
```

Everything lives in `site.json`: `project`, `repo_root`, `plan_csv`, `docs` (page/label/markdown), and
`sources` (the files your docs cite). Add to `docs` as each audit lands.

```bash
python code_index.py    # extract every item + its doc comment -> code_index.json
python build_site.py    # hub, doc pages, code atlas, corrections, rounds, one-scroll view
```

Read the build report: unresolved citations, drift it had to guess, and the link check.

What you get: a hub, one page per doc, one **code atlas** page per cited source file (items with
their doc comments, "cited by" backlinks, full file), a corrections page, a diagrams page, and a
one-scroll view of everything. Every `file:line` in the prose becomes a link that opens the real
enclosing function in a drawer — doc comment included.

## Phase 4 — re-verification pass

Spawn a *fresh* team against the audit, one specialist per domain, each given an explicit scope and
told to return `CONFIRMED / STALE / WRONG / UNVERIFIABLE` per claim with evidence. Include one that
only runs commands (build, lint, test, link-check) — the ones that read code will not catch "this
never compiled".

This pass is where the real value shows up. On the BIM-viewer run it produced 77 confirmed, 12 stale,
4 wrong, 14 new findings — including that the audit's headline finding was *inverted*, and that a
shader branch three tickets depended on is unreachable.

Output: `07_review_<agent>_<topic>.md` per specialist.

## Phase 5 — corrections overlay, timestamped

**Never rewrite the source markdown.** Put corrections in `verdicts.json`, one entry per claim:

```json
{"rounds": [
   {"round": 1, "at": "2026-07-30", "trigger": "First harness review of the research bundle",
    "reports": ["07_review_explorer_identity.md"]}
 ],
 "entries": [
  {"doc": "01_explorer_wgpu_bim_gap.md",
   "match": "Capability audit against the plan",
   "claim": "Row 2: identity is destroyed by design, because ItemKey merges items.",
   "claim_written": "2026-07-29",
   "target": "A first-class element id on the visible items, so identity supports addressability and not just read-out.",
   "checks": [
     {"round": 1, "at": "2026-07-30", "verdict": "WRONG", "by": "07_review_explorer_identity.md",
      "provenance": "harness", "fix_state": "CONFIRMED",
      "now": "Inverted. Identity rides in the color of parallel PickRenderStage items and survives *because* every pick colour is unique, so ItemKey cannot merge them."}
   ]}
 ]}
```

Write these with `round_tool.py` rather than by hand — it enforces the append-only rule and tells you
what it superseded.

`match` is a substring of the target heading (or the step number, for a plan CSV), resolved at build
time. A heading rename **fails the build** rather than orphaning the correction.

### Three layers, read in time order

| layer | colour | carries |
|---|---|---|
| the claim as written | 🔴 `WRONG` / 🟡 `STALE` / 🟡 `SCOPE` | struck through, with `claim_written` |
| each superseded round | ⚪ grey, struck | the round's `now`, its round number, its date and its provenance — kept, never deleted |
| the newest check | 🟢 always green | `now`, with its round, `at` and `by`, plus whether it is a verified fact (`fix_state: CONFIRMED`) or still a proposal (`PROPOSED`) |
| the exit condition | 🎯 | `target` — what must be true before the correction disappears |

`CONFIRMED` and `ADDED` entries have no struck layer: there is nothing to retract, only a current
statement.

**Green is the current final, not a permanent one.** A later round can turn a green statement amber or
red in turn — which is why every layer carries its own round number and date. The timestamp, not the
colour, is what tells a reader whether to trust it or run another round. See Phase 6.

**Provenance** on every check: `harness` (a review report), `user` (something you found and handed the
team), `external` (a source outside the repo, with `source_url`). So the record shows not just what
changed but who or what caused it.

### History is for text only

Prose carries all three layers. **Diagrams, interactive explainers, plan tables and discussion pages
render the newest confirmed state and nothing else**, each stamped with the date it reflects. A reader
should never be able to implement a superseded design from a picture. If they want the history, it is
in the text.

The build emits both renderings: HTML pages with the layered cards, and
`annotated/<doc>.md` — the same doc with `:red_circle:` / `:yellow_circle:` / `:green_circle:` blocks
inserted under the relevant heading, for reading in an editor, a diff or a terminal. `how_to_read.html`
explains the states to whoever you hand the site to.

See `references/invariants.md` for the rules that keep this from rotting, and the failure modes
observed in practice.

## Handing this to someone else

Three documents, in the order they need them:

| Document | For |
|---|---|
| `references/getting-started.md` | A colleague on their own project: scaffold → write → build → correct, with a troubleshooting table and the four rules that matter |
| `references/workflow.md` | The process: roles, hand-offs, what "done" means per step, when to run another round, anti-patterns |
| `references/invariants.md` | Why the machinery is shaped this way — each rule names the failure that paid for it |

Point them at `getting-started.md` and nothing else to begin with. The one rule to say out loud:
**markdown and `verdicts.json` are the inputs; every HTML file is generated**, so a hand-edit is lost
on the next build.

## Phase 6 — the next round

Everything above is round 1. Rounds 2+ use the same commands and cost far less, because the site,
the code index and the resolver are already in place.

### After a code change

```bash
python round_tool.py open --at 2026-08-04 --trigger "P2 streaming upload landed" \
    --reports 09_review_loader.md
# harness team re-audits the claims the change touches, writes 09_review_loader.md
python round_tool.py check --doc 01_explorer_wgpu_bim_gap.md --match "Recommended order" \
    --verdict CONFIRMED --by 09_review_loader.md \
    --now "Loader freeze is gone; peak wasm memory is one chunk."
python code_index.py && python build_site.py
```

The claim now shows three layers: the original text (struck, 2026-07-29), round 1's verdict (struck,
2026-07-30, marked *superseded*), and round 2's green (2026-08-04). Add the new report to `DOC_PAGES`
so its own `file:line` citations resolve too.

### When you bring the finding

```bash
python round_tool.py check --doc 05_benchmark_and_limits.md --match "Metrics to capture" \
    --verdict ADDED --provenance external --url https://example.com/post \
    --claim "(not stated) per-frame GPU upload budget" \
    --now "Team's read of that guidance: budget uploads to ~4 ms/frame; matches our measured …" \
    --target "Upload budget honoured under load." --fix-state PROPOSED
```

Ask the team to *explain or propose against your evidence* and put their conclusion in `--now`, with
your source in `--url`. `--fix-state PROPOSED` marks it as a plan, not a verified fact — so a green
layer never over-promises.

### Knowing what moved

- `python round_tool.py status` — rounds, check counts, and how many claims still carry an older green.
- `rounds.html` — per-round changelog: verdict, what it was before, where, the current statement, and
  the source. Newest round first, with a *not re-checked this round* list at the bottom.
- Doc pages tag anything checked in the current round with a **new in round N** chip.

### Re-running is cheap and safe

`build_site.py` is idempotent — same inputs, same output. Re-run it after any doc edit, any round, or
any code change; the link check and the citation-drift report tell you what the change broke. The only
inputs you ever hand-edit are the markdown docs and `verdicts.json` (via `round_tool.py`).

## Checklist

- [ ] Plan rows have checkable success metrics
- [ ] Every status claim in the audit has `file:line`
- [ ] Audit names the worktree and branch it read
- [ ] `code_index.py SOURCES` covers every cited file (build reports the ones it does not)
- [ ] `build_site.py` link check passes: no dead link, no bad anchor, no orphaned correction
- [ ] Citation drift report reviewed — anything resolved by "nearest" is a doc bug worth fixing
- [ ] Every retraction is a `verdicts.json` entry, not just a sentence in a newer doc
- [ ] Scope changes propagated to the entry-point docs, or flagged with a `SCOPE` verdict
- [ ] One build command produces the whole site
