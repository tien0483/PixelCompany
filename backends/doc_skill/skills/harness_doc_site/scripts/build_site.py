# Copyright (C) 2026 Akselos
"""TEMPLATE (see ../SKILL.md and ../references/getting-started.md).

Configure with a `site.json` next to this file (written by `init_doc_site.py`) — no Python edits
needed. Falls back to the constants below.

Builds the whole doc site: hub, doc pages, code atlas, corrections, plan table.

Single entry point on purpose. It runs the two pre-existing generators first (`build_html.py`,
`build_capability_visualizers.py`), then generates its own pages, then injects the shared nav into
*every* page including theirs. Running a sub-generator on its own is still safe — it just drops the
nav pill until the next full build.

    python build_site.py            # full build + report
    python build_site.py --no-subs  # skip the two legacy generators (faster iteration)

Reads: the markdown docs, `code_index.json` (see code_index.py), `verdicts.json`,
`citation_overrides.json`, `BIM_VIEWER_PLAN.csv`.
"""

from __future__ import annotations

import csv
import html
import json
import pathlib
import re
import runpy
import sys
import typing as tp

import citations
import md_render
import theme_shared

HERE = pathlib.Path(__file__).resolve().parent

# Optional per-project config. With a `site.json` next to this script, nothing here needs editing:
#   {"project": "My thing", "tagline": "one line under the title",
#    "plan_csv": "PLAN.csv",
#    "docs": [["doc_intro.html", "Intro", "INTRO.md"], ...],
#    "sources": [...]}            # `sources` is read by code_index.py
# `init_doc_site.py` writes one for you. The constants below are the fallback.
SITE: dict = (
    json.loads((HERE / 'site.json').read_text(encoding='utf-8'))
    if (HERE / 'site.json').exists() else {}
)
PROJECT = SITE.get('project', 'BIM viewer research')
TAGLINE = SITE.get('tagline', '')

# (output page, tab label, source markdown). None source = generated page.
DOC_PAGES: list[tuple[str, str, str | None]] = [
    ('doc_summary.html', 'Findings summary', 'SUMMARY.md'),
    ('doc_faq.html', 'Misconceptions & FAQ', 'MISCONCEPTIONS_AND_FAQ.md'),
    ('doc_01_gap.html', '01 · Gap map', '01_explorer_wgpu_bim_gap.md'),
    ('doc_02_semantic.html', '02 · Semantic layer', '02_design_semantic_layer.md'),
    ('doc_03_large_model.html', '03 · Large models', '03_design_large_model.md'),
    ('doc_04_tickets.html', '04 · Jira & tickets', '04_jira_journey_and_tickets.md'),
    ('doc_05_benchmark.html', '05 · Benchmark & limits', '05_benchmark_and_limits.md'),
    ('doc_06_instancing.html', '06 · Instancing & merging', '06_instancing_and_merging.md'),
    ('doc_07_review_explorer.html', '07 · Review: identity', '07_review_explorer_identity.md'),
    ('doc_07_review_systems.html', '07 · Review: GPU', '07_review_systems_gpu.md'),
    ('doc_07_review_web.html', '07 · Review: loader/WASM', '07_review_web_loader.md'),
    ('doc_07_review_qa.html', '07 · Review: build & docs', '07_review_qa_build_and_docs.md'),
    ('doc_08_review_stack.html', '08 · Review: plan vs stack', '08_review_plan_stack.md'),
    ('doc_08_review_perf.html', '08 · Review: plan perf rows', '08_review_plan_perf.md'),
]

# The step plan, if the project has one. Rendered as `plan_table.html`.
PLAN_CSV = SITE.get('plan_csv', 'BIM_VIEWER_PLAN.csv')

if SITE.get('docs'):
    DOC_PAGES = [tuple(d) for d in SITE['docs']]  # type: ignore[assignment]

VISUALIZER_PAGES = [
    ('diagrams.html', 'Diagrams — two sequence charts, the wire-format ERD, benchmark knobs'),
    ('capability_gallery.html', 'Capability gallery — all 17 plan rows as interactive explainers'),
    ('render_pipeline_audit_optimization_visualizer.html', 'Render pipeline audit & optimisation'),
]

VERDICT_STYLE = {
    'CONFIRMED': ('emerald', 'check-circle-2', 'Confirmed against this worktree'),
    'STALE': ('amber', 'clock', 'Was true, has since changed'),
    'WRONG': ('red', 'x-circle', 'Not true — corrected below'),
    'ADDED': ('blue', 'plus-circle', 'New finding the doc does not mention'),
    'SCOPE': ('violet', 'git-branch', 'Superseded by a later scope decision'),
}

BADGE_COLORS = {
    'emerald': ('border-emerald-500/40', 'text-emerald-300', 'bg-emerald-950/10'),
    'amber': ('border-amber-500/40', 'text-amber-300', 'bg-amber-950/10'),
    'red': ('border-red-500/40', 'text-red-300', 'bg-red-950/10'),
    'blue': ('border-blue-500/40', 'text-blue-300', 'bg-blue-950/10'),
    'violet': ('border-violet-500/40', 'text-violet-300', 'bg-violet-950/10'),
}

CITE_CSS = """
a.cite {
  color: #7dd3fc; text-decoration: none; border-bottom: 1px dotted rgba(125,211,252,0.5);
  cursor: pointer; font-variant-numeric: tabular-nums;
}
a.cite:hover { color: #bae6fd; background: rgba(56,189,248,0.12); }
a.cite.cite-drift { border-bottom-style: dashed; border-bottom-color: rgba(251,191,36,0.7); }
a.cite.cite-drift::after { content: '~'; font-size: 0.7em; vertical-align: super; color: #fbbf24; }
.cite-dead { color: #94a3b8; text-decoration: line-through dotted; }
html.light a.cite { color: #0369a1; }
html.light a.cite:hover { color: #075985; }

#snip-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(46rem, 92vw);
  background: #0b1120; border-left: 1px solid #1e293b; z-index: 60;
  transform: translateX(101%); transition: transform 200ms ease; display: flex; flex-direction: column;
  box-shadow: -12px 0 32px rgba(0,0,0,0.45);
}
html.light #snip-drawer { background: #ffffff; border-color: #cbd5e1; }
#snip-drawer.open { transform: translateX(0); }
#snip-code { counter-reset: none; }
.code-line { display: block; white-space: pre; padding: 0 0.75rem; }
.code-line > .ln {
  display: inline-block; width: 3.5rem; text-align: right; margin-right: 1rem;
  /* #475569 measured 2.4:1 — a gutter should be quiet, not unreadable. */
  color: #7d8ea3; user-select: none; font-variant-numeric: tabular-nums;
}
.code-line.hit { background: rgba(251,191,36,0.14); }
.code-line.hit > .ln { color: #fbbf24; font-weight: 600; }
.code-line:target { background: rgba(56,189,248,0.16); }
.tok-c { color: #7e93aa; font-style: italic; }
.tok-s { color: #fca5a5; }
.tok-k { color: #c4b5fd; }
.tok-d { color: #86efac; }
html.light .tok-c { color: #64748b; }
html.light .tok-s { color: #b91c1c; }
html.light .tok-k { color: #6d28d9; }
html.light .tok-d { color: #047857; }
.doc-prose { white-space: pre-wrap; }

/* --- light mode for the pieces theme_shared.py does not remap -------------------------------- */
/* The verdict cards use amber/red/blue/violet 950/10 tints; only the emerald one is covered
   upstream, so the rest stayed muddy-dark on a white page. */
html.light .bg-amber-950\\/10 { background-color: #fffbeb !important; }
html.light .bg-red-950\\/10 { background-color: #fef2f2 !important; }
html.light .bg-blue-950\\/10 { background-color: #eff6ff !important; }
html.light .bg-violet-950\\/10 { background-color: #f5f3ff !important; }
html.light .bg-slate-900\\/40, html.light .bg-slate-950\\/95 { background-color: #f1f5f9 !important; }
html.light .border-amber-500\\/40 { border-color: #fcd34d !important; }
html.light .border-blue-500\\/40 { border-color: #93c5fd !important; }
html.light .border-violet-500\\/40 { border-color: #c4b5fd !important; }
html.light .text-violet-300 { color: #6d28d9 !important; }
html.light .text-emerald-200\\/90 { color: #065f46 !important; }
/* Code gutter: #475569 on white is legible but the numbers competed with the code. */
html.light .code-line > .ln { color: #5a6b7f; }
html.light .code-line.hit { background: rgba(217,119,6,0.12); }
html.light .code-line.hit > .ln { color: #b45309; }
html.light .code-line:target { background: rgba(2,132,199,0.12); }
"""

KEYWORDS = {
    'rust': (
        'as async await break const continue crate dyn else enum extern false fn for if impl in let '
        'loop match mod move mut pub ref return self Self static struct super trait true type unsafe '
        'use where while'
    ).split(),
    'python': (
        'and as assert async await break class continue def del elif else except finally for from '
        'global if import in is lambda nonlocal not or pass raise return try while with yield True '
        'False None'
    ).split(),
    'typescript': (
        'as async await break case catch class const continue default delete do else enum export '
        'extends false finally for from function if implements import in instanceof interface let new '
        'null return super switch this throw true try type typeof var void while yield'
    ).split(),
    'wgsl': (
        'alias break case const continue default discard else enum fn for if let loop return struct '
        'switch var while true false'
    ).split(),
    'toml': [],
    'text': [],
}


# --------------------------------------------------------------------------- highlighting
def highlight(code: str, lang: str) -> str:
    """Comment / string / keyword colouring. Deliberately shallow — readability, not correctness."""
    kw = KEYWORDS.get(lang, [])
    kw_re = re.compile(r'\b(' + '|'.join(kw) + r')\b') if kw else None
    if lang == 'python':
        comment = re.compile(r'#.*$')
        doc_comment = None
    elif lang == 'toml':
        comment = re.compile(r'#.*$')
        doc_comment = None
    else:
        comment = re.compile(r'//.*$')
        doc_comment = re.compile(r'^(\s*)(///|//!)(.*)$')
    string = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')

    out_lines = []
    for line in code.split('\n'):
        if doc_comment is not None and doc_comment.match(line):
            out_lines.append(f'<span class="tok-d">{html.escape(line)}</span>')
            continue
        spans: list[tuple[int, int, str]] = []
        for m in string.finditer(line):
            spans.append((m.start(), m.end(), 'tok-s'))
        m = comment.search(line)
        if m is not None and not any(s <= m.start() < e for s, e, _ in spans):
            spans.append((m.start(), len(line), 'tok-c'))
        spans.sort()
        merged: list[tuple[int, int, str]] = []
        for span in spans:
            if merged and span[0] < merged[-1][1]:
                continue
            merged.append(span)
        parts: list[str] = []
        pos = 0
        for start, end, cls in merged:
            plain = html.escape(line[pos:start])
            if kw_re is not None:
                plain = kw_re.sub(r'<span class="tok-k">\1</span>', plain)
            parts.append(plain)
            parts.append(f'<span class="{cls}">{html.escape(line[start:end])}</span>')
            pos = end
        plain = html.escape(line[pos:])
        if kw_re is not None:
            plain = kw_re.sub(r'<span class="tok-k">\1</span>', plain)
        parts.append(plain)
        out_lines.append(''.join(parts))
    return '\n'.join(out_lines)


