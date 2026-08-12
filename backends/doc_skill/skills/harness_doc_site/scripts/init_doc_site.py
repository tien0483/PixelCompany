# Copyright (C) 2026 Akselos
"""Scaffolds a new forward-documentation workspace: run this first.

Creates the folder, copies the generator scripts next to it, writes a `site.json` so nothing in the
Python needs editing, and drops in starter docs with the right shape (a plan CSV with a checkable
Success Metric column, a conclusions file, a myths file).

    python init_doc_site.py --project "Flange hot bolting viewer" \\
        --dir .agent/_workspace/flange_viewer \\
        --repo-root ../../.. \\
        --source tools/flanges/solver.py --source tools/flanges/ui.py

Then: fill in the docs, run `python code_index.py && python build_site.py`, open `index.html`.
Full instructions in ../references/getting-started.md.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parent
GENERATORS = ('code_index.py', 'citations.py', 'md_render.py', 'build_site.py', 'theme_shared.py',
              'round_tool.py', 'intake.py')

PLAN_CSV = """Phase,Step,Task,Description,Priority,Depends On,Effort,Key Tech,Success Metric
0 Foundation,1,First visible thing,"Smallest end-to-end slice that proves the idea",High,-,S,-,"Something a colleague can look at"
1 Make it real,2,The capability that matters,"The thing the project exists for",High,1,M,-,"A number or an observable behaviour, not an adjective"
2 Performance,3,The bottleneck you expect,"State the bottleneck you think you have",Medium,2,M,-,"Measured before and after"
"""

SUMMARY_MD = """# {project} — findings & conclusions

_Research summary. Written {date} — before the code was audited._

## What we set out to understand

1. …
2. …

## The core conclusions

**1. …**
State each conclusion so it can drive a decision. A conclusion nobody can act on is a note, not a
finding.

**2. …**

## Architecture in one paragraph

…

## Next step

…
"""

MYTHS_MD = """# {project} — misconceptions and FAQ

Wrong ideas people (understandably) have, and what is actually true. This is the highest-value file
when someone new joins.

## Misconceptions (myth -> reality)

**Myth 1: "…"**
Reality: …

## FAQ

**Q: What is the single most important thing to get right?**
A: …
"""

INPUTS_README = """# inputs/

