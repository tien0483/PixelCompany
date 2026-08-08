# Scripts — copy into `.agent/_workspace/<project>/` and edit three things

Working code, lifted from the BIM-viewer run (89 pages, 226 code citations, 24 corrections). Plain
stdlib Python 3.10, no dependencies. Tailwind and lucide load from a CDN at view time; everything
else is self-contained.

| File | Role | Edit? |
|---|---|---|
| `code_index.py` | Extracts every item (fn / struct / impl / class / const / WGSL block) with its doc comment into `code_index.json`. Rust and TS by brace matching, Python by `ast`. | Via `site.json` `sources` |
| `citations.py` | Turns `file.rs:123` in the prose into a link to the real item. Symbol-first resolution, drift reporting. | No |
| `md_render.py` | Markdown → HTML (headings, tables, fences, lists, quotes, inline). Only the subset the docs use. | Extend if a doc needs a new construct |
| `build_site.py` | The one entry point: hub, doc pages, code atlas, corrections, diagrams, one-scroll view, nav injection, link check. | Via `site.json` `docs` |
| `theme_shared.py` | Light/dark tokens, the diagram palette, theme boot + toggle. Shared with any other generator in the folder. | No |
| `init_doc_site.py` | Scaffolds a new workspace: generators, `site.json`, `inputs/`, starter docs. **Run this first.** | No |
| `intake.py` | Converts existing material (chat export, CSV, notes, JSON, anything) into registered docs, originals untouched. **Run this second.** | No |
| `round_tool.py` | Opens harness rounds and records checks into `verdicts.json`, append-only. The thing you run on every re-run. | No |
| `verdicts.example.json` | The corrections overlay. Start from `{"rounds": [], "entries": []}` and write it with `round_tool.py`. | **Via round_tool** |
| `citation_overrides.example.json` | Measured line drift, `basename:<spec-as-written>` → spec in this tree. | As needed |

## Quickstart

```bash
python <this-dir>/init_doc_site.py --project "My thing" \
    --dir .agent/_workspace/myproject --repo-root ../../.. \
    --source path/to/file.py
cd .agent/_workspace/myproject
cp ~/whatever-i-already-have.* inputs/
python intake.py inputs/*        # chat exports, CSVs, notes — any format
# then get an audit written and add it to "docs" in site.json
python code_index.py && python build_site.py
```

Configuration is `site.json` — `project`, `repo_root`, `plan_csv`, `docs`, `sources`. The constants in
the Python are only a fallback. Full walkthrough: `../references/getting-started.md`.

Open `index.html`. The build prints, and you should read: unresolved cited files, bare-`:n`
continuations it had to re-attach, line drift it resolved by name, and the link check.

## Optional pieces

- **Diagrams.** Provide a sibling `build_html.py` exposing `DIAGRAMS = [(id, title, svg), ...]`. Author
  the SVGs against the `--d-*` variables in `theme_shared.DIAGRAM_CSS` — never hardcoded hex, including
  on `<marker>` children. Without the module, the diagram page is skipped.
- **Other generators.** `build_site.main()` runs `build_capability_visualizers.py` if you have one;
  drop that line if you do not. Anything it generates gets the shared nav injected afterwards, so run
  it *before* the injection step, never after.

## Two things that will bite

1. `resolver.cite_pages` must be populated after each doc render (`main()` does this) or the code
   atlas loses its "cited by" backlinks.
2. Every doc is rendered twice — once as its own page, once into the one-scroll view — so resolver
   report counts are de-duplicated. Keep that in mind if you add new counters.