def code_block(code: str, lang: str, first_line: int, hit: tuple[int, int] | None = None,
               id_prefix: str = '') -> str:
    """Numbered, optionally hit-highlighted code. `first_line` is the real line number of line 0."""
    rendered = highlight(code, lang).split('\n')
    out = []
    for offset, line in enumerate(rendered):
        n = first_line + offset
        classes = 'code-line'
        if hit is not None and hit[0] <= n <= hit[1]:
            classes += ' hit'
        anchor = f' id="{id_prefix}L{n}"' if id_prefix else ''
        out.append(f'<span class="{classes}"{anchor}><span class="ln">{n}</span>{line or " "}</span>')
    return (
        '<div class="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto '
        'font-mono text-xs leading-relaxed py-2">' + ''.join(out) + '</div>'
    )


# Pages the header may link to. Populated by `main()` before anything is generated, so the shared
# header never points at a page this project does not build — the link check would fail the build,
# which is the point, but a template should not need editing to pass it.
PLANNED_PAGES: set[str] = set()

HEADER_LINKS = [
    ('how_to_read.html', 'How to read', 'text-slate-400 hover:text-slate-200'),
    ('rounds.html', 'Rounds', 'text-slate-400 hover:text-slate-200'),
    ('corrections.html', 'Corrections', 'text-amber-300 hover:text-amber-200'),
    ('diagrams.html', 'Diagrams', 'text-slate-400 hover:text-slate-200'),
    ('capability_gallery.html', 'Gallery', 'text-slate-400 hover:text-slate-200'),
    ('code_atlas.html', 'Code atlas', 'text-slate-400 hover:text-slate-200'),
    ('all_docs_onepage.html', 'One scroll', 'text-slate-400 hover:text-slate-200'),
]


def header_links() -> str:
    return ''.join(
        f'<a href="{href}" class="text-xs {cls} no-underline">{label}</a>'
        for href, label, cls in HEADER_LINKS
        if href in PLANNED_PAGES
    )


# --------------------------------------------------------------------------- page shell
def shell(title: str, subtitle: str, body: str, extra_head: str = '', extra_js: str = '',
          nav_here: str = '') -> str:
    return f"""<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-950 text-slate-100 dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
{theme_shared.THEME_BOOT}
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<style>
::-webkit-scrollbar {{ width: 8px; height: 8px; }}
::-webkit-scrollbar-track {{ background: #0f172a; }}
::-webkit-scrollbar-thumb {{ background: #334155; border-radius: 4px; }}
{theme_shared.THEME_CSS}
{CITE_CSS}
{extra_head}
</style>
</head>
<body class="min-h-full font-sans antialiased">
<header class="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-2.5">
  <div class="max-w-[100rem] mx-auto flex items-center gap-3 flex-wrap">
    <a href="index.html" class="flex items-center gap-2 text-sm font-semibold text-slate-100 no-underline hover:text-emerald-300">
      <i data-lucide="box" class="w-4 h-4 text-emerald-400"></i> {html.escape(PROJECT)}
    </a>
    <span class="text-slate-600">/</span>
    <span class="text-sm text-slate-300">{html.escape(subtitle)}</span>
    <div class="ml-auto flex items-center gap-2">
      {header_links()}
      {theme_shared.THEME_TOGGLE_BTN}
    </div>
  </div>
</header>
{body}
<script>
{theme_shared.THEME_INIT_JS}
window.BimTheme.init();
{extra_js}
if (window.lucide) lucide.createIcons();
</script>
</body>
</html>
"""


NAV_PILL = """<!--BIM_NAV_PILL-->
<style>
#bim-nav-pill { position: fixed; left: 0.75rem; bottom: 0.75rem; z-index: 9999;
  display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.7rem;
  border-radius: 9999px; font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
  background: rgba(15,23,42,0.92); color: #e2e8f0; border: 1px solid #334155;
  text-decoration: none; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
#bim-nav-pill:hover { background: rgba(30,41,59,0.98); color: #6ee7b7; }
html.light #bim-nav-pill { background: rgba(255,255,255,0.95); color: #0f172a; border-color: #cbd5e1; }
</style>
<a id="bim-nav-pill" href="index.html" title="Back to the doc hub">&#8592; Doc hub</a>
<!--/BIM_NAV_PILL-->"""


def inject_nav(path: pathlib.Path) -> bool:
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'<!--BIM_NAV_PILL-->.*?<!--/BIM_NAV_PILL-->\n?', '', text, flags=re.S)
    m = re.search(r'</body>', text, flags=re.I)
    if m is None:
        return False
    path.write_text(text[: m.start()] + NAV_PILL + '\n' + text[m.start() :], encoding='utf-8')
    return True


# --------------------------------------------------------------------------- doc pages
def toc_html(headings: list[tuple[int, str, str]]) -> str:
    rows = []
    for level, text, slug in headings:
        if level > 3:
            continue
        pad = {1: 'pl-0 font-semibold text-slate-200', 2: 'pl-0 text-slate-300',
               3: 'pl-3 text-slate-400'}[level]
        rows.append(
            f'<a href="#{slug}" class="block py-1 text-xs {pad} no-underline hover:text-emerald-300 '
            f'border-l border-transparent hover:border-emerald-500 -ml-px toc-link" data-slug="{slug}">'
            f'{html.escape(text)}</a>'
        )
    return ''.join(rows)


# Which colour the *claim* layer gets. Green is never a claim colour — green is only ever the
# current state, so "green" and "what to implement" mean the same thing everywhere on this site.
CLAIM_LAYER = {
    'WRONG': ('red', '&#128308;', 'Wrong as written'),
    'STALE': ('amber', '&#128993;', 'Was true, has since changed'),
    'SCOPE': ('amber', '&#128993;', 'Superseded by a later scope decision'),
    'CONFIRMED': (None, '', ''),
    'ADDED': (None, '', ''),
}


PROVENANCE_LABEL = {
    'harness': ('&#129302;', 'harness review'),
    'user': ('&#128100;', 'your finding'),
    'external': ('&#128279;', 'external source'),
}


def v_of(entry: dict) -> str:
    """The current verdict — i.e. the newest check's."""
    return latest_check(entry).get('verdict', 'CONFIRMED')


def now_of(entry: dict) -> str:
    return latest_check(entry).get('now', '')


def at_of(entry: dict) -> str:
    return latest_check(entry).get('at', '')


def latest_check(entry: dict) -> dict:
    """The newest check on a claim — the green, current state."""
    checks = entry.get('checks') or []
    return max(checks, key=lambda c: (c.get('round', 0), c.get('at', ''))) if checks else {}


def by_html(by: str, url: str = '') -> str:
    if url:
        return (f'<a class="text-slate-400 hover:text-slate-200 no-underline" href="{html.escape(url, quote=True)}"'
                f' target="_blank" rel="noopener">{html.escape(by or url)}</a>')
    if by and by.endswith(('.md', '.csv')):
        return (f'<a class="text-slate-400 hover:text-slate-200 no-underline" href="{doc_link(by)}">'
                f'{html.escape(by.replace(".md", ""))}</a>')
    return html.escape(by or 'harness review')


def fix_chip(fix_state: str) -> str:
    return (
        '<span class="text-[10px] px-1 py-0.5 rounded border border-emerald-500/40 '
        'text-emerald-300">verified</span>' if fix_state == 'CONFIRMED' else
        '<span class="text-[10px] px-1 py-0.5 rounded border border-amber-500/40 '
        'text-amber-300">proposed, not yet done</span>'
    )


def verdict_box(entries: list[dict], doc_stem: str, current_round: int = 1) -> str:
    """Renders a claim's full history: as-written, then one dated layer per harness round.

    Read top to bottom in time order. Only the newest layer is green; every superseded layer is struck
    through and keeps its own date and provenance, so a re-run adds to the record instead of replacing
    it. Green is the current final, and provisional — the next round can turn it amber or red.
    """
    cards = []
    for i, entry in enumerate(entries):
        checks = sorted(entry.get('checks') or [],
                        key=lambda c: (c.get('round', 0), c.get('at', '')))
        if not checks:
            continue
        newest = checks[-1]
        colour, icon, tip = VERDICT_STYLE[newest['verdict']]
        border, text_cls, _bg = BADGE_COLORS[colour]
        written = entry.get('claim_written', '')
        is_new = newest.get('round', 1) == current_round and current_round > 1

        # Layer 0 — the claim as authored. Struck if any check retracted it.
        claim_colour, claim_dot, claim_tip = CLAIM_LAYER[checks[0]['verdict']]
        if claim_colour:
            c_border, c_text, c_bg = BADGE_COLORS[claim_colour]
            layers = [
                f'<div class="border-l-2 {c_border} {c_bg} pl-3 py-1.5 mb-2">'
                f'<div class="text-[11px] {c_text} mb-0.5">{claim_dot} '
                f'{html.escape(claim_tip)} &middot; written {html.escape(written)}</div>'
                f'<div class="text-xs text-slate-400 line-through decoration-slate-600/60">'
                f'{md_render.render_inline(entry["claim"])}</div></div>'
            ]
        else:
            layers = [
                f'<div class="text-[11px] text-slate-500 mb-2">written {html.escape(written)}: '
                f'{md_render.render_inline(entry["claim"])}</div>'
            ]

        # Layers 1..n-1 — superseded checks, kept and struck.
        for check in checks[:-1]:
            p_icon, p_label = PROVENANCE_LABEL.get(check.get('provenance', 'harness'),
                                                   PROVENANCE_LABEL['harness'])
            layers.append(
                f'<div class="border-l-2 border-slate-700 pl-3 py-1.5 mb-2">'
                f'<div class="text-[11px] text-slate-500 mb-0.5">&#9711; superseded &middot; '
                f'round {check.get("round", "?")} &middot; {html.escape(check.get("at", ""))} '
                f'&middot; {p_icon} {html.escape(p_label)} &middot; '
                f'{by_html(check.get("by", ""), check.get("source_url", ""))}</div>'
                f'<div class="text-xs text-slate-500 line-through decoration-slate-700">'
                f'{md_render.render_inline(check["now"])}</div></div>'
            )

        # Newest layer — green.
        p_icon, p_label = PROVENANCE_LABEL.get(newest.get('provenance', 'harness'),
                                               PROVENANCE_LABEL['harness'])
        layers.append(
            f'<div class="border-l-2 border-emerald-500/50 bg-emerald-950/10 pl-3 py-1.5">'
            f'<div class="text-[11px] text-emerald-300 mb-0.5 flex items-center gap-1.5 flex-wrap">'
            f'&#128994; Current &middot; round {newest.get("round", 1)} &middot; '
            f'as of {html.escape(newest.get("at", ""))} '
            f'{fix_chip(newest.get("fix_state", "CONFIRMED"))}</div>'
            f'<div class="text-xs text-slate-200 leading-relaxed">'
            f'{md_render.render_inline(newest["now"])}</div></div>'
        )

        target = entry.get('target', '')
        target_layer = (
            f'<div class="mt-2 text-[11px] text-slate-400"><span class="text-slate-500">'
            f'&#127919; Target &mdash;</span> {md_render.render_inline(target)}</div>'
            if target else ''
        )
        new_chip = (
            '<span class="text-[10px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-200">'
            f'new in round {current_round}</span>' if is_new else ''
        )

        cards.append(f"""<div id="v-{doc_stem}-{i}" class="border {border} rounded-lg p-3 my-3 scroll-mt-24">
  <div class="flex items-center gap-2 mb-2 flex-wrap">
    <i data-lucide="{icon}" class="w-3.5 h-3.5 {text_cls}"></i>
    <span class="text-[11px] font-bold tracking-wide {text_cls}">{newest['verdict']}</span>
    <span class="text-[11px] text-slate-500">{p_icon} {html.escape(p_label)} &middot;
      {by_html(newest.get('by', ''), newest.get('source_url', ''))}</span>
    {new_chip}
  </div>
  {''.join(layers)}
  {target_layer}
</div>""")
    return ''.join(cards)


