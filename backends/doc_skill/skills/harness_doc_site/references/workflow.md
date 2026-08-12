# Workflow — who does what, in what order, and when to go round again

Companion to `getting-started.md`, which is the command-by-command version. This one is the process:
the roles, the hand-offs, the decision points, and what "done" means at each stage.

---

## The shape of it

```
                        ┌─────────────────────────────────────────────┐
                        │  ROUND N                                     │
  you ── material ────▶│  1. scope        what changed, what to check │
                        │  2. audit        team reads code, cites it   │
   you ──── finding ───▶│  3. build        site renders the layers     │
                        │  4. verify       fresh eyes re-check         │
                        │  5. record       append checks, never edit   │
                        └──────────────┬──────────────────────────────┘
                                       │
                        code changes ──┘  ──▶ ROUND N+1 (same five steps)
```

Round 1 is the expensive one: you gather the material you already have (chat exports, CSVs, notes —
`intake.py` takes any of it) and the site does not exist yet. Every round after is cheap: the code
index, the resolver and the pages are already there, so a round is "open, check, build".

---

## Roles

| Role | Owns | Must not |
|---|---|---|
| **You (the engineer)** | The input material (in whatever format), the scope of each round, and the decision on conflicts | Edit generated HTML; edit a source doc to hide a wrong claim |
| **Audit reviewer(s)** | Mapping the material onto real code, one domain each, read-only, `file:line` on every claim | Edit the code being audited; resolve a conflict silently |
| **Verification reviewer(s)** | Re-checking the audit against HEAD. At least one that *runs commands* | Trust the audit's line numbers; skip the build/lint/test check |
| **The record (`verdicts.json`)** | Every claim's history, dated, with provenance | Ever lose a layer |

One person can hold every role. The separation matters more than the headcount: **the reviewer who
wrote the audit is the worst person to verify it.** On the first real run, the verification pass found
the audit's headline finding was *inverted* — a fresh reader caught what the author could not.

---

## Step 1 — Scope the round

Write down, in one sentence, what this round is checking. Put it in `--trigger`; it lands on
`rounds.html` and is what a reader six weeks later uses to understand why the verdicts moved.

Good triggers:
- "First harness review of the research bundle"
- "P2 streaming upload landed — recheck the loader claims"
- "Colleague sent benchmark numbers that contradict row 8"

Bad trigger: "update". You will not remember what it meant.

**Decide the blast radius.** A round does not have to touch every claim. Claims nobody re-checks keep
an older green, `rounds.html` lists them, and that is a perfectly good state — an unexamined claim
should look unexamined, not silently re-blessed.

## Step 2 — Audit

Split by domain, not by file count. One reviewer per boundary that can fail independently: the data
producer, the renderer, the host/UI, the build. Give each an explicit scope and a named output file.

**The four rules that make an audit reusable downstream:**

1. `file:line` on every status claim.
2. Fixed vocabulary — `PRESENT / PARTIAL / ABSENT` per plan row; `CONFIRMED / STALE / WRONG /
   UNVERIFIABLE` per claim.
3. Name the worktree and branch at the top.
4. Report conflicts; never resolve them quietly.

**Done when** every claim in the imported material has a status and an anchor, or an explicit
"unverifiable, because …". If the material is a plan with rows, that means every row; if it is a chat
export or a pile of notes, it means every assertion worth acting on — the reviewer's first job is
deciding which those are, and saying so.

## Step 3 — Build

```bash
python code_index.py && python build_site.py
```

**Done when** the link check passes and you have read the drift report. Do not skip the drift report:
anything resolved by "nearest" is a citation that may point at the wrong function, and silence there is
exactly how a doc set rots.

## Step 4 — Verify

Fresh reviewers, one per domain, plus **one that only runs commands**. The command-runner catches the
class of problem readers never do: code that has never compiled, a lint gate that has never been green,
a page that links nowhere, a generated file older than its generator.

Ask for a verdict per claim with evidence, and ask explicitly for *new* findings the audit missed —
that is usually where the expensive surprises live.

**Done when** every audit claim has a verdict, and each verdict cites something.

## Step 5 — Record

```bash
python round_tool.py open --at <date> --trigger "<the sentence from step 1>" --reports <files>
python round_tool.py check --doc <doc> --match "<heading substring>" --verdict <V> \
    --claim "<as written>" --now "<what is true>" --target "<exit condition>" --by <report>
python build_site.py
```

Fill `--target` properly. It is the exit condition — what has to be true before the correction
disappears — and it is the field that turns a correction into a work item. A correction with no target
is a complaint.

**Done when** `round_tool.py status` shows the round's checks and the site rebuilds clean.

---

## Bringing your own findings

When you read something elsewhere, or measure something yourself, it goes into the same timeline:

```bash
python round_tool.py check --doc SUMMARY.md --match "core conclusions" \
    --verdict ADDED --provenance external --url <link> \
    --claim "(not stated) <the gap>" \
    --now "<the team's reading of your evidence>" \
    --target "<what it would take to act on it>" --fix-state PROPOSED
```

Two things make this work:

- **Put the team's *interpretation* in `--now`, and your source in `--url`.** The record should say what
  we concluded and what it was based on, not just paste the link.
- **`--fix-state PROPOSED`** until it is verified. Green that means "someone suggested this" and green
  that means "we measured this" must not look identical.

The provenance mark (🤖 harness / 👤 yours / 🔗 external) renders on the layer, so the timeline shows
who moved each claim.

---

## When to run another round

| Trigger | Scope |
|---|---|
| A change landed that a claim depends on | Just the affected claims |
| Someone asks "is this still true?" | The claims they asked about — and record the answer, even if it is CONFIRMED |
| You are handing the project over | Everything: a stale green is worse than no green when you are not there to explain it |
| A new external finding | The claims it touches, plus one `ADDED` for the finding itself |
| A quarter has passed | `round_tool.py status` — anything with an old green is a candidate |

Recording a `CONFIRMED` is not busywork. "Still true, checked on this date" is exactly the information a
reader needs, and it is the only thing that distinguishes *verified* from *nobody looked*.

---

## Anti-patterns

| Don't | Why | Do instead |
|---|---|---|
| Edit the source markdown to fix a wrong claim | You destroy the record of what you believed, and the reason it was wrong | Add a check; the layer shows both |
| Write the retraction only in the newer doc | Anyone starting at the older doc gets it wrong. Three of these were live simultaneously on the first run | A `verdicts.json` entry attached to the original claim |
| Colour a diagram's old version alongside the new | A reader building from a picture cannot tell which is live | Diagrams show the newest confirmed state only, stamped |
| Leave a plan row's metric unmeasurable | Every later argument about that row is unresolvable | Make it a number or an observable behaviour before the first audit |
| Let two generators write one file | They will drift. The one-pager here missed four review docs for exactly this reason | One entry point |
| Skip the round and "just update the text" | You lose the date, the provenance and the ability to answer "when did we learn this" | `round_tool.py open` costs one command |

---

## Handing it to someone else

Hand over four things:

1. **The folder.** It is self-contained; `index.html` opens offline.
2. **`how_to_read.html`.** Two minutes, and the colour rules make sense.
3. **`rounds.html`.** What has been checked, when, and what has not.
4. **One command**: `python code_index.py && python build_site.py`.

Tell them the one rule that is easy to get wrong: **markdown and `verdicts.json` are the inputs;
everything else is generated.** If they edit a page directly, the next build silently discards it.
