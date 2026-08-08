# Copyright (C) 2026 Akselos
"""Turns every `file.rs:123` in the docs into a link to the real code.

Resolution is **by enclosing symbol, not by raw line number**, because the audit docs were written
against a different worktree (`akselos-dev-2`) and every insertion since has shifted their line
numbers. Three signals are used, in order of trust:

1. an explicit entry in `citation_overrides.json` (measured drift, e.g. `worker.py:21-217` -> `:169-223`);
2. a symbol named in the surrounding prose (`create_buffer_init` (`render_list.rs:336`)) — the docs
   almost always name what they point at, and a name survives line drift;
3. the line number itself, resolved to the innermost item whose span contains it.

Anything that resolves only by signal 3 *and* lands in a differently-named item than the prose
suggests is reported as drift rather than silently rendered — silent drift is exactly how the
current docs ended up citing `web_app.rs:281` for something that lives at `:311`.
"""

from __future__ import annotations

import collections
import html
import json
import pathlib
import re
import typing as tp

HERE = pathlib.Path(__file__).resolve().parent

# `path/to/file.ext:12`, `file.ext:12-34`, `file.ext:12,34`, and bare `:12` continuations.
CITE = re.compile(
    r'(?P<path>(?:[\w./-]+/)?(?P<base>[\w.-]+\.(?:rs|py|ts|tsx|toml|wgsl|json|md|d\.ts)))'
    r':(?P<lines>\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)'
    r'|(?<![\w:])(?P<bare>:(?P<blines>\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*))(?![\w:])'
)
IDENT = re.compile(r'\b[A-Za-z_][A-Za-z0-9_]{3,}\b')
CONTAINERS = {'impl', 'mod', 'class', 'table'}


class Ref(tp.TypedDict):
    key: str
    file: str
    basename: str
    symbol: str
    kind: str
    lang: str
    line_start: int
    line_end: int
    # Where the *item* starts, which is what the atlas anchor is built from. Differs from
    # `line_start` when the snippet was widened to cover a multi-item citation range.
    anchor_line: int
    cited_start: int
    cited_end: int
    doc: str
    code: str
    resolved_by: str
    # True when the item was too long to show whole and the snippet is a window around the citation.
    windowed: bool
    item_start: int
    item_end: int


def page_slug(rel_path: str) -> str:
    """Repo-relative source path -> code atlas page name."""
    return 'code_' + re.sub(r'[^a-z0-9]+', '_', rel_path.lower()).strip('_') + '.html'


def anchor(symbol: str, line_start: int) -> str:
    return 'sym-' + re.sub(r'[^a-z0-9]+', '-', symbol.lower()).strip('-') + f'-{line_start}'