def doc_link(source_name: str) -> str:
    if source_name == PLAN_CSV:
        return 'plan_table.html'
    for page, _label, md in DOC_PAGES:
        if md == source_name:
            return page
    return '#'


def render_doc(resolver: citations.Resolver, md_name: str, verdicts: list[dict],
               report: list[str], heading_offset: int = 0, cur_round: int = 1) -> dict:
    """Renders one markdown doc to HTML with citation links and verdict cards attached.

    Shared by the per-doc pages and the one-scroll view, so the two can never disagree about content
    — which is exactly how the old one-pager ended up missing the four review reports.

    `heading_offset` shifts heading levels down for the one-pager, where each doc sits under an h1.
    """
    md_path = HERE / md_name
    md = md_path.read_text(encoding='utf-8')
    resolver.start_doc(md_name)
    body, headings = md_render.render(md, resolver.hook)

    # Attach verdict cards under the heading they correct.
    doc_stem = re.sub(r'[^a-z0-9]+', '', md_name.lower())[:14]
    by_slug: dict[str, list[dict]] = {}
    for entry in verdicts:
        needle = entry['match'].lower()
        hit = next((slug for _l, text, slug in headings if needle in text.lower()), None)
        if hit is None:
            report.append(f'  !! verdict match failed in {md_name}: "{entry["match"]}"')
            continue
        by_slug.setdefault(hit, []).append(entry)
    n_cards = 0
    anchors = {e['match']: slug for slug, entries in by_slug.items() for e in entries}
    for slug, entries in by_slug.items():
        pattern = re.compile(r'(<h[1-4] id="' + re.escape(slug) + r'".*?</h[1-4]>)', flags=re.S)
        replacement = r'\1' + verdict_box(entries, f'{doc_stem}-{slug}'[:40])
        body, count = pattern.subn(replacement, body, count=1)
        n_cards += len(entries) if count else 0

    counts: dict[str, int] = {}
    for entry in verdicts:
        counts[v_of(entry)] = counts.get(v_of(entry), 0) + 1
    chips = ''.join(
        f'<span class="text-[11px] px-1.5 py-0.5 rounded border '
        f'{BADGE_COLORS[VERDICT_STYLE[v][0]][0]} {BADGE_COLORS[VERDICT_STYLE[v][0]][1]}">{v} {n}</span>'
        for v, n in sorted(counts.items())
    )
    banner = ''
    if verdicts:
        banner = (
            '<div class="flex items-center gap-2 flex-wrap mb-4 pb-3 border-b border-slate-800">'
            '<span class="text-xs text-slate-500">Review verdicts on this doc:</span>'
            f'{chips}'
            '<a href="corrections.html" class="text-xs text-slate-400 hover:text-slate-200 '
            'no-underline ml-1">see all corrections &rarr;</a></div>'
        )

    return {'md': md_name, 'body': body, 'headings': headings, 'banner': banner,
            'n_cards': n_cards, 'anchors': anchors, 'used': set(resolver.used)}


def build_doc_page(resolver: citations.Resolver, page: str, label: str, md_name: str,
                   verdicts: list[dict], report: list[str], cur_round: int = 1) -> dict:
    doc = render_doc(resolver, md_name, verdicts, report, cur_round=cur_round)
    body, headings, banner = doc['body'], doc['headings'], doc['banner']
    snippets = resolver.snippets_json(sorted(resolver.used))
    body_html = f"""
<div class="max-w-[100rem] mx-auto flex gap-6 px-4 py-6">
  <aside class="hidden xl:block w-64 shrink-0">
    <div class="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto pr-2 border-l border-slate-800 pl-3">
      <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-2">On this page</div>
      {toc_html(headings)}
    </div>
  </aside>
  <main class="min-w-0 flex-1 max-w-4xl">
    <div class="text-[11px] text-slate-500 mb-1">{html.escape(md_name)}</div>
    {banner}
    <article>{body}</article>
    <!-- slate-400, not 500: on slate-950 the lighter shade is the difference between 4.2:1 and AA. -->
    <div class="mt-10 pt-4 border-t border-slate-800 text-xs text-slate-400">
      Every <code class="text-sky-300">file:line</code> above links to the real code in this
      worktree, resolved by symbol. Click one to open the snippet drawer; a
      <span class="text-amber-300">~</span> marks a citation whose line number had drifted and was
      re-anchored by name.
    </div>
  </main>
</div>
{drawer_html()}
<script id="snips" type="application/json">{snippets}</script>
"""
    out = HERE / page
    out.write_text(shell(f'{label} — {PROJECT}', label, body_html, extra_js=DRAWER_JS),
                   encoding='utf-8')
    return {'page': page, 'label': label, 'md': md_name, 'headings': headings,
            'n_cards': doc['n_cards'], 'n_cites': len(resolver.used), 'anchors': doc['anchors']}


ANNOTATED_LEGEND = """<!-- GENERATED by build_site.py — do not edit. Source of truth: {doc} + verdicts.json -->

# {doc} — annotated

> **This is a generated reading copy.** The original `{doc}` is never edited; it is the record of what
> we believed and when. Every correction below is inserted under the section it applies to, in time
> order, so the claim and its current state can be read together.
>
> | mark | meaning |
> | --- | --- |
> | :red_circle: **WRONG** | The claim was not true. Struck through, with the date it was written. |
> | :yellow_circle: **STALE** | Was true when written; the code or the scope has since moved. |
> | :green_circle: **CURRENT** | The current statement, with the date it was verified. **This is what to implement.** |
> | :dart: **TARGET** | What has to be achieved before the correction goes away. |
>
> Green is the current final, not a permanent one: a later harness run against changed code can turn a
> green statement yellow or red in turn. Each mark carries its own timestamp so you can always tell
> which pass produced it.
>
> Diagrams, capability explainers and discussion pages deliberately carry **no** history — they show
> only the newest confirmed state, so there is no chance of building a superseded version.

---

"""

PROVENANCE_MD = {
    'harness': '',
    'user': 'your finding — ',
    'external': 'external source — ',
}

MARK = {
    'WRONG': (':red_circle:', 'WRONG'),
    'STALE': (':yellow_circle:', 'STALE'),
    'SCOPE': (':yellow_circle:', 'SUPERSEDED'),
    'CONFIRMED': (':green_circle:', 'CONFIRMED'),
    'ADDED': (':large_blue_circle:', 'ADDITION'),
}


def build_annotated_markdown(verdicts: list[dict], report: list[str]) -> int:
    """Writes `annotated/<doc>.md`: the doc with colour-marked, timestamped corrections inline.

    Text carries its full history. The HTML pages render the same three layers; this exists so the
    history is readable in any markdown viewer, in a diff, or in a terminal.
    """
    out_dir = HERE / 'annotated'
    out_dir.mkdir(exist_ok=True)
    by_doc: dict[str, list[dict]] = {}
    for entry in verdicts:
        by_doc.setdefault(entry['doc'], []).append(entry)

    written = 0
    for doc, entries in by_doc.items():
        src = HERE / doc
        if not src.exists() or src.suffix != '.md':
            continue
        lines = src.read_text(encoding='utf-8').split('\n')
        # heading line index -> blocks to insert after it
        inserts: dict[int, list[str]] = {}
        for entry in entries:
            needle = entry['match'].lower()
            idx = next(
                (i for i, ln in enumerate(lines)
                 if ln.startswith('#') and needle in ln.lower()),
                None,
            )
            if idx is None:
                report.append(f'  !! annotated: no heading for "{entry["match"]}" in {doc}')
                continue
            checks = sorted(entry.get('checks') or [],
                            key=lambda c: (c.get('round', 0), c.get('at', '')))
            if not checks:
                continue
            newest = checks[-1]
            dot, label = MARK[newest['verdict']]
            state = ('verified' if newest.get('fix_state', 'CONFIRMED') == 'CONFIRMED'
                     else 'proposed, not yet done')
            block = [
                '',
                f'> {dot} **{label}** · round {newest.get("round", 1)} '
                f'· checked {newest.get("at", "")} '
                f'· {PROVENANCE_MD.get(newest.get("provenance", "harness"), "")}'
                f'{newest.get("by", "harness review")}',
                '>',
            ]
            if checks[0]['verdict'] in ('WRONG', 'STALE', 'SCOPE'):
                block += [
                    f'> **As written ({entry.get("claim_written", "")}):** '
                    f'~~{entry["claim"]}~~',
                    '>',
                ]
            else:
                block += [f'> **Claim ({entry.get("claim_written", "")}):** {entry["claim"]}', '>']
            # Superseded rounds stay in the record, struck through, with their own dates.
            for old_check in checks[:-1]:
                block += [
                    f'> :white_circle: **SUPERSEDED (round {old_check.get("round", "?")}, '
                    f'{old_check.get("at", "")}):** ~~{old_check["now"]}~~',
                    '>',
                ]
            block += [
                f'> :green_circle: **CURRENT (round {newest.get("round", 1)}, '
                f'{newest.get("at", "")}, {state}):** {newest["now"]}',
            ]
            if entry.get('target'):
                block += ['>', f'> :dart: **TARGET:** {entry["target"]}']
            block.append('')
            inserts.setdefault(idx, []).extend(block)

        out_lines: list[str] = []
        for i, ln in enumerate(lines):
            out_lines.append(ln)
            if i in inserts:
                out_lines.extend(inserts[i])
        (out_dir / doc).write_text(
            ANNOTATED_LEGEND.format(doc=doc) + '\n'.join(out_lines), encoding='utf-8')
        written += 1
    return written


def drawer_html() -> str:
    return """
<div id="snip-drawer" aria-hidden="true">
  <div class="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800">
    <i data-lucide="file-code-2" class="w-4 h-4 text-emerald-400"></i>
    <div class="min-w-0">
      <div id="snip-title" class="text-sm font-semibold text-slate-100 truncate"></div>
      <div id="snip-sub" class="text-[11px] text-slate-500 truncate"></div>
    </div>
    <a id="snip-open" href="#" class="ml-auto text-xs text-blue-400 hover:text-blue-300 no-underline whitespace-nowrap">full file &rarr;</a>
    <button id="snip-close" class="text-slate-400 hover:text-slate-100 px-1" aria-label="Close">&#10005;</button>
  </div>
  <div class="overflow-y-auto px-4 py-3 grow">
    <div id="snip-doc" class="text-xs text-emerald-200/90 doc-prose border-l-2 border-emerald-500/40 pl-3 mb-3 hidden"></div>
    <div id="snip-code"></div>
  </div>
</div>
"""


