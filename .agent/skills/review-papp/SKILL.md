---
name: review-papp
description: code review for the papp platform (dashboard/papps) — frontend (React 19 + TS + Vite + SCSS + Zustand + TanStack Query + Mantine + ECharts) AND backend (FastAPI + SQLModel + alembic in backends/ and tools/papp_components) — grounded in this repo's actual standards, with domain reviews fanned out to subagents and synthesized into one report. Use whenever asked to review papp code — a PR/MR, a branch diff, the working tree, a page, an endpoint.
---

# Review papp code

Review papp code the way a senior teammate would: find real defects first, then
design/maintainability issues, and phrase design disagreements as questions, not
verdicts. Every repo-specific rule exists because the repo actually enforces it — cite
the standards file when you flag a violation.

**Read on demand, never all of it:**

- [checklists/frontend-review.md](checklists/frontend-review.md) / [checklists/backend-review.md](checklists/backend-review.md) — only for domains present in the diff.
- `.claude/skills/_shared/papp-standards/{frontend|backend}-standards.md` — the standards the checklists cite.
- [references/fanout.md](references/fanout.md) — only if the user picks fan-out mode.

## Protocol

1. **Scope.** PR/MR number → `gh pr diff`; branch → `git diff master...`; otherwise
   working tree (staged + unstaged + untracked source files). Whole-page/file reviews
   (no diff): real defects go in Findings regardless of code age; refactor-scale gaps of
   mid-refactor code go under "Deferred / legacy drift"; shared components the target
   depends on are in scope for behavior-affecting findings.
2. **Proportionality.** A small diff deserves a small review: read only the checklists
   for domains in the diff; run only the checks the changed code *could* violate; run
   verify commands only when the diff warrants them. Thoroughness = covering what
   changed, not reciting the checklist.
3. **Mode — the user picks** (AskUserQuestion, one question; put the scope-appropriate
   option first with "(Recommended)"):
   - **1 agent (inline)** — cheapest in tokens, one continuous context (cross-stack
     links surface naturally); risk: on a big diff coverage gets shallow, no independent
     second look.
   - **Subagents (fan-out)** — fresh full context per domain (deeper on big diffs),
     parallel, findings re-verified by you; risk: noticeably more tokens, subagent
     findings can be plausible-but-wrong, overlaps need dedup.
   Skip the question when the answer is obvious: trivially small diff → inline, say so
   in one line; user already stated a preference → honor it.
4. **Review.**
   - *Inline:* read the domain checklist(s) and work through them yourself.
   - *Fan-out:* read `references/fanout.md` and follow it (spawn briefs, then verify +
     dedup their raw findings).
   - *Cross-domain diffs (either mode):* check the seams yourself — schema field ↔
     frontend TS type (incl. nullability), endpoint path/params ↔ `*.service.ts` +
     query key, backend enum ↔ frontend mirror enum, new table ↔ `table_*` in
     `papp_type.json`, data change frequency ↔ staleTime tier, and PR description ↔
     what the diff actually does.
5. **Ask the user once.** Judgment calls code can't settle (near-duplicate intentional
   or oversight? promote a new helper or keep it local?) — collect from all domains and
   ask in ONE AskUserQuestion batch before finalizing. Confirmed oversight → finding;
   confirmed intent → note + request a why-comment; still open → 🔵 Question.

## Reviewer mindset

- **Question design, assert defects.** A defect (leak, stale cache, 404→500, collision)
  is stated plainly with its failure scenario; a design choice is a question — the
  author may know something you don't.
- **Every finding needs a failure scenario or a concrete cost.** No style-taste nits a
  linter doesn't already enforce.
- **Praise what's good** — one or two genuine notes; it calibrates the criticism.

## Output format

Severity by *observable cost*, not effort-to-fix: 🔴 **Blocker** — user-visible wrong
behavior or data loss on a realistic path (crash, wrong number, blank chart, 404→500 on
a consumed endpoint, partial schema-change set). 🟠 **Major** — real defect, bounded
blast radius (leak, identity-churn re-renders, N+1, stale cache, class collision,
unguarded write path, a11y blocking an action) — fix before merge. 🟡 **Minor** — latent
risk / maintainability cost (missing test on new pure logic, re-implemented helper,
missing schema descriptions). 🔵 **Question** — design discussion, phrased as questions.

For non-PR scopes, read the verdict as "state of this code", not merge gating.

```markdown
# Review: <scope — PR/branch/files>

**Verdict:** <approve / approve-with-nits / needs-changes> — one-sentence rationale.

## Findings
<!-- one merged, deduped, severity-ordered list across domains; anchored to file:line -->
### 🔴 Blocker — <one-line defect>
`path/file.py:123` — what breaks, the concrete failure scenario, and the suggested fix.
### 🟠 Major — … / 🟡 Minor — … / 🔵 Question — …

## Praise
## Deferred / legacy drift
## Verification
- Commands run per domain with results, or "not run" + why.
```

Omit empty sections. No findings at all is a valid outcome — say so plainly.