class Resolver:
    def __init__(self, index_path: pathlib.Path | None = None) -> None:
        index_path = index_path or HERE / 'code_index.json'
        self.index = json.loads(index_path.read_text(encoding='utf-8'))
        self.files: dict[str, dict] = self.index['files']
        self.by_base: dict[str, list[str]] = collections.defaultdict(list)
        for rel in self.files:
            self.by_base[rel.rsplit('/', 1)[-1]].append(rel)
        overrides_path = HERE / 'citation_overrides.json'
        self.overrides: dict[str, str] = (
            json.loads(overrides_path.read_text(encoding='utf-8'))['line_overrides']
            if overrides_path.exists() else {}
        )
        self.last_file: str | None = None
        # Bare `:123` attaches to the last file named — but the docs sometimes name a second file
        # mid-sentence (`Cargo.toml:14`) and then continue citing the first one. Keeping a short
        # history lets an out-of-range continuation fall back to a file the line can exist in.
        self.file_history: collections.deque[str] = collections.deque(maxlen=6)
        self.recent_idents: collections.deque[str] = collections.deque(maxlen=14)
        self.refs: dict[str, Ref] = {}
        self.used: set[str] = set()
        # doc markdown name -> the citation keys that doc used, for "cited by" backlinks.
        self.cite_pages: dict[str, set[str]] = {}
        self.unresolved: collections.Counter[str] = collections.Counter()
        self.drifted: list[tuple[str, str, int, str, int]] = []
        self.out_of_range: list[tuple[str, str, int]] = []
        self.recovered: list[tuple[str, str, str, str]] = []
        self.doc_id = ''

    # ---- per-document state -------------------------------------------------
    def start_doc(self, doc_id: str) -> None:
        self.doc_id = doc_id
        self.last_file = None
        self.file_history.clear()
        self.recent_idents.clear()
        self.used = set()

    # ---- resolution ---------------------------------------------------------
    def _pick_file(self, path: str, base: str) -> str | None:
        candidates = self.by_base.get(base, [])
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        for rel in candidates:
            if rel.endswith(path):
                return rel
        return candidates[0]

    def _item_for(self, rel: str, line: int) -> tuple[dict | None, str]:
        items = self.files[rel]['items']
        hint_names = {i.lower() for i in self.recent_idents}
        by_symbol = [
            it for it in items
            if it['symbol'].split('::')[-1].split('.')[-1].lower() in hint_names
        ]
        containing = [it for it in items if it['line_start'] <= line <= it['line_end']]
        # Smallest first, and never let a container (`impl`, `class`) win over something inside it —
        # `impl GraphicsWindow` contains every line of the file's main type, so it "matches"
        # everything and explains nothing.
        containing.sort(key=lambda it: (it['kind'] in CONTAINERS, it['line_end'] - it['line_start']))
        if containing:
            hinted = containing[0]['symbol'].split('::')[-1].split('.')[-1].lower() in hint_names
            return containing[0], 'symbol+line' if hinted else 'line'
        if by_symbol:
            by_symbol.sort(key=lambda it: abs(it['line_start'] - line))
            return by_symbol[0], 'symbol'
        if items:
            nearest = min(items, key=lambda it: abs(it['line_start'] - line))
            return nearest, 'nearest'
        return None, 'none'

    # A citation like `render_list.rs:432-457` spans a struct *and* the impl that gives it meaning.
    # Showing only the first item would hide the point of the citation, so the snippet grows to
    # cover the whole cited range — up to this many lines, past which the doc is pointing at a
    # region rather than an item and the atlas page is the better answer.
    MAX_SPAN = 260
    # Above this, the snippet is trimmed to a window around the cited lines.
    MAX_WINDOW = 130

    def _make_ref(self, rel: str, start: int, end: int) -> Ref | None:
        item, how = self._item_for(rel, start)
        if item is None:
            return None
        meta = self.files[rel]
        span_start = min(item['line_start'], start)
        span_end = max(item['line_end'], end if end - span_start < self.MAX_SPAN else item['line_end'])
        # Grow the end so a partially-covered *sibling* isn't cut in half. Never grow to an
        # enclosing item: an `impl` block is 300 lines and would bury the 17 the doc asked about.
        for other in meta['items']:
            if (
                span_start <= other['line_start'] <= span_end < other['line_end']
                and other['line_end'] - span_start <= self.MAX_SPAN
            ):
                span_end = other['line_end']
        span_end = min(span_end, meta['n_lines'])
        # A 250-line function shown whole buries the one line the doc is talking about. Trim to a
        # window around the citation; the atlas page still has the item in full.
        windowed = False
        if span_end - span_start + 1 > self.MAX_WINDOW and end - start < self.MAX_WINDOW // 2:
            windowed = True
            span_start = max(span_start, start - 12)
            span_end = min(span_end, max(end, start) + 36)
        source_lines = meta['source'].split('\n')
        key = f'{rel}#{item["symbol"]}@{item["line_start"]}'
        ref = Ref(
            key=key,
            file=rel,
            basename=meta['basename'],
            symbol=item['symbol'],
            kind=item['kind'],
            lang=meta['lang'],
            line_start=span_start,
            line_end=span_end,
            anchor_line=item['line_start'],
            cited_start=start,
            cited_end=end,
            doc=item['doc'],
            code='\n'.join(source_lines[span_start - 1 : span_end]),
            resolved_by=how,
            windowed=windowed,
            item_start=item['line_start'],
            item_end=item['line_end'],
        )
        self.refs.setdefault(key, ref)
        self.used.add(key)
        if how in ('nearest', 'symbol'):
            self.drifted.append((self.doc_id, rel, start, item['symbol'], item['line_start']))
        return ref

    # ---- the md_render hook -------------------------------------------------
    def hook(self, text: str, in_code: bool = False) -> str:
        """Escapes `text` and replaces citations with links. Fed raw text by `md_render`.

        `in_code` is True for the inside of a backtick span. Bare `:123` continuations are only
        honoured there — in running prose a colon-number is far more likely to be a ratio, a time or
        a section number than a line reference.
        """
        for ident in IDENT.findall(text):
            if not CITE.search(ident):
                self.recent_idents.append(ident)
        out: list[str] = []
        pos = 0
        for m in CITE.finditer(text):
            out.append(html.escape(text[pos : m.start()]))
            out.append(self._render_cite(m, in_code))
            pos = m.end()
        out.append(html.escape(text[pos:]))
        return ''.join(out)

    def _render_cite(self, m: re.Match[str], in_code: bool) -> str:
        raw = m.group(0)
        if m.group('path'):
            rel = self._pick_file(m.group('path'), m.group('base'))
            spec = m.group('lines')
            if rel is None:
                self.unresolved[m.group('base')] += 1
                # Critical: forget the previous file. Otherwise a following bare `:12` attaches to
                # whatever was cited last, which is how `pkg/wgpu_renderer.d.ts:8,10,16,17` ended up
                # pointing into WgpuRenderer.tsx.
                self.last_file = None
                return f'<span class="cite-dead" title="not in the code index">{html.escape(raw)}</span>'
            self.last_file = rel
            if rel in self.file_history:
                self.file_history.remove(rel)
            self.file_history.append(rel)
            label_prefix = m.group('path')
        else:
            if not in_code:
                return html.escape(raw)
            rel = self.last_file
            spec = m.group('blines')
            if rel is None:
                return html.escape(raw)
            first_line = int(re.split(r'\s*[-,]\s*', spec)[0])
            if first_line > self.files[rel]['n_lines']:
                recovered = next(
                    (r for r in reversed(self.file_history) if first_line <= self.files[r]['n_lines']),
                    None,
                )
                if recovered is not None:
                    self.recovered.append((self.doc_id, spec, rel, recovered))
                    rel = recovered
            label_prefix = ''

        links: list[str] = []
        for part in spec.split(','):
            part = part.strip()
            bounds = [int(x) for x in re.split(r'\s*-\s*', part)]
            start = bounds[0]
            end = bounds[-1]
            override = self.overrides.get(f'{self.files[rel]["basename"]}:{part}')
            if override:
                bounds = [int(x) for x in re.split(r'\s*-\s*', override)]
                start, end = bounds[0], bounds[-1]
            if start > self.files[rel]['n_lines']:
                # Past the end of the file: the doc's number cannot be trusted at all, so link the
                # file rather than invent an anchor inside it.
                self.out_of_range.append((self.doc_id, rel, start))
                links.append(
                    f'<a class="cite cite-drift" href="{page_slug(rel)}" title="'
                    f'{self.files[rel]["basename"]} has only {self.files[rel]["n_lines"]} lines — '
                    f'line number is stale, opening the file">{html.escape(part)}</a>'
                )
                continue
            ref = self._make_ref(rel, start, end)
            if ref is None:
                links.append(html.escape(part))
                continue
            href = f'{page_slug(rel)}#{anchor(ref["symbol"], ref["anchor_line"])}'
            drift = ' cite-drift' if ref['resolved_by'] in ('nearest', 'symbol') else ''
            tip = f'{ref["kind"]} {ref["symbol"]} — {ref["basename"]}:{ref["line_start"]}-{ref["line_end"]}'
            links.append(
                f'<a class="cite{drift}" href="{href}" data-snip="{html.escape(ref["key"], quote=True)}"'
                f' title="{html.escape(tip, quote=True)}">{html.escape(part)}</a>'
            )
        joined = ','.join(links)
        return f'{html.escape(label_prefix)}:{joined}' if label_prefix else f':{joined}'

    # ---- output -------------------------------------------------------------
    def snippets_json(self, keys: tp.Iterable[str]) -> str:
        payload = {}
        for key in keys:
            ref = self.refs[key]
            payload[key] = {
                'file': ref['file'],
                'basename': ref['basename'],
                'symbol': ref['symbol'],
                'kind': ref['kind'],
                'lang': ref['lang'],
                'line_start': ref['line_start'],
                'line_end': ref['line_end'],
                'cited_start': ref['cited_start'],
                'cited_end': ref['cited_end'],
                'doc': ref['doc'],
                'code': ref['code'],
                'windowed': ref['windowed'],
                'item_start': ref['item_start'],
                'item_end': ref['item_end'],
                'page': page_slug(ref['file']),
                'anchor': anchor(ref['symbol'], ref['anchor_line']),
            }
        return json.dumps(payload).replace('</script>', '<\\/script>')

    def report(self) -> str:
        # Every doc is rendered twice — once as its own page, once into the one-scroll view — so all
        # of these are reported as distinct occurrences, not raw hit counts.
        lines = [f'citations: {len(self.refs)} distinct items referenced']
        if self.unresolved:
            lines.append('  unresolved files (cited, not in code_index.SOURCES):')
            for base, count in self.unresolved.most_common():
                lines.append(f'    {base} x{count // 2 or count}')
        if self.recovered:
            lines.append(
                f'  bare `:n` continuations re-attached to an earlier file '
                f'({len(set(self.recovered))}):'
            )
            for doc_id, spec, wrong, right in sorted(set(self.recovered)):
                lines.append(
                    f'    {doc_id}: :{spec} — too big for {wrong.rsplit("/", 1)[-1]}, '
                    f'used {right.rsplit("/", 1)[-1]}'
                )
        if self.out_of_range:
            lines.append(f'  line past end of file, linked to the file instead ({len(self.out_of_range)}):')
            for doc_id, rel, line in sorted(set(self.out_of_range)):
                base = rel.rsplit('/', 1)[-1]
                lines.append(f'    {doc_id}: {base}:{line} (file has {self.files[rel]["n_lines"]})')
        if self.drifted:
            lines.append(f'  line drift, resolved by symbol/nearest ({len(set(self.drifted))}):')
            seen = set()
            for doc_id, rel, line, symbol, real in self.drifted:
                sig = (rel, line, symbol)
                if sig in seen:
                    continue
                seen.add(sig)
                base = rel.rsplit("/", 1)[-1]
                lines.append(f'    {doc_id}: {base}:{line} -> {symbol} @ {real}')
        return '\n'.join(lines)