DRAWER_JS = r"""
(function () {
  const el = document.getElementById('snips');
  if (!el) return;
  const snips = JSON.parse(el.textContent);
  const drawer = document.getElementById('snip-drawer');
  const KEYWORDS = {
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None',
    typescript: 'as async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null return super switch this throw true try type typeof var void while yield',
    wgsl: 'alias break case const continue default discard else enum fn for if let loop return struct switch var while true false',
  };
  function esc(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]); }
  function paint(code, lang, first, hitStart, hitEnd) {
    const kw = (KEYWORDS[lang] || '').split(' ').filter(Boolean);
    const kwRe = kw.length ? new RegExp('\\b(' + kw.join('|') + ')\\b', 'g') : null;
    const lineComment = lang === 'python' ? /#.*$/ : /\/\/.*$/;
    return code.split('\n').map((line, i) => {
      const n = first + i;
      let out;
      const doc = lang === 'rust' && /^\s*(\/\/\/|\/\/!)/.test(line);
      if (doc) {
        out = '<span class="tok-d">' + esc(line) + '</span>';
      } else {
        const m = line.match(lineComment);
        const cut = m ? m.index : line.length;
        let head = esc(line.slice(0, cut));
        head = head.replace(/(&quot;|")(?:[^"\\]|\\.)*?\1/g, s => '<span class="tok-s">' + s + '</span>');
        if (kwRe) head = head.replace(kwRe, '<span class="tok-k">$1</span>');
        out = head + (m ? '<span class="tok-c">' + esc(line.slice(cut)) + '</span>' : '');
      }
      const hit = (n >= hitStart && n <= hitEnd) ? ' hit' : '';
      return '<span class="code-line' + hit + '"><span class="ln">' + n + '</span>' + (out || ' ') + '</span>';
    }).join('');
  }
  function open(key) {
    const s = snips[key];
    if (!s) return;
    document.getElementById('snip-title').textContent = s.kind + ' ' + s.symbol;
    document.getElementById('snip-sub').textContent =
      s.file + ':' + s.line_start + '-' + s.line_end + '  ·  cited as :' +
      (s.cited_start === s.cited_end ? s.cited_start : s.cited_start + '-' + s.cited_end) +
      (s.windowed ? '  ·  trimmed from ' + s.kind + ' ' + s.item_start + '-' + s.item_end : '');
    const docEl = document.getElementById('snip-doc');
    docEl.textContent = s.doc || '';
    docEl.classList.toggle('hidden', !s.doc);
    document.getElementById('snip-code').innerHTML =
      paint(s.code, s.lang, s.line_start, s.cited_start, s.cited_end);
    const link = document.getElementById('snip-open');
    link.href = s.page + '#' + s.anchor;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    const first = document.querySelector('#snip-code .hit');
    if (first) first.scrollIntoView({ block: 'center' });
  }
  function close() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a.cite');
    if (a) { ev.preventDefault(); open(a.dataset.snip); return; }
    if (ev.target.closest('#snip-close')) { close(); }
    else if (drawer.classList.contains('open') && !ev.target.closest('#snip-drawer')) { close(); }
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
  const links = Array.from(document.querySelectorAll('.toc-link'));
  if (links.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(l => l.classList.toggle('text-emerald-300',
          l.dataset.slug === e.target.id));
      });
    }, { rootMargin: '-64px 0px -70% 0px' });
    document.querySelectorAll('h1[id],h2[id],h3[id]').forEach(h => obs.observe(h));
  }
})();
"""


# --------------------------------------------------------------------------- code atlas
def build_code_pages(resolver: citations.Resolver, report: list[str]) -> list[dict]:
    pages = []
    cited_by: dict[str, list[tuple[str, str]]] = {}
    for ref in resolver.refs.values():
        cited_by.setdefault(f'{ref["file"]}#{ref["symbol"]}@{ref["line_start"]}', [])
    # Which doc pages cite which item.
    for doc_id, page in resolver.cite_pages.items():
        for key in page:
            cited_by.setdefault(key, []).append(doc_id)

    for rel, meta in resolver.files.items():
        if not meta['items'] and meta['lang'] == 'text':
            continue
        page = citations.page_slug(rel)
        used_items = [
            it for it in meta['items']
            if f'{rel}#{it["symbol"]}@{it["line_start"]}' in resolver.refs
        ]
        item_list = ''.join(
            f'<a href="#{citations.anchor(it["symbol"], it["line_start"])}" '
            f'class="block py-0.5 text-xs text-slate-400 hover:text-emerald-300 no-underline truncate" '
            f'title="{html.escape(it["symbol"])}">'
            f'<span class="text-slate-600">{it["kind"]}</span> {html.escape(it["symbol"])}'
            f'<span class="text-slate-600"> :{it["line_start"]}</span></a>'
            for it in meta['items']
        )
        blocks = []
        for it in meta['items']:
            key = f'{rel}#{it["symbol"]}@{it["line_start"]}'
            refs = cited_by.get(key, [])
            cited_html = ''
            if refs:
                links = ', '.join(
                    f'<a class="text-blue-400 hover:text-blue-300 no-underline" '
                    f'href="{doc_link(d)}">{html.escape(d.replace(".md", ""))}</a>'
                    for d in sorted(set(refs))
                )
                cited_html = (
                    f'<div class="text-[11px] text-slate-400 mb-1.5">cited by {links}</div>'
                )
            doc_html = ''
            if it['doc']:
                doc_html = (
                    '<div class="text-xs text-emerald-200/90 doc-prose border-l-2 '
                    'border-emerald-500/40 pl-3 my-2">' + html.escape(it['doc']) + '</div>'
                )
            blocks.append(f"""<section id="{citations.anchor(it['symbol'], it['line_start'])}" class="mb-8 scroll-mt-20">
  <h2 class="text-sm font-semibold text-slate-100 mb-1 flex items-baseline gap-2 flex-wrap">
    <span class="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-normal">{it['kind']}</span>
    <span class="font-mono">{html.escape(it['symbol'])}</span>
    <a href="#full-file" class="text-[11px] text-slate-500 hover:text-slate-300 no-underline font-normal">
      lines {it['line_start']}-{it['line_end']}</a>
  </h2>
  {cited_html}{doc_html}
  {code_block(it['code'], meta['lang'], it['line_start'])}
</section>""")
        full = code_block(meta['source'], meta['lang'], 1, id_prefix='')
        body = f"""
<div class="max-w-[100rem] mx-auto flex gap-6 px-4 py-6">
  <aside class="hidden xl:block w-72 shrink-0">
    <div class="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto pr-2 border-l border-slate-800 pl-3">
      <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
        {len(meta['items'])} items · {meta['n_lines']} lines</div>
      <input id="item-filter" type="search" placeholder="filter items…"
        class="w-full mb-2 px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200">
      <div id="item-list">{item_list}</div>
    </div>
  </aside>
  <main class="min-w-0 flex-1">
    <h1 class="text-lg font-bold text-slate-100 font-mono break-all">{html.escape(rel)}</h1>
    <p class="text-xs text-slate-500 mt-1 mb-6">{meta['lang']} · {meta['n_lines']} lines ·
      {len(used_items)} of {len(meta['items'])} items are cited by the docs</p>
    {''.join(blocks)}
    <section id="full-file" class="mt-12 scroll-mt-20">
      <h2 class="text-sm font-semibold text-slate-100 mb-2">Full file</h2>
      {full}
    </section>
  </main>
</div>
"""
        js = """
(function () {
  const box = document.getElementById('item-filter');
  if (!box) return;
  box.addEventListener('input', () => {
    const q = box.value.toLowerCase();
    document.querySelectorAll('#item-list a').forEach(a => {
      a.style.display = a.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
})();
"""
        (HERE / page).write_text(
            shell(f'{rel} — code atlas', rel.rsplit('/', 1)[-1], body, extra_js=js),
            encoding='utf-8',
        )
        pages.append({'page': page, 'file': rel, 'lang': meta['lang'],
                      'n_items': len(meta['items']), 'n_lines': meta['n_lines'],
                      'n_cited': len(used_items)})
    return pages


def build_atlas_index(pages: list[dict]) -> None:
    groups: dict[str, list[dict]] = {}
    for p in pages:
        if p['file'].startswith('tools/wgpu_renderer/src'):
            key = 'Rust crate — tools/wgpu_renderer/src'
        elif p['file'].startswith('tools/wgpu_renderer'):
            key = 'Exporter — tools/wgpu_renderer/wgpu_data_utils'
        elif p['file'].startswith('dashboard'):
            key = 'Browser host — dashboard/papps/frontends'
        else:
            key = 'Producer side — tools/gl_graphics, graphics_api, akselos'
        groups.setdefault(key, []).append(p)

    sections = []
    for key in sorted(groups):
        rows = ''.join(
            f'<tr><td class="border border-slate-800 px-2 py-1"><a class="text-blue-400 '
            f'hover:text-blue-300 no-underline font-mono text-xs" href="{p["page"]}">'
            f'{html.escape(p["file"].rsplit("/", 1)[-1])}</a></td>'
            f'<td class="border border-slate-800 px-2 py-1 text-xs text-slate-500">{p["lang"]}</td>'
            f'<td class="border border-slate-800 px-2 py-1 text-xs text-right">{p["n_lines"]}</td>'
            f'<td class="border border-slate-800 px-2 py-1 text-xs text-right">{p["n_items"]}</td>'
            f'<td class="border border-slate-800 px-2 py-1 text-xs text-right '
            f'{"text-emerald-300" if p["n_cited"] else "text-slate-600"}">{p["n_cited"]}</td></tr>'
            for p in sorted(groups[key], key=lambda x: -x['n_cited'])
        )
        sections.append(f"""<h2 class="text-base font-semibold text-emerald-300 mt-8 mb-2">{html.escape(key)}</h2>
<table class="w-full border border-slate-800 border-collapse">
<thead><tr class="bg-slate-800/60 text-xs text-slate-300">
<th class="border border-slate-800 px-2 py-1 text-left">file</th>
<th class="border border-slate-800 px-2 py-1 text-left">lang</th>
<th class="border border-slate-800 px-2 py-1 text-right">lines</th>
<th class="border border-slate-800 px-2 py-1 text-right">items</th>
<th class="border border-slate-800 px-2 py-1 text-right">cited</th>
</tr></thead><tbody>{rows}</tbody></table>""")

    body = f"""<div class="max-w-5xl mx-auto px-4 py-8">
<h1 class="text-2xl font-bold text-slate-100">Code atlas</h1>
<p class="text-sm text-slate-400 mt-2 max-w-3xl">Every source file the research docs cite, in this
worktree (<code class="text-emerald-300">wgpu-pick-wt</code>), split into its items with the doc
comments attached and the full file below. The <span class="text-emerald-300">cited</span> column is
how many of a file's items the docs actually point at — the rest is context.</p>
{''.join(sections)}
</div>"""
    (HERE / 'code_atlas.html').write_text(
        shell(f'Code atlas — {PROJECT}', 'Code atlas', body), encoding='utf-8')


# --------------------------------------------------------------------------- corrections + plan
def build_corrections(verdicts: list[dict], anchors: dict[str, dict[str, str]],
                      resolver: citations.Resolver | None = None) -> None:
    hook = None
    if resolver is not None:
        resolver.start_doc('corrections')
        hook = resolver.hook

    def prose(text: str) -> str:
        return md_render.render_inline(text, hook)

    by_doc: dict[str, list[dict]] = {}
    for entry in verdicts:
        by_doc.setdefault(entry['doc'], []).append(entry)
    order = {md: i for i, (_p, _l, md) in enumerate(DOC_PAGES)}
    sections = []
    for doc in sorted(by_doc, key=lambda d: order.get(d, 99)):
        label = next((l for _p, l, md in DOC_PAGES if md == doc), doc)
        cards = []
        for entry in by_doc[doc]:
            colour, icon, tip = VERDICT_STYLE[v_of(entry)]
            border, text_cls, bg = BADGE_COLORS[colour]
            cards.append(f"""<div class="border {border} {bg} rounded-lg p-3 my-3">
  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
    <i data-lucide="{icon}" class="w-3.5 h-3.5 {text_cls}"></i>
    <span class="text-[11px] font-bold {text_cls}">{v_of(entry)}</span>
    <span class="text-[11px] text-slate-500">&sect; {html.escape(entry['match'])}</span>
    <a class="ml-auto text-[11px] text-blue-400 hover:text-blue-300 no-underline"
       href="{doc_link(doc)}#{anchors.get(doc, {}).get(entry['match'], '')}">open in doc &rarr;</a>
  </div>
  <div class="text-xs text-slate-400 mb-1"><span class="text-slate-500">Doc says:</span>
    {prose(entry['claim'])}</div>
  <div class="text-xs text-slate-200 leading-relaxed"><span class="text-slate-500">Now:</span>
    {prose(now_of(entry))}</div>
</div>""")
        sections.append(
            f'<h2 class="text-base font-semibold text-emerald-300 mt-8 mb-1">'
            f'<a class="no-underline hover:text-emerald-200" href="{doc_link(doc)}">'
            f'{html.escape(label)}</a></h2>'
            f'<div class="text-[11px] text-slate-500 mb-2">{html.escape(doc)}</div>'
            + ''.join(cards)
        )
    counts: dict[str, int] = {}
    for entry in verdicts:
        counts[v_of(entry)] = counts.get(v_of(entry), 0) + 1
    chips = ''.join(
        f'<span class="px-2 py-1 rounded border {BADGE_COLORS[VERDICT_STYLE[v][0]][0]} '
        f'{BADGE_COLORS[VERDICT_STYLE[v][0]][1]} text-xs">{v} {n}</span>'
        for v, n in sorted(counts.items())
    )
    body = f"""<div class="max-w-4xl mx-auto px-4 py-8">
<h1 class="text-2xl font-bold text-slate-100">Corrections</h1>
<p class="text-sm text-slate-400 mt-2">What the 2026-07-30 harness review changed about these docs.
The markdown files are left as the historical record — this page and the badges inside each doc are
the current truth. Sourced from the four <code class="text-emerald-300">07_review_*.md</code>
reports.</p>
<div class="flex gap-2 flex-wrap my-4">{chips}</div>
{''.join(sections)}
</div>
{drawer_html() if resolver is not None else ""}
<script id="snips" type="application/json">{resolver.snippets_json(sorted(resolver.used)) if resolver is not None else "{{}}"}</script>
"""
    (HERE / 'corrections.html').write_text(
        shell(f'Corrections — {PROJECT}', 'Corrections', body,
              extra_js=DRAWER_JS if resolver is not None else ''), encoding='utf-8')


