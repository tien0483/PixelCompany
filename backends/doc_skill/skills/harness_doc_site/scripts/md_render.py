# Copyright (C) 2026 Akselos
"""Minimal CommonMark-ish renderer: headings, tables, fences, lists, quotes, inline spans.

Exists because the site has to post-process *text* (turning `file.rs:123` into a live link) and a
client-side renderer cannot do that at build time. Only the subset the BIM-viewer docs actually use
is supported — if a doc starts using a new construct, add it here rather than working around it.
"""

from __future__ import annotations

import html
import re
import typing as tp

# (text, in_code_span) -> escaped html. The flag matters because a bare `:123` means a line number
# inside backticks and almost never means one in running prose.
InlineHook = tp.Callable[..., str]

_CODE_SPAN = re.compile(r'`([^`]+)`')
_LINK = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
_BOLD = re.compile(r'\*\*([^*]+)\*\*')
_ITALIC = re.compile(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])')
_HEADING = re.compile(r'^(#{1,6})\s+(.*)$')
_FENCE = re.compile(r'^```(\w*)\s*$')
_ULI = re.compile(r'^(\s*)[-*]\s+(.*)$')
_OLI = re.compile(r'^(\s*)(\d+)\.\s+(.*)$')
_TABLE_SEP = re.compile(r'^\s*\|?[\s:-]*-[-\s|:]*\|?\s*$')

CSS_CLASSES = {
    'h1': 'text-2xl font-bold text-slate-100 mt-8 mb-3 scroll-mt-20',
    'h2': 'text-xl font-semibold text-emerald-300 mt-8 mb-3 pb-1 border-b border-slate-800 scroll-mt-20',
    'h3': 'text-base font-semibold text-slate-100 mt-6 mb-2 scroll-mt-20',
    'h4': 'text-sm font-semibold text-slate-300 mt-4 mb-2 scroll-mt-20',
    'p': 'text-sm leading-relaxed text-slate-300 my-3',
    'ul': 'list-disc pl-6 my-3 space-y-1.5 text-sm text-slate-300',
    'ol': 'list-decimal pl-6 my-3 space-y-1.5 text-sm text-slate-300',
    'quote': 'border-l-2 border-emerald-500/50 bg-emerald-950/10 pl-4 pr-3 py-2 my-4 text-sm text-slate-300',
    'table': 'w-full text-xs my-4 border border-slate-800 border-collapse',
    'th': 'border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-left font-semibold text-slate-200 align-top',
    'td': 'border border-slate-800 px-2.5 py-1.5 align-top text-slate-300',
    'pre': 'bg-slate-900 border border-slate-800 rounded-lg p-3 my-4 overflow-x-auto text-xs leading-relaxed',
    'code': 'text-emerald-300 bg-slate-800/60 rounded px-1 py-0.5 text-[0.8em] font-mono',
    'a': 'text-blue-400 hover:text-blue-300 underline decoration-blue-400/40',
    'hr': 'border-slate-800 my-8',
}