Drop whatever you already have here — an AI chat export, a requirements CSV, meeting notes, a spec, a
mail thread you pasted into a text file. Then:

    python intake.py inputs/*

Each file becomes a `00_input_<name>.md` doc, registered in `site.json`, with a header recording where
it came from. The originals in this folder are never modified, and the generated docs are artifacts —
re-running `intake.py` overwrites them, so edit the original or promote the content into a
hand-written doc.
"""

README_FIRST = """# {project} — start here

Scaffolded by `init_doc_site.py`. Nothing here is generated yet.

## 1. Bring in what you already know (no code claims yet)

Whatever form it is in. Drop files into `inputs/` and run:

```bash
python intake.py inputs/*
```

AI chat exports, requirements CSVs, meeting notes, specs, JSON dumps — each becomes a doc, registered
in `site.json`, with a header recording where it came from. Originals are never modified.

The scaffolded `{plan_csv}`, `SUMMARY.md` and `MISCONCEPTIONS_AND_FAQ.md` are one shape that works
well, not a requirement. If you use the plan CSV, the **Success Metric** column is what makes it
auditable later: "draw calls drop 10-100x" can be checked, "improve performance" cannot. Delete what
you do not need.

## 2. Have the harness team audit it

One specialist per domain, read-only, and **every status claim must carry `file:line`**. Ask for a
per-plan-row table: `PRESENT / PARTIAL / ABSENT`, with an anchor for each. Save as
`01_audit_<topic>.md` and add it to `docs` in `site.json`.

## 3. Build the site

```bash
python code_index.py     # extracts cited code + doc comments
python build_site.py     # hub, doc pages, code atlas, corrections, one-scroll view
```

Open `index.html`. Read the build report: unresolved citations, line drift, link check.

## 4. Re-verify, then record corrections

A *fresh* team re-checks the audit. Then:

```bash
python round_tool.py open --at <date> --trigger "first review" --reports 02_review_x.md
python round_tool.py check --doc 01_audit_x.md --match "<heading substring>" \\
    --verdict WRONG --by 02_review_x.md \\
    --claim "<what the doc said>" --now "<what is actually true>" --target "<exit condition>"
python build_site.py
```

Corrections render as dated layers on the claim. The markdown is never edited.

## 5. Later rounds

Same two commands after any code change, or when you bring a finding of your own
(`--provenance user`, or `external --url <link>`). Rounds are append-only, so the old state stays
readable. `rounds.html` shows what moved; `python round_tool.py status` says which claims nobody
re-checked.

See `../../skills/harness_doc_site/references/workflow.md` for the whole loop and who does what.
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--project', required=True, help='human name, used in page titles')
    ap.add_argument('--dir', required=True, help='workspace folder to create')
    ap.add_argument('--repo-root', default='../../..',
                    help='path from the workspace folder to the repo root (default: ../../..)')
    ap.add_argument('--source', action='append', default=[],
                    help='repo-relative file the docs will cite; repeat per file')
    ap.add_argument('--tagline', default='', help='one line under the hub title')
    ap.add_argument('--date', default='', help='date for the doc headers, YYYY-MM-DD')
    args = ap.parse_args()

    dest = pathlib.Path(args.dir).resolve()
    if dest.exists() and any(dest.iterdir()):
        print(f'{dest} exists and is not empty — refusing to overwrite', file=sys.stderr)
        return 1
    dest.mkdir(parents=True, exist_ok=True)

    for name in GENERATORS:
        shutil.copy(SCRIPTS / name, dest / name)
    (dest / 'inputs').mkdir(exist_ok=True)

    plan_name = 'PLAN.csv'
    site = {
        'project': args.project,
        'tagline': args.tagline,
        'hub_title': f'{args.project} — plan, audit, and the code',
        'hub_intro': f'What we intend to build for {args.project}, checked against the code we '
                     f'actually have.',
        'repo_root': args.repo_root,
        'plan_csv': plan_name,
        'docs': [
            ['doc_summary.html', 'Findings summary', 'SUMMARY.md'],
            ['doc_faq.html', 'Misconceptions & FAQ', 'MISCONCEPTIONS_AND_FAQ.md'],
        ],
        'sources': args.source,
    }
    (dest / 'site.json').write_text(json.dumps(site, indent=2) + '\n', encoding='utf-8')
    (dest / 'verdicts.json').write_text(
        json.dumps({'rounds': [], 'entries': []}, indent=2) + '\n', encoding='utf-8')

    fmt = {'project': args.project, 'date': args.date or '<date>', 'plan_csv': plan_name}
    (dest / plan_name).write_text(PLAN_CSV, encoding='utf-8')
    (dest / 'SUMMARY.md').write_text(SUMMARY_MD.format(**fmt), encoding='utf-8')
    (dest / 'MISCONCEPTIONS_AND_FAQ.md').write_text(MYTHS_MD.format(**fmt), encoding='utf-8')
    (dest / 'README_FIRST.md').write_text(README_FIRST.format(**fmt), encoding='utf-8')

    (dest / 'inputs' / 'README.md').write_text(INPUTS_README, encoding='utf-8')

    print(f'scaffolded {dest}')
    print(f'  {len(GENERATORS)} generators, site.json, verdicts.json, {plan_name}, SUMMARY.md, '
          f'MISCONCEPTIONS_AND_FAQ.md, README_FIRST.md')
    if not args.source:
        print('  no --source given: add the files your docs will cite to "sources" in site.json')
    print('\nnext:')
    print(f'  cd {dest}')
    print('  # write the plan + summary, get the audit written, add it to site.json "docs"')
    print('  python code_index.py && python build_site.py')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