def _load_diagrams() -> list[tuple[str, str, str]]:
    """The four inline SVG diagrams, from `build_html.py` (which no longer generates a page).

    Returns an empty list if that module is gone, so the diagram page and the diagram sections of the
    one-scroll view degrade to "absent" instead of breaking the build.
    """
    try:
        import build_html
    except ImportError:
        return []
    return list(getattr(build_html, 'DIAGRAMS', []))


DIAGRAM_NOTES = {
    'diag_load': (
        'Where the tab freezes today, and what P2 changes. The red band is the main thread blocked '
        'through push_chunk + MD5 + finalize + create_buffer_init; note the progress callback firing '
        '100% before any of it (defect B2).'
    ),
    'diag_pick': (
        'Click-to-data end to end. Everything up to on_pick ships on this branch; the two green-to-'
        'amber steps at the host end are the gap — pick_map.json is never transported and '
        'set_on_pick has no JS caller.'
    ),
    'diag_erd': (
        'The wire format the browser actually receives: RenderGroup, ArrayDescriptor, RenderItem and '
        'the chunk manifest. The dashed box is what a BIM semantic layer would need and the schema '
        'does not have — there is still no element_id on RenderItem.'
    ),
    'diag_knobs': (
        'The three synth_bench knobs against the three walls. Each knob moves one axis only, which '
        'is the whole point: bytes, draw calls and bind-group churn have to be separable or a '
        'measurement tells you nothing.'
    ),
}


def current_stamp(verdicts: list[dict]) -> str:
    """Newest check date in the overlay — the vintage of every current-state-only page."""
    return max((at_of(e) for e in verdicts), default='')


def build_diagrams_page(stamp: str = '') -> None:
    """Surfaces the four SVG diagrams as a first-class page.

    They only existed inside the legacy one-pager, and they were authored light-first with hardcoded
    hex — so dark mode used to paint a grey plate behind them. They are variable-driven now, which is
    what makes this page possible in both themes.
    """
    diagrams = _load_diagrams()
    if not diagrams:
        return

    sections = []
    toc = []
    for diag_id, title, svg in diagrams:
        note = DIAGRAM_NOTES.get(diag_id, '')
        toc.append(
            f'<a href="#{diag_id}" class="block py-1 text-xs text-slate-300 no-underline '
            f'hover:text-emerald-300">{html.escape(title)}</a>'
        )
        sections.append(f"""<section id="{diag_id}" class="mb-12 scroll-mt-20">
  <h2 class="text-base font-semibold text-emerald-300 mb-1">{html.escape(title)}</h2>
  <p class="text-xs text-slate-400 mb-3 max-w-3xl leading-relaxed">{html.escape(note)}</p>
  <!-- Card colour comes from the diagram palette, not Tailwind: the lane fill in light mode is
       #f4f6f8, which would vanish against a slate-100 card. -->
  <div class="rounded-lg p-3" style="background: var(--d-surface); border: 1px solid var(--d-line);">{svg}</div>
</section>""")

    body = f"""
<div class="max-w-[100rem] mx-auto flex gap-6 px-4 py-6">
  <aside class="hidden xl:block w-64 shrink-0">
    <div class="sticky top-16 border-l border-slate-800 pl-3">
      <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Diagrams</div>
      {''.join(toc)}
    </div>
  </aside>
  <main class="min-w-0 flex-1 max-w-5xl">
    <h1 class="text-2xl font-bold text-slate-100">Diagrams</h1>
    <p class="text-sm text-slate-400 mt-2 max-w-3xl leading-relaxed">Two sequence charts, the
    wire-format ERD, and the benchmark-knobs chart. All four follow the light/dark toggle — their
    colours are CSS variables, so nothing is a fixed-palette image.</p>
    <div class="flex items-center gap-2 my-4 text-xs border border-emerald-500/40 bg-emerald-950/10
      rounded-lg px-3 py-2">
      <span class="text-emerald-300">&#128994; Current state as of __STAMP__</span>
      <span class="text-slate-400">— these show the newest confirmed picture only. No superseded
      variants, so nothing here can be mis-implemented; the history lives in the
      <a class="text-blue-400 no-underline hover:text-blue-300" href="corrections.html">text
      corrections</a>.</span>
    </div>
    {''.join(sections)}
  </main>
</div>
"""
    (HERE / 'diagrams.html').write_text(
        shell(f'Diagrams — {PROJECT}', 'Diagrams', body.replace('__STAMP__', stamp),
              extra_head=theme_shared.DIAGRAM_CSS),
        encoding='utf-8',
    )


ONEPAGE_INTRO = """
<h1 class="text-2xl font-bold text-slate-100">Everything, in one scroll</h1>
<p class="text-sm text-slate-300 mt-3 leading-relaxed">Every document in this workspace, in reading
order, with the four verification reports and all {n_corrections} corrections in place. Same content
as the individual pages — same renderer, same code links, same verdict badges — just without
navigation. Use this to read start to finish, to print, or to search the whole set with Ctrl+F.</p>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">The short version</h2>
<ol class="list-decimal pl-6 space-y-2 text-sm text-slate-300">
  <li>The crate is a <strong class="text-slate-100">FEA result viewer</strong>, not a scene graph. It
  solves the pre-tessellation and transport half of the BIM plan, and none of the "load less" half.</li>
  <li>It runs <strong class="text-slate-100">WebGL2</strong>, not WebGPU — <code
  class="text-emerald-300">use_webgl = true</code> is a hardcoded local, not a cfg. That now also
  gates picking: the readback blocks on a poll that is a no-op on a real WebGPU device.</li>
  <li>Per-element <strong class="text-slate-100">identity exists and ships</strong> on this branch,
  but not the way the audit predicted: it rides in the <code class="text-emerald-300">color</code> of
  parallel <code class="text-emerald-300">PickRenderStage</code> items, and survives <em>because</em>
  of the dedup key the audit blamed for destroying it. It is per-face, random per export, and capped
  at ~8.4M faces. Click-to-data is still not observable in the browser: the id map is never
  transported and <code class="text-emerald-300">set_on_pick</code> has no JS caller.</li>
  <li>The wall for large models is the <strong class="text-slate-100">load path</strong>, not the
  renderer — peak residency is ~3x the geometry in wasm32 linear memory against a 4 GB cap. Cheaper
  to fix than first estimated: three of the four blocking steps are synchronous JS→wasm calls and can
  move into a Web Worker with no Rust changes.</li>
  <li>A <strong class="text-slate-100">100 GB model is ~100x past three independent walls</strong>
  (network time, residency, draw calls). The benchmark's job is to measure each wall so the tiling
  budget follows from data.</li>
  <li>Scope, as of doc 05: <strong class="text-slate-100">stop at rendering limits</strong>. The
  semantic tickets are parked, and <code class="text-emerald-300">SUMMARY.md</code> plus the plan CSV
  still describe the superseded semantic-first order.</li>
</ol>
<p class="text-xs text-slate-400 mt-4">Verified against <code class="text-emerald-300">wgpu-pick-wt</code>
on 2026-07-30: native and wasm32 builds pass, 26 tests pass, <code>clippy -D warnings</code> fails
with 79 errors (77 pre-existing).</p>
"""


def build_onepage(resolver: citations.Resolver, verdicts: list[dict], report: list[str],
                  cur_round: int = 1) -> None:
    """The one-scroll view: every doc, every correction, every diagram, one file.

    Previously produced by `build_html.py` with its own markdown renderer and its own doc list, which
    drifted — it never picked up the four `07_review_*.md` reports and its overview still asserted
    claims the review had disproved. It is generated from the same pipeline as the doc pages now.
    """
    sections = []
    nav = []
    for page, label, md_name in DOC_PAGES:
        if not (HERE / md_name).exists():
            continue
        entries = [e for e in verdicts if e['doc'] == md_name]
        doc = render_doc(resolver, md_name, entries, report, cur_round=cur_round)
        slug = 'doc-' + re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')
        nav.append((slug, label, len(entries)))
        sections.append(f"""<section id="{slug}" class="mb-16 scroll-mt-20">
  <div class="flex items-baseline gap-3 flex-wrap border-b border-slate-700 pb-2 mb-4">
    <h1 class="text-xl font-bold text-slate-100">{html.escape(label)}</h1>
    <span class="text-[11px] text-slate-500 font-mono">{html.escape(md_name)}</span>
    <a href="{page}" class="ml-auto text-xs text-blue-400 hover:text-blue-300 no-underline">
      open as its own page &rarr;</a>
  </div>
  {doc['banner']}
  <article>{doc['body']}</article>
</section>""")

    for diag_id, title, svg in _load_diagrams():
        slug = 'onepage-' + diag_id
        nav.append((slug, title, 0))
        sections.append(f"""<section id="{slug}" class="mb-16 scroll-mt-20">
  <h1 class="text-xl font-bold text-slate-100 border-b border-slate-700 pb-2 mb-4">{html.escape(title)}</h1>
  <div class="rounded-lg p-3" style="background: var(--d-surface); border: 1px solid var(--d-line);">{svg}</div>
</section>""")

    nav_html = ''.join(
        f'<a href="#{slug}" class="block py-1 text-xs text-slate-300 no-underline '
        f'hover:text-emerald-300 truncate">{html.escape(label)}'
        + (f' <span class="text-amber-400">{n}</span>' if n else '')
        + '</a>'
        for slug, label, n in nav
    )
    snippets = resolver.snippets_json(sorted(resolver.refs))
    body = f"""
<div class="max-w-[100rem] mx-auto flex gap-6 px-4 py-6">
  <aside class="hidden xl:block w-64 shrink-0">
    <div class="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto pr-2 border-l border-slate-800 pl-3">
      <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
        {len(nav)} sections · amber = corrections</div>
      {nav_html}
    </div>
  </aside>
  <main class="min-w-0 flex-1 max-w-4xl">
    {ONEPAGE_INTRO.format(n_corrections=len(verdicts))}
    <hr class="border-slate-800 my-10">
    {''.join(sections)}
  </main>
</div>
{drawer_html()}
<script id="snips" type="application/json">{snippets}</script>
"""
    (HERE / 'all_docs_onepage.html').write_text(
        shell(f'Everything in one scroll — {PROJECT}', 'One-scroll view', body,
              extra_head=theme_shared.DIAGRAM_CSS, extra_js=DRAWER_JS),
        encoding='utf-8',
    )