def slugify(text: str) -> str:
    """Heading -> URL fragment. Stable, because verdict badges are keyed on these."""
    text = _CODE_SPAN.sub(r'\1', text)
    text = re.sub(r'\*\*?', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug or 'section'


def render_inline(text: str, hook: InlineHook | None = None) -> str:
    """Inline spans. `hook` sees only plain text — never the inside of a code span or a URL."""
    parts: list[str] = []
    pos = 0
    for m in _CODE_SPAN.finditer(text):
        parts.append(_render_plain(text[pos : m.start()], hook))
        inner = m.group(1)
        linked = hook(inner, True) if hook else ''
        body = linked if linked and linked != html.escape(inner) else html.escape(inner)
        parts.append(f'<code class="{CSS_CLASSES["code"]}">{body}</code>')
        pos = m.end()
    parts.append(_render_plain(text[pos:], hook))
    return ''.join(parts)


def _render_plain(text: str, hook: InlineHook | None) -> str:
    out: list[str] = []
    pos = 0
    for m in _LINK.finditer(text):
        out.append(_render_words(text[pos : m.start()], hook))
        label = _render_words(m.group(1), None)
        href = html.escape(m.group(2), quote=True)
        out.append(f'<a class="{CSS_CLASSES["a"]}" href="{href}">{label}</a>')
        pos = m.end()
    out.append(_render_words(text[pos:], hook))
    return ''.join(out)


def _render_words(text: str, hook: InlineHook | None) -> str:
    if not text:
        return ''
    body = hook(text, False) if hook else html.escape(text)
    body = _BOLD.sub(r'<strong class="text-slate-100 font-semibold">\1</strong>', body)
    body = _ITALIC.sub(r'<em class="italic">\1</em>', body)
    return body


class _Doc:
    def __init__(self, hook: InlineHook | None) -> None:
        self.hook = hook
        self.out: list[str] = []
        self.headings: list[tuple[int, str, str]] = []  # (level, text, slug)

    def inline(self, text: str) -> str:
        return render_inline(text, self.hook)


def render(md: str, hook: InlineHook | None = None) -> tuple[str, list[tuple[int, str, str]]]:
    """Returns (html, headings). Headings are (level, text, slug) for building a table of contents."""
    doc = _Doc(hook)
    lines = md.split('\n')
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        if (m := _FENCE.match(line)) is not None:
            lang = m.group(1)
            body: list[str] = []
            i += 1
            while i < n and not _FENCE.match(lines[i]):
                body.append(lines[i])
                i += 1
            i += 1
            code = html.escape('\n'.join(body))
            doc.out.append(
                f'<pre class="{CSS_CLASSES["pre"]}" data-lang="{lang}">'
                f'<code class="font-mono">{code}</code></pre>'
            )
            continue

        if (m := _HEADING.match(line)) is not None:
            level = len(m.group(1))
            text = m.group(2).strip()
            slug = slugify(text)
            doc.headings.append((level, _CODE_SPAN.sub(r'\1', text), slug))
            tag = f'h{min(level, 4)}'
            cls = CSS_CLASSES.get(tag, CSS_CLASSES['h4'])
            doc.out.append(
                f'<{tag} id="{slug}" class="{cls}" data-slug="{slug}">'
                f'<a href="#{slug}" class="no-underline hover:text-emerald-400">{doc.inline(text)}</a>'
                f'</{tag}>'
            )
            i += 1
            continue

        if line.strip() in ('---', '***', '___'):
            doc.out.append(f'<hr class="{CSS_CLASSES["hr"]}">')
            i += 1
            continue

        if line.lstrip().startswith('>'):
            body = []
            while i < n and lines[i].lstrip().startswith('>'):
                body.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            inner, _ = render('\n'.join(body), doc.hook)
            doc.out.append(f'<blockquote class="{CSS_CLASSES["quote"]}">{inner}</blockquote>')
            continue

        if line.strip().startswith('|') and i + 1 < n and _TABLE_SEP.match(lines[i + 1]):
            i = _table(doc, lines, i)
            continue

        if _ULI.match(line) or _OLI.match(line):
            i = _list(doc, lines, i)
            continue

        if not line.strip():
            i += 1
            continue

        para: list[str] = []
        while i < n and lines[i].strip() and not (
            _HEADING.match(lines[i])
            or _FENCE.match(lines[i])
            or lines[i].lstrip().startswith('>')
            or _ULI.match(lines[i])
            or _OLI.match(lines[i])
            or lines[i].strip().startswith('|')
            or lines[i].strip() in ('---', '***', '___')
        ):
            para.append(lines[i].strip())
            i += 1
        doc.out.append(f'<p class="{CSS_CLASSES["p"]}">{doc.inline(" ".join(para))}</p>')

    return '\n'.join(doc.out), doc.headings


def _split_row(line: str) -> list[str]:
    cells = line.strip().strip('|').split('|')
    return [c.strip() for c in cells]


def _table(doc: _Doc, lines: list[str], i: int) -> int:
    header = _split_row(lines[i])
    i += 2
    rows: list[list[str]] = []
    while i < len(lines) and lines[i].strip().startswith('|'):
        rows.append(_split_row(lines[i]))
        i += 1
    head = ''.join(f'<th class="{CSS_CLASSES["th"]}">{doc.inline(c)}</th>' for c in header)
    body = []
    for row in rows:
        cells = ''.join(f'<td class="{CSS_CLASSES["td"]}">{doc.inline(c)}</td>' for c in row)
        body.append(f'<tr>{cells}</tr>')
    doc.out.append(
        f'<div class="overflow-x-auto"><table class="{CSS_CLASSES["table"]}">'
        f'<thead><tr>{head}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'
    )
    return i


def _list(doc: _Doc, lines: list[str], i: int) -> int:
    """Handles one list, including nested items and lazy continuation lines."""
    ordered = _OLI.match(lines[i]) is not None
    base_indent = len(_OLI.match(lines[i]).group(1) if ordered else _ULI.match(lines[i]).group(1))
    items: list[list[str]] = []
    while i < len(lines):
        line = lines[i]
        m_u = _ULI.match(line)
        m_o = _OLI.match(line)
        if m_u or m_o:
            indent = len(m_u.group(1) if m_u else m_o.group(1))
            if indent < base_indent:
                break
            if indent > base_indent and items:
                items[-1].append(line[base_indent:])
            else:
                items.append([(m_u.group(2) if m_u else m_o.group(3))])
            i += 1
        elif line.strip() and items and (len(line) - len(line.lstrip())) >= base_indent:
            items[-1].append(line.strip())
            i += 1
        elif not line.strip() and i + 1 < len(lines) and (
            _ULI.match(lines[i + 1]) or _OLI.match(lines[i + 1])
        ):
            i += 1
        else:
            break

    rendered = []
    for chunk in items:
        first = chunk[0]
        nested = [c for c in chunk[1:] if _ULI.match(c) or _OLI.match(c)]
        flow = [c for c in chunk[1:] if not (_ULI.match(c) or _OLI.match(c))]
        body = doc.inline(' '.join([first] + flow))
        if nested:
            sub, _ = render('\n'.join(c.lstrip() and ('- ' + _ULI.match(c).group(2)) if _ULI.match(c) else c for c in nested), doc.hook)
            body += sub
        rendered.append(f'<li>{body}</li>')
    tag = 'ol' if ordered else 'ul'
    doc.out.append(f'<{tag} class="{CSS_CLASSES[tag]}">{"".join(rendered)}</{tag}>')
    return i
