# prompt-master vendor notes

Upstream: [nidhinjs/prompt-master](https://github.com/nidhinjs/prompt-master) (MIT).

Retrieved from `main` on 2026-08-08 (upstream ships no tags; no commit SHA was reachable from this
environment, so the branch + date is the pin). Vendored tree: `SKILL.md`, `references/templates.md`,
`references/patterns.md`, `LICENSE`. Excluded: `README.md` (marketing copy, 12 worked examples —
duplicates `SKILL.md` content without adding rules).

## Why it is vendored here

Two consumers:

1. **Manager shelves.** `agent-data/manifest.json` already exposes `agent-data/catalog` as the
   toggleable `manager-catalog` source for `kind: "skill"`, so toggling installs it into a project's
   `.claude` directory like any other catalog skill. No manifest edit was needed.
2. **HTML brief expander.** `backends/runtime/src/html/html-brief.ts` reads this `SKILL.md` off disk
   and inlines its body as the operating discipline for the pre-generation pass that turns rough
   notes plus annotated screenshots into a structured brief. That path does **not** depend on skill
   auto-activation — it reads the file directly, so the skill works there whether or not it is toggled
   on for a project.

## Fork delta

| Change | Why |
|--------|-----|
| Frontmatter converted to real YAML (`name`, `description`) | Upstream ships its frontmatter inside a `## Frontmatter` fenced code block, which is not parseable frontmatter. Catalog skills here use real YAML with `name` + `description` only (see `agent-data/catalog/skills/coverage-matrix/SKILL.md`); `version` was dropped since the pin lives in this file. |
| `description` extended with brief-expansion triggers | Upstream activates only on explicit "write me a prompt" asks. The HTML brief expander is a second, non-prompt-shaped consumer, and the description is what the skill picker matches on. |
| Hardcoded model names generalized | Upstream pins "Opus 4.7 / 4.8 default" in the Claude routing section, Template M's title, and pattern 36; `o1` appears in the CoT warnings. Rewritten to name the current frontier line (Opus 5 / Sonnet 5 / Haiku 4.5) and otherwise say "reasoning-native models" / "frontier Claude model", so the guidance does not rot on the next release. |
| Title of `Template M` shortened to "Task Brief" | Follows from the same generalization; anchors in the templates table of contents updated to match. |
| Removed the "35 patterns" count from `SKILL.md`'s reference table | `references/patterns.md` actually ships 37; upstream's `SKILL.md` and README say 35. Dropped the number rather than restate a wrong one. |
| Dropped `README.md` | Marketing copy; the rules live in `SKILL.md`. |

MIT: `LICENSE` retained verbatim with its copyright notice; this file marks the modified paths.