def build_rounds_page(verdicts: list[dict], rounds: list[dict],
                      resolver: citations.Resolver | None = None) -> None:
    """Per-round changelog: what each harness pass added, flipped, or left alone.

    This is the "which is new, which is old" view. A claim not re-checked in the newest round keeps an
    older green, which is fine — it just means nobody looked again, and the date says so.
    """
    current = max((r['round'] for r in rounds), default=1)
    hook = None
    if resolver is not None:
        resolver.start_doc('rounds')
        hook = resolver.hook

    def prose(text: str) -> str:
        return md_render.render_inline(text, hook)

    sections = []
    for rnd in sorted(rounds, key=lambda r: -r['round']):
        n = rnd['round']
        touched = []
        for entry in verdicts:
            checks = sorted(entry.get('checks') or [],
                            key=lambda c: (c.get('round', 0), c.get('at', '')))
            hit = next((c for c in checks if c.get('round') == n), None)
            if hit is None:
                continue
            idx = checks.index(hit)
            prev = checks[idx - 1] if idx else None
            touched.append((entry, hit, prev))

        rows = []
        for entry, hit, prev in touched:
            colour, icon, _tip = VERDICT_STYLE[hit['verdict']]
            _b, text_cls, _bg = BADGE_COLORS[colour]
            p_icon, p_label = PROVENANCE_LABEL.get(hit.get('provenance', 'harness'),
                                                  PROVENANCE_LABEL['harness'])
            kind = ('first verdict' if prev is None else
                    f'was {prev["verdict"]} in round {prev.get("round", "?")}')
            where = (f'{entry["doc"]} &sect; {entry["match"]}' if entry['doc'] != PLAN_CSV
                     else f'plan row {entry["match"]}')
            rows.append(
                f'<tr><td class="border border-slate-800 px-2 py-1.5 text-xs font-bold {text_cls} '
                f'whitespace-nowrap">{hit["verdict"]}</td>'
                f'<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-500 '
                f'whitespace-nowrap">{kind}</td>'
                f'<td class="border border-slate-800 px-2 py-1.5 text-xs">'
                f'<a class="text-blue-400 no-underline hover:text-blue-300" '
                f'href="{doc_link(entry["doc"])}">{where}</a></td>'
                f'<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-200">'
                f'{prose(hit["now"][:260])}</td>'
                f'<td class="border border-slate-800 px-2 py-1.5 text-[11px] text-slate-500 '
                f'whitespace-nowrap">{p_icon} '
                f'{by_html(hit.get("by", ""), hit.get("source_url", ""))}</td></tr>'
            )
        reports = ', '.join(
            f'<a class="text-blue-400 no-underline hover:text-blue-300" href="{doc_link(r)}">'
            f'{html.escape(r.replace(".md", ""))}</a>' for r in rnd.get('reports', [])
        )
        badge = ('<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 '
                 'text-emerald-200">current</span>' if n == current else '')
        sections.append(f"""<section class="mb-10">
  <h2 class="text-base font-semibold text-emerald-300 mb-1 flex items-center gap-2 flex-wrap">
    Round {n} &middot; {html.escape(rnd['at'])} {badge}
    <span class="text-xs text-slate-500 font-normal">{len(touched)} checks</span></h2>
  <p class="text-xs text-slate-400 mb-1">{prose(rnd['trigger'])}</p>
  {f'<p class="text-[11px] text-slate-500 mb-3">Reports: {reports}</p>' if reports else ''}
  <div class="overflow-x-auto"><table class="w-full border border-slate-800 border-collapse">
  <thead><tr class="bg-slate-800/60 text-xs text-slate-300">
  <th class="border border-slate-800 px-2 py-1.5 text-left">verdict</th>
  <th class="border border-slate-800 px-2 py-1.5 text-left">change</th>
  <th class="border border-slate-800 px-2 py-1.5 text-left">where</th>
  <th class="border border-slate-800 px-2 py-1.5 text-left">current statement</th>
  <th class="border border-slate-800 px-2 py-1.5 text-left">source</th>
  </tr></thead><tbody>{''.join(rows)}</tbody></table></div>
</section>""")

    behind = [
        e for e in verdicts
        if latest_check(e).get('round', 0) < current
    ]
    behind_html = ''
    if behind:
        items = ''.join(
            f'<li><a class="text-blue-400 no-underline hover:text-blue-300" '
            f'href="{doc_link(e["doc"])}">{html.escape(e["doc"])} &sect; {html.escape(str(e["match"]))}</a>'
            f' — green is from round {latest_check(e).get("round")} '
            f'({html.escape(at_of(e))})</li>'
            for e in behind[:40]
        )
        behind_html = f"""<h2 class="text-base font-semibold text-amber-300 mt-8 mb-2">
  Not re-checked in round {current} ({len(behind)})</h2>
<p class="text-sm text-slate-400 mb-2">These keep an older green. Not wrong — just nobody looked again
this round, and the date on each says so.</p>
<ul class="list-disc pl-6 text-xs text-slate-300 space-y-1">{items}</ul>"""

    body = f"""<div class="max-w-6xl mx-auto px-4 py-8">
<h1 class="text-2xl font-bold text-slate-100">Rounds — what changed, and when</h1>
<p class="text-sm text-slate-300 mt-3 max-w-3xl leading-relaxed">Each harness pass is a
<strong class="text-slate-100">round</strong>. A round appends checks; it never edits or deletes an
earlier one, so the previous state of the document stays readable and dated. Newest round first.</p>
<p class="text-xs text-slate-400 mt-2 mb-6 max-w-3xl">Your own findings enter the same timeline with
&#128100;/&#128279; provenance, so what you brought and what the team concluded from it sit side by
side. See <a class="text-blue-400 no-underline hover:text-blue-300" href="how_to_read.html">how to
read</a> for the colour rules.</p>
{''.join(sections)}
{behind_html}
</div>
{drawer_html() if resolver is not None else ""}
<script id="snips" type="application/json">{resolver.snippets_json(sorted(resolver.used)) if resolver is not None else "{{}}"}</script>
"""
    (HERE / 'rounds.html').write_text(
        shell(f'Rounds — {PROJECT}', 'Rounds', body,
              extra_js=DRAWER_JS if resolver is not None else ''), encoding='utf-8')


def build_how_to_read(verdicts: list[dict]) -> None:
    """Explains the verdict states, the timestamps, and where history is and is not shown."""
    dates = sorted({e.get('claim_written', '') for e in verdicts} |
                   {at_of(e) for e in verdicts})
    dates = [d for d in dates if d]
    counts: dict[str, int] = {}
    for e in verdicts:
        counts[v_of(e)] = counts.get(v_of(e), 0) + 1
    proposed = sum(1 for e in verdicts
                   if latest_check(e).get('fix_state') == 'PROPOSED')

    rows = [
        ('&#128308;', 'red', 'WRONG', 'The claim was not true when it was written.',
         'Struck through, dated. The green layer below it is what is true.'),
        ('&#128993;', 'amber', 'STALE', 'True when written; the code or the scope has since moved.',
         'Struck through, dated. Read the green layer for the current position.'),
        ('&#128993;', 'amber', 'SCOPE', 'Superseded by a later scope decision, not by the code.',
         'The doc is not wrong about the code — it is answering a question we stopped asking.'),
        ('&#128994;', 'emerald', 'CONFIRMED', 'Re-verified against the current worktree.',
         'No strike-through. The claim and the current state are the same thing.'),
        ('&#128309;', 'blue', 'ADDED', 'Something true the doc never mentioned.',
         'No claim to strike. The green layer is new information.'),
    ]
    table = ''.join(
        f'<tr><td class="border border-slate-800 px-2 py-1.5 text-center">{dot}</td>'
        f'<td class="border border-slate-800 px-2 py-1.5 text-xs font-bold '
        f'{BADGE_COLORS[colour][1]}">{name}</td>'
        f'<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-200">{meaning}</td>'
        f'<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-400">{how}</td>'
        f'<td class="border border-slate-800 px-2 py-1.5 text-xs text-right">'
        f'{counts.get(name, 0)}</td></tr>'
        for dot, colour, name, meaning, how in rows
    )

    body = f"""<div class="max-w-4xl mx-auto px-4 py-8">
<h1 class="text-2xl font-bold text-slate-100">How to read these documents</h1>
<p class="text-sm text-slate-300 mt-3 leading-relaxed">These docs describe software we intend to
build, so parts of them are wrong on purpose — they were written before anyone read the code, and the
point is to find out where. Nothing is deleted when that happens. Each claim carries its own history,
with the date it was written and the date a harness run checked it.</p>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">The three layers</h2>
<p class="text-sm text-slate-300 mb-3">Every correction reads top to bottom in time order:</p>
<div class="border border-slate-800 rounded-lg p-3 my-3 space-y-2">
  <div class="border-l-2 border-red-500/40 bg-red-950/10 pl-3 py-1.5">
    <div class="text-[11px] text-red-300">&#128308; Wrong as written &middot; written 2026-07-29</div>
    <div class="text-xs text-slate-400 line-through decoration-slate-600/60">Identity is destroyed by
    design, because ItemKey merges items sharing (transform-id, colour).</div>
  </div>
  <div class="border-l-2 border-emerald-500/50 bg-emerald-950/10 pl-3 py-1.5">
    <div class="text-[11px] text-emerald-300">&#128994; Current &middot; as of 2026-07-30
      <span class="text-[10px] px-1 py-0.5 rounded border border-emerald-500/40">verified</span></div>
    <div class="text-xs text-slate-200">Inverted — identity rides in the colour of parallel pick items
    and survives <em>because</em> every pick colour is unique, so ItemKey cannot merge them.</div>
  </div>
  <div class="text-[11px] text-slate-400">&#127919; Target &mdash; a first-class element id on the
  visible items, so identity supports addressability and not just read-out.</div>
</div>
<ul class="list-disc pl-6 text-sm text-slate-300 space-y-1.5 my-3">
  <li><strong class="text-slate-100">Red or amber is history.</strong> Struck through, kept so you can
  see what we believed and stop yourself re-deriving it.</li>
  <li><strong class="text-emerald-300">Green is the current state — that is what to implement.</strong>
  It carries the date it was verified and whether it is a verified fact or still a proposal.</li>
  <li><strong class="text-slate-100">Target is the exit condition</strong> — what has to be true before
  the correction disappears entirely.</li>
</ul>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">Green is current, not permanent</h2>
<p class="text-sm text-slate-300 leading-relaxed">A green statement is the newest verified answer, and
it can go amber or red on the next run — that is normal and expected, because the code keeps moving.
What makes it safe to rely on is the timestamp: <code class="text-emerald-300">as of &lt;date&gt;</code>
tells you which harness pass produced it. If the code has changed since, re-run the harness rather than
trusting the colour.</p>
<p class="text-sm text-slate-400 mt-2">Dates in play right now: {' &rarr; '.join(dates)}. Of
{len(verdicts)} corrections, {len(verdicts) - proposed} state verified facts and {proposed} {'describes' if proposed == 1 else 'describe'}
work not yet done.</p>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">The states</h2>
<div class="overflow-x-auto"><table class="w-full border border-slate-800 border-collapse">
<thead><tr class="bg-slate-800/60">
<th class="border border-slate-800 px-2 py-1.5 text-xs"></th>
<th class="border border-slate-800 px-2 py-1.5 text-xs text-left">state</th>
<th class="border border-slate-800 px-2 py-1.5 text-xs text-left">meaning</th>
<th class="border border-slate-800 px-2 py-1.5 text-xs text-left">how it renders</th>
<th class="border border-slate-800 px-2 py-1.5 text-xs text-right">now</th>
</tr></thead><tbody>{table}</tbody></table></div>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">History is for text only</h2>
<p class="text-sm text-slate-300 leading-relaxed">Prose carries all three layers. <strong
class="text-slate-100">Diagrams, the capability explainers, the plan table and the discussion pages
show only the newest confirmed state</strong> — no superseded variants, so there is nothing to
mis-implement from a picture. Each of those pages is stamped with the date it reflects; if you want to
know how it used to look, the text is where that lives.</p>

<h2 class="text-lg font-semibold text-emerald-300 mt-8 mb-2">Reading it as markdown</h2>
<p class="text-sm text-slate-300 leading-relaxed">The same three layers are written into
<code class="text-emerald-300">annotated/&lt;doc&gt;.md</code> using
:red_circle: / :yellow_circle: / :green_circle: marks, for reading in an editor, a diff or a terminal.
The originals in the workspace root are never edited — they are the record of what we believed and
when.</p>
</div>"""
    (HERE / 'how_to_read.html').write_text(
        shell(f'How to read these documents — {PROJECT}', 'How to read', body),
        encoding='utf-8')


def build_plan_table(stamp: str = '', verdicts: list[dict] | None = None,
                     resolver: citations.Resolver | None = None) -> list[dict]:
    # Optional: a project without a step plan simply has no plan page, and the hub drops the card.
    plan_path = HERE / PLAN_CSV
    if not plan_path.exists():
        print(f'  no {PLAN_CSV} — skipping the plan table')
        return []
    rows = list(csv.DictReader(plan_path.read_text(encoding='utf-8').splitlines()))
    caps = {p.name[len('cap_'):len('cap_') + 2]: p.name for p in HERE.glob('cap_*.html')}
    # The current-position column is prose about code, so it gets the same live citations as any
    # doc page — otherwise the one table people plan from is where `file:line` is dead text.
    hook = None
    if resolver is not None:
        resolver.start_doc(PLAN_CSV)
        hook = resolver.hook

    def prose(text: str) -> str:
        return md_render.render_inline(text, hook)

    # Rows show their newest confirmed position only — no superseded advice.
    by_step: dict[str, list[dict]] = {}
    for entry in (verdicts or []):
        if entry['doc'] == PLAN_CSV:
            by_step.setdefault(str(entry['match']).strip(), []).append(entry)
    trs = []
    for row in rows:
        step = row['Step'].zfill(2)
        viz = caps.get(step)
        if step == '05':
            viz = 'render_pipeline_audit_optimization_visualizer.html'
        viz_html = (
            f'<a class="text-blue-400 hover:text-blue-300 no-underline" href="{viz}">explainer &rarr;</a>'
            if viz else '<span class="text-slate-600">—</span>'
        )
        row_verdicts = by_step.get(row['Step'].strip(), [])
        if row_verdicts:
            now_html = ''.join(
                '<div class="mb-1.5 last:mb-0">'
                f'<span class="text-emerald-300">&#128994;</span> '
                f'{prose(now_of(v))}'
                + (f'<div class="text-[11px] text-slate-500 mt-0.5">&#127919; '
                   f'{prose(v["target"])}</div>' if v.get('target') else '')
                + '</div>'
                for v in row_verdicts
            )
            # Only strike advice that was actually retracted. A CONFIRMED row's tech is still the
            # recommendation, and striking it would read as "do not use this".
            retracted = any(v_of(v) in ('WRONG', 'STALE', 'SCOPE') for v in row_verdicts)
            tech_cls = ('text-slate-500 line-through decoration-slate-600/60' if retracted
                        else 'text-slate-300')
        else:
            now_html = '<span class="text-slate-600">&mdash;</span>'
            tech_cls = 'text-slate-400'
        trs.append(f"""<tr>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-500 whitespace-nowrap">{html.escape(row['Phase'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-right">{html.escape(row['Step'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-100">{html.escape(row['Task'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-400 align-top min-w-[14rem] break-words">{html.escape(row['Description'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs">{html.escape(row['Priority'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs">{html.escape(row['Effort'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs {tech_cls} align-top break-words">{html.escape(row['Key Tech'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-200 align-top min-w-[22rem] break-words">{now_html}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs text-slate-400 align-top break-words">{html.escape(row['Success Metric'])}</td>
<td class="border border-slate-800 px-2 py-1.5 text-xs whitespace-nowrap">{viz_html}</td>
</tr>""")
    # Only link the audit doc if this project has one — a scaffolded site does not yet.
    status_link = (
        ' Status per row lives in <a class="text-blue-400 no-underline hover:text-blue-300" '
        'href="doc_01_gap.html#2-capability-audit-against-the-plan-csv-step-status">doc 01 &sect;2</a>.'
        if (HERE / 'doc_01_gap.html').exists() else ''
    )
    head = ''.join(
        f'<th class="border border-slate-800 bg-slate-800/60 px-2 py-1.5 text-left text-xs '
        f'text-slate-200">{h}</th>'
        for h in ['Phase', '#', 'Task', 'Description', 'Pri', 'Effort',
                  'Key tech as written', 'Now — current position', 'Success metric', 'Explainer']
    )
    body = f"""<div class="max-w-[100rem] mx-auto px-4 py-8">
<h1 class="text-2xl font-bold text-slate-100">The 17-step plan</h1>
<p class="text-sm text-slate-400 mt-2 max-w-3xl">Source of record:
<code class="text-emerald-300">{PLAN_CSV}</code>.{status_link}
</p>
<div class="flex items-start gap-2 my-4 text-xs border border-emerald-500/40 bg-emerald-950/10
  rounded-lg px-3 py-2">
  <span class="text-emerald-300 whitespace-nowrap">&#128994; Current as of __STAMP__</span>
  <span class="text-slate-400">— the <em>Now</em> column is the newest confirmed position per row; no
  superseded advice is shown. Doc 05 &sect;5 retired the semantic rows (2, 3, 4, 16) under the
  rendering-limits scope. Full history per row is in the
  <a class="text-blue-400 no-underline hover:text-blue-300" href="corrections.html">corrections</a>.</span>
</div>
<div class="overflow-x-auto mt-6"><table class="w-full border border-slate-800 border-collapse">
<thead><tr>{head}</tr></thead><tbody>{''.join(trs)}</tbody></table></div>
</div>
{drawer_html() if resolver is not None else ""}
<script id="snips" type="application/json">{resolver.snippets_json(sorted(resolver.used)) if resolver is not None else "{{}}"}</script>
"""
    (HERE / 'plan_table.html').write_text(
        shell(f'The plan — {PROJECT}', 'Plan', body.replace('__STAMP__', stamp),
              extra_js=DRAWER_JS if resolver is not None else ''), encoding='utf-8')
    return rows


# --------------------------------------------------------------------------- hub
def build_hub(doc_pages: list[dict], code_pages: list[dict], verdicts: list[dict],
              plan_rows: list[dict], resolver: citations.Resolver) -> None:
    reading_path = [
        ('how_to_read.html', 'How to read these documents — red, amber, green',
         'Claims carry their history: struck-through when wrong or stale, green for the current state, with the date each was checked. Two minutes, and the rest of the site makes sense.'),
        ('doc_summary.html', 'Start here — what BIM is and why loading LESS is the whole trick',
         'The research conclusions, no code.'),
        ('doc_faq.html', 'Misconceptions & FAQ',
         'Thirteen myths, including the "2 GB limit" one that keeps coming back.'),
        ('plan_table.html', 'The 17-step plan',
         'What we set out to build, with an interactive explainer per row.'),
        ('doc_08_review_stack.html', 'Why the plan names so much external software',
         'The tech-stack question answered row by row: 6 of 17 rows name tech already in the crate or that would replace it. Includes the root cause, with dates.'),
        ('doc_01_gap.html', '01 — Gap map: plan vs. the crate we actually have',
         'Row-by-row status with every claim anchored to real code. Read the corrections banner first.'),
        ('doc_02_semantic.html', '02 — Semantic layer design',
         'How identity gets from HUI to the browser. Implemented on this branch.'),
        ('doc_03_large_model.html', '03 — Large models',
         'Two corrections that changed the order of work: bundles do not save draw calls, and '
         'instancing is not WebGPU-gated.'),
        ('doc_04_tickets.html', '04 — Jira journey & the tickets to create',
         'AKS-18576 epic history, AKS-18641 review, S1–S9 / P1–P9 / B1–B12.'),
        ('doc_05_benchmark.html', '05 — Benchmark design & the real limits',
         'The 100 GB question with numbers, and the scope change to rendering limits only.'),
        ('doc_06_instancing.html', '06 — Instancing & merging',
         'Proposed code for the biggest draw-call win, with the payoff measurement first.'),
        ('all_docs_onepage.html', 'Or read the whole set in one scroll',
         'All 12 docs, every correction and all four diagrams on a single page — same content, no '
         'navigation. Good for reading end to end, printing, or Ctrl+F over everything.'),
    ]
    review_pages = [p for p in doc_pages if p['md'].startswith('07_')]

    def card(href: str, title: str, sub: str, badge: str = '') -> str:
        return f"""<a href="{href}" class="block border border-slate-800 rounded-lg p-3.5 no-underline
 hover:border-emerald-500/50 hover:bg-slate-900/60 transition">
  <div class="flex items-start gap-2">
    <div class="min-w-0">
      <div class="text-sm font-semibold text-slate-100">{title}</div>
      <div class="text-xs text-slate-400 mt-1 leading-relaxed">{sub}</div>
    </div>
    {badge}
  </div></a>"""

    verdict_counts: dict[str, int] = {}
    for entry in verdicts:
        verdict_counts[v_of(entry)] = verdict_counts.get(v_of(entry), 0) + 1
    wrong = verdict_counts.get('WRONG', 0)
    stale = verdict_counts.get('STALE', 0)

    path_cards = []
    # Drop cards whose page was not generated (no plan CSV, a doc still to be written, and so on) —
    # a hub that links to a missing page is the failure this whole build is meant to prevent.
    reading_path = [row for row in reading_path if (HERE / row[0]).exists()]
    for href, title, sub in reading_path:
        n = sum(1 for e in verdicts if doc_link(e['doc']) == href)
        badge = (
            f'<span class="ml-auto shrink-0 text-[11px] px-1.5 py-0.5 rounded border '
            f'border-amber-500/40 text-amber-300">{n} corr.</span>' if n else ''
        )
        path_cards.append(card(href, title, sub, badge))

    gallery_cards = ''.join(
        card(page, html.escape(label.split('—')[0].strip()), html.escape(label))
        for page, label in VISUALIZER_PAGES if (HERE / page).exists()
    )
    review_cards = ''.join(
        card(p['page'], html.escape(p['label']),
             f'{p["n_cites"]} code citations · verified against wgpu-pick-wt')
        for p in review_pages
    )
    top_code = sorted(code_pages, key=lambda p: -p['n_cited'])[:12]
    code_cards = ''.join(
        f'<a href="{p["page"]}" class="block border border-slate-800 rounded px-2.5 py-1.5 '
        f'no-underline hover:border-emerald-500/50 text-xs">'
        f'<span class="font-mono text-slate-200">{html.escape(p["file"].rsplit("/", 1)[-1])}</span>'
        f'<span class="text-slate-600"> {p["n_lines"]} ln</span>'
        f'<span class="text-emerald-400 float-right">{p["n_cited"]}&times;</span></a>'
        for p in top_code
    )

    search_rows = []
    for p in doc_pages:
        for _level, text, slug in p['headings']:
            search_rows.append({'t': text, 'u': f'{p["page"]}#{slug}', 'k': p['label']})
    for rel, meta in resolver.files.items():
        page = citations.page_slug(rel)
        base = rel.rsplit('/', 1)[-1]
        for it in meta['items']:
            search_rows.append({
                't': f'{it["symbol"]}  ({base}:{it["line_start"]})',
                'u': f'{page}#{citations.anchor(it["symbol"], it["line_start"])}',
                'k': it['kind'],
            })
    search_json = json.dumps(search_rows).replace('</script>', '<\\/script>')

    body = f"""<div class="max-w-6xl mx-auto px-4 py-8">
<h1 class="text-3xl font-bold text-slate-100">{html.escape(SITE.get('hub_title', 'Web-based BIM viewer — research, audit, and the code'))}</h1>
<p class="text-sm text-slate-300 mt-3 max-w-3xl leading-relaxed">{SITE.get('hub_intro', '''Everything we learned building
toward a VCAD/Frame-class web BIM viewer, checked line by line against the renderer we actually
have (<code class="text-emerald-300">tools/wgpu_renderer</code>, Rust + wgpu 27 + WGSL, WebGL2 in
the browser).''')} Every <code class="text-sky-300">file:line</code> in these docs is a live link: click
it and the real function opens, doc comment included, resolved by symbol so it survives line
drift.</p>

<div class="mt-5 relative max-w-2xl">
  <input id="site-search" type="search" autocomplete="off"
    placeholder="Search headings and {sum(len(m['items']) for m in resolver.files.values())} code symbols…"
    class="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-100">
  <div id="search-out" class="hidden absolute left-0 right-0 mt-1 max-h-80 overflow-y-auto
    bg-slate-900 border border-slate-700 rounded-lg z-50 shadow-2xl"></div>
</div>

<div class="mt-6 border border-amber-500/40 bg-amber-950/10 rounded-lg p-4">
  <div class="flex items-center gap-2">
    <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-300"></i>
    <span class="text-sm font-semibold text-amber-200">Read the corrections before trusting a doc</span>
    <a href="corrections.html" class="ml-auto text-xs text-amber-300 hover:text-amber-200 no-underline">
      all {len(verdicts)} &rarr;</a>
  </div>
  <p class="text-xs text-slate-300 mt-2 leading-relaxed">A four-agent harness review on 2026-07-30
  re-checked these docs against this worktree and filed {len(verdicts)} corrections, of which
  <strong class="text-red-300">{wrong} say a doc claim is wrong</strong> and
  <strong class="text-amber-300">{stale} say it has gone stale</strong>. The docs are kept
  as written — corrections appear as badges next to the section they fix. The two that matter most:
  the <em>categorical colour path</em> the docs call free needs real shader work, and the
  <em>"identity is destroyed by design"</em> finding is inverted — identity survives precisely
  because of the dedup key the audit blamed.</p>
</div>

<h2 class="text-lg font-semibold text-emerald-300 mt-9 mb-3">Reading path</h2>
<div class="grid md:grid-cols-2 gap-3">{''.join(path_cards)}</div>

<h2 class="text-lg font-semibold text-emerald-300 mt-9 mb-3">Verification reports</h2>
<p class="text-xs text-slate-400 mb-3 max-w-3xl">Four specialists from the
<code class="text-emerald-300">.agent/</code> harness — explorer (identity), systems (GPU), web
(loader/WASM), QA (build + docs). Across every claim they re-checked: 77 confirmed, 12 stale,
4 wrong, 5 unverifiable, 14 new findings. Native and wasm32 builds pass, 26 tests pass,
<code>clippy -D warnings</code> fails with 79 errors (77 pre-existing).</p>
<div class="grid md:grid-cols-2 gap-3">{review_cards}</div>

<h2 class="text-lg font-semibold text-emerald-300 mt-9 mb-3">Interactive explainers</h2>
<p class="text-xs text-slate-400 mb-3 max-w-3xl">&#128994; Current state only — diagrams and
explainers never show a superseded version, so anything you build from them is the live design.
Layered history (red / amber / green with timestamps) is in the text docs and on
<a class="text-blue-400 no-underline hover:text-blue-300" href="how_to_read.html">how to read</a>.</p>
<div class="grid md:grid-cols-3 gap-3">{gallery_cards}</div>

<h2 class="text-lg font-semibold text-emerald-300 mt-9 mb-3">Code atlas</h2>
<p class="text-xs text-slate-400 mb-3 max-w-3xl">{len(code_pages)} source files,
{sum(p['n_items'] for p in code_pages)} items extracted with their doc comments.
Most-cited first — <a class="text-blue-400 no-underline hover:text-blue-300" href="code_atlas.html">
full index &rarr;</a></p>
<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{code_cards}</div>

<h2 class="text-lg font-semibold text-emerald-300 mt-9 mb-3">How this site is built</h2>
<div class="text-xs text-slate-400 space-y-1.5 max-w-3xl leading-relaxed">
<p><code class="text-emerald-300">python build_site.py</code> is the only command. It runs
<code>build_html.py</code> and <code>build_capability_visualizers.py</code>, then generates the doc
pages, the code atlas, this hub, and injects the shared nav into every page.</p>
<p><code class="text-emerald-300">code_index.py</code> extracts each cited item plus its doc
comment. <code class="text-emerald-300">citations.py</code> resolves
<code>file.rs:123</code> to an item by name first, line second, and reports anything it had to
guess — the docs' line numbers came from a different worktree, so a
<span class="text-amber-300">~</span> on a citation means it was re-anchored.
<code class="text-emerald-300">verdicts.json</code> holds the corrections; a heading rename fails
the build instead of orphaning one.</p>
<p>Markdown stays canonical. Nothing here is hand-edited HTML except
<code>render_pipeline_audit_optimization_visualizer.html</code>.</p>
</div>
</div>
<script id="search-data" type="application/json">{search_json}</script>
"""
    search_js = r"""
(function () {
  const data = JSON.parse(document.getElementById('search-data').textContent);
  const box = document.getElementById('site-search');
  const out = document.getElementById('search-out');
  function esc(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]); }
  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    if (q.length < 2) { out.classList.add('hidden'); return; }
    const hits = data.filter(r => r.t.toLowerCase().includes(q)).slice(0, 60);
    out.innerHTML = hits.length
      ? hits.map(r => '<a href="' + r.u + '" class="block px-3 py-1.5 text-xs no-underline ' +
          'hover:bg-slate-800 border-b border-slate-800/60"><span class="text-slate-100">' +
          esc(r.t) + '</span><span class="text-slate-500 float-right ml-3">' + esc(r.k) +
          '</span></a>').join('')
      : '<div class="px-3 py-2 text-xs text-slate-500">no match</div>';
    out.classList.remove('hidden');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#site-search') && !e.target.closest('#search-out')) out.classList.add('hidden');
  });
})();
"""
    (HERE / 'index.html').write_text(
        shell(f'{PROJECT} — hub', 'Hub', body, extra_js=search_js), encoding='utf-8')


# --------------------------------------------------------------------------- link check
HREF = re.compile(r'(?:href|src)="([^"]+)"')
ID_ATTR = re.compile(r'\sid="([^"]+)"')


def check_links() -> list[str]:
    """Verifies every local href/src resolves, fragments included. Anchors rot silently otherwise."""
    ids: dict[str, set[str]] = {}
    for path in HERE.glob('*.html'):
        ids[path.name] = set(ID_ATTR.findall(path.read_text(encoding='utf-8')))
    problems: list[str] = []
    for path in sorted(HERE.glob('*.html')):
        text = path.read_text(encoding='utf-8')
        for raw in set(HREF.findall(text)):
            if raw.startswith(('http://', 'https://', 'mailto:', 'data:', '//', '$')):
                continue
            # `href="' + r.u + '"` inside an inline script is a template, not a link.
            if any(ch in raw for ch in "'+${"):
                continue
            target, _, frag = raw.partition('#')
            if not target:
                if frag and frag not in ids[path.name]:
                    problems.append(f'  {path.name}: no such anchor #{frag}')
                continue
            if not (HERE / target).exists():
                problems.append(f'  {path.name}: missing target {target}')
            elif frag and target.endswith('.html') and frag not in ids.get(target, set()):
                problems.append(f'  {path.name}: {target} has no anchor #{frag}')
    return problems


# --------------------------------------------------------------------------- main
def main() -> None:
    report: list[str] = []
    run_subs = '--no-subs' not in sys.argv

    PLANNED_PAGES.update({'corrections.html', 'code_atlas.html', 'all_docs_onepage.html',
                          'how_to_read.html', 'rounds.html'})
    if _load_diagrams():
        PLANNED_PAGES.add('diagrams.html')
    for page, _label in VISUALIZER_PAGES:
        if (HERE / page).exists():
            PLANNED_PAGES.add(page)

    if run_subs:
        # `build_html.py` is no longer run: it is imported for its SVG diagrams, and the one-scroll
        # page it used to emit is built here from the same pipeline as the doc pages.
        print('running capability-visualizer generator…')
        runpy.run_path(str(HERE / 'build_capability_visualizers.py'), run_name='__main__')

    verdicts_doc = json.loads((HERE / 'verdicts.json').read_text(encoding='utf-8'))
    verdict_data = verdicts_doc['entries']
    rounds = verdicts_doc.get('rounds', [{'round': 1, 'at': '', 'trigger': ''}])
    cur_round = max((r['round'] for r in rounds), default=1)
    resolver = citations.Resolver()
    resolver.cite_pages = {}

    print('building doc pages…')
    doc_pages = []
    for page, label, md_name in DOC_PAGES:
        if not (HERE / md_name).exists():
            report.append(f'  !! missing markdown: {md_name}')
            continue
        entries = [e for e in verdict_data if e['doc'] == md_name]
        info = build_doc_page(resolver, page, label, md_name, entries, report, cur_round)
        resolver.cite_pages[md_name] = set(resolver.used)
        doc_pages.append(info)
        print(f'  {page}: {info["n_cites"]} citations, {info["n_cards"]} verdict cards')

    print('building code atlas…')
    code_pages = build_code_pages(resolver, report)
    build_atlas_index(code_pages)
    print(f'  {len(code_pages)} code pages')

    build_corrections(verdict_data, {p['md']: p['anchors'] for p in doc_pages}, resolver)
    stamp = current_stamp(verdict_data)
    build_diagrams_page(stamp)
    build_onepage(resolver, verdict_data, report, cur_round)
    build_rounds_page(verdict_data, rounds, resolver)
    build_how_to_read(verdict_data)
    n_annotated = build_annotated_markdown(verdict_data, report)
    print(f'  {n_annotated} annotated markdown copies in annotated/')
    plan_rows = build_plan_table(stamp, verdict_data, resolver)
    build_hub(doc_pages, code_pages, verdict_data, plan_rows, resolver)

    print('injecting nav…')
    n_nav = 0
    for path in sorted(HERE.glob('*.html')):
        if path.name == 'index.html':
            continue
        if inject_nav(path):
            n_nav += 1
    print(f'  {n_nav} pages')

    print('checking links…')
    broken = check_links()
    print(f'  {"OK — every local link and anchor resolves" if not broken else str(len(broken)) + " BROKEN"}')
    for line in broken[:40]:
        print(line)

    print()
    print(resolver.report())
    if report:
        print('\nWARNINGS:')
        print('\n'.join(report))
    total = sum(p.stat().st_size for p in HERE.glob('*.html'))
    print(f'\n{len(list(HERE.glob("*.html")))} html pages, {round(total / 1024 / 1024, 1)} MB total')


if __name__ == '__main__':
    main()
