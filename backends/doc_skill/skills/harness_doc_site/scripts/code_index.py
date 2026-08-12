# Copyright (C) 2026 Akselos
"""TEMPLATE: lists the code your docs cite. Set `sources` in `site.json` (or `SOURCES` below).

Extracts every cited source item (with its doc comment) into `code_index.json`.

The BIM-viewer docs cite code as `file.rs:123`. On its own that is unreadable — the reader has to
open a checkout to learn anything. This module pulls the *enclosing item* (fn / struct / impl /
class / const / WGSL block) plus the comments above it, so `citations.py` can inline the real code
and `build_site.py` can render a browsable code atlas.

Deliberately dependency-free and deliberately not a real parser: brace matching plus item-header
regexes are enough for these ~13k lines, and a wrong span shows up immediately as a bad snippet.
Python files go through `ast`, which is exact.

Run: `python code_index.py` (writes `code_index.json` next to this file).
"""

from __future__ import annotations

import ast
import json
import pathlib
import re
import typing as tp

HERE = pathlib.Path(__file__).resolve().parent

# `site.json` (written by init_doc_site.py) overrides both of these, so a new project needs no Python
# edits: {"repo_root": "../../..", "sources": ["path/to/file.rs", ...]}
_SITE = (
    json.loads((HERE / 'site.json').read_text(encoding='utf-8'))
    if (HERE / 'site.json').exists() else {}
)
# .agent/_workspace/<project> -> worktree root
REPO = (HERE / _SITE['repo_root']).resolve() if _SITE.get('repo_root') else HERE.parent.parent.parent

# Every file the docs cite, by repo-relative path. `label` is what the docs write (the basename,
# usually) and is what `citations.py` matches on.
SOURCES: list[str] = [
    # --- Rust crate ---
    'tools/wgpu_renderer/src/app.rs',
    'tools/wgpu_renderer/src/binary_utils.rs',
    'tools/wgpu_renderer/src/bounding_box.rs',
    'tools/wgpu_renderer/src/camera_infos.rs',
    'tools/wgpu_renderer/src/color_bar.rs',
    'tools/wgpu_renderer/src/custom_layer/mod.rs',
    'tools/wgpu_renderer/src/custom_layer/sensor_stage.rs',
    'tools/wgpu_renderer/src/graphics_item.rs',
    'tools/wgpu_renderer/src/graphics_window.rs',
    'tools/wgpu_renderer/src/handler.rs',
    'tools/wgpu_renderer/src/lib.rs',
    'tools/wgpu_renderer/src/main.rs',
    'tools/wgpu_renderer/src/overlay_pass.rs',
    'tools/wgpu_renderer/src/pick_stage.rs',
    'tools/wgpu_renderer/src/pick_utils.rs',
    'tools/wgpu_renderer/src/pipelines.rs',
    'tools/wgpu_renderer/src/point.rs',
    'tools/wgpu_renderer/src/render_list.rs',
    'tools/wgpu_renderer/src/renderer_config.rs',
    'tools/wgpu_renderer/src/saved_framebuffer.rs',
    'tools/wgpu_renderer/src/scalar_field_stage.rs',
    'tools/wgpu_renderer/src/shaded_stage.rs',
    'tools/wgpu_renderer/src/shaders.rs',
    'tools/wgpu_renderer/src/transformations.rs',
    'tools/wgpu_renderer/src/translucent_stage.rs',
    'tools/wgpu_renderer/src/triad_stage.rs',
    'tools/wgpu_renderer/src/user_controls.rs',
    'tools/wgpu_renderer/src/view.rs',
    'tools/wgpu_renderer/src/web_app.rs',
    'tools/wgpu_renderer/src/wgpu_renderer.rs',
    'tools/wgpu_renderer/Cargo.toml',
    # --- Python producer side ---
    'tools/wgpu_renderer/wgpu_data_utils/worker.py',
    'tools/wgpu_renderer/wgpu_data_utils/helper_functions.py',
    'tools/wgpu_renderer/wgpu_data_utils/wgpu_data_result.py',
    'tools/wgpu_renderer/wgpu_data_utils/synth_bench.py',
    'tools/gl_graphics/render_list.py',
    'tools/gl_graphics/remote_render_list.py',
    'tools/gl_graphics/gl_renderer.py',
    'tools/gl_graphics/pick_info.py',
    'tools/graphics_api/graphics_face.py',
    'tools/graphics_api/graphics_array.py',
    'tools/akselos/ui/pick.py',
    'tools/akselos/ui/graphics_trees/graphics_group_node.py',
    'tools/akselos/ui/graphics_layers/triad_layer.py',
    'tools/akselos/ui/graphics_layers/component_type_layer.py',
    'tools/akselos/ui/graphics_trees/solution_graphics/nodeset_field_graphics.py',
    'tools/akselos/ui/graphics_trees/solution_graphics/solution_mesh_graphics.py',
    'tools/akselos/ui/graphics_trees/solution_graphics/solution_undeformed_model_graphics.py',
    'dashboard/papps/frontends/build_wgpu_renderer.py',
    # --- Browser side ---
    'dashboard/papps/frontends/src/library/components/WgpuCanvas/utils/loadRenderData.util.ts',
    'dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx',
    'dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuRenderer.tsx',
    'dashboard/papps/frontends/src/library/components/WgpuCanvas/HybridCanvas.tsx',
]

if _SITE.get('sources'):
    SOURCES = list(_SITE['sources'])

RUST_ITEM = re.compile(
    r'^(?P<indent>[ \t]*)'
    r'(?:pub(?:\([^)]*\))?[ \t]+)?'
    r'(?:default[ \t]+)?(?:const[ \t]+)?(?:async[ \t]+)?(?:unsafe[ \t]+)?'
    r'(?:extern[ \t]+"[^"]*"[ \t]+)?'
    r'(?P<kind>fn|struct|enum|trait|impl|mod|type|union|static|const)\b'
    r'(?P<rest>.*)$'
)
RUST_NAME = re.compile(r'^[ \t]*(?P<name>[A-Za-z_][\w]*)')
WGSL_CONST = re.compile(
    r'^[ \t]*(?:pub[ \t]+)?const[ \t]+(?P<name>[A-Z0-9_]*WGSL[A-Z0-9_]*)[ \t]*:[ \t]*&\'?\w*[ \t]*str'
)
TS_ITEM = re.compile(
    r'^(?P<indent>[ \t]*)(?:export[ \t]+)?(?:default[ \t]+)?'
    r'(?P<kind>async[ \t]+function|function|class|const|let|var|interface|type|enum)[ \t]+'
    r'(?P<name>[A-Za-z_$][\w$]*)'
)


class Item(tp.TypedDict):
    symbol: str
    kind: str
    line_start: int
    line_end: int
    doc: str
    code: str


def _strip_doc(lines: list[str], markers: tuple[str, ...]) -> str:
    """Joins comment lines above an item into prose, dropping the comment markers themselves."""
    out = []
    for raw in lines:
        text = raw.strip()
        for marker in markers:
            if text.startswith(marker):
                text = text[len(marker) :].strip()
                break
        out.append(text)
    while out and not out[0]:
        out.pop(0)
    while out and not out[-1]:
        out.pop()
    return '\n'.join(out)


def _comment_block_above(lines: list[str], idx: int, markers: tuple[str, ...]) -> tuple[int, str]:
    """Walks up from `idx` over comments and attributes. Returns (first line index, doc prose)."""
    first = idx
    doc_lines: list[str] = []
    i = idx - 1
    while i >= 0:
        text = lines[i].strip()
        if any(text.startswith(m) for m in markers):
            doc_lines.insert(0, lines[i])
            first = i
        elif text.startswith('#[') or text.startswith('#!['):
            # Attribute: part of the item, but carries no prose.
            first = i
        elif not text:
            # A blank line separates an item from an unrelated comment above it.
            break
        else:
            break
        i -= 1
    return first, _strip_doc(doc_lines, markers)


def _brace_span(lines: list[str], start: int) -> int:
    """Returns the index of the line closing the first `{` at or after `start`.

    Counts braces outside string and char literals and outside `//` comments. Raw strings (`r#"`)
    are handled because their delimiters contain no braces we care about — the body is skipped
    wholesale by the in-string state machine.
    """
    depth = 0
    seen_open = False
    in_str = False
    in_char = False
    raw_hashes = -1
    i = start
    while i < len(lines):
        line = lines[i]
        j = 0
        while j < len(line):
            ch = line[j]
            if in_str:
                if raw_hashes >= 0:
                    if ch == '"' and line[j + 1 : j + 1 + raw_hashes] == '#' * raw_hashes:
                        in_str = False
                        raw_hashes = -1
                        j += raw_hashes if raw_hashes > 0 else 0
                elif ch == '\\':
                    j += 1
                elif ch == '"':
                    in_str = False
            elif in_char:
                if ch == '\\':
                    j += 1
                elif ch == "'":
                    in_char = False
            elif ch == '/' and line[j + 1 : j + 2] == '/':
                break
            elif ch == 'r' and (m := re.match(r'r(#*)"', line[j:])):
                in_str = True
                raw_hashes = len(m.group(1))
                j += m.end() - 1
            elif ch == '"':
                in_str = True
                raw_hashes = -1
            elif ch == "'" and not re.match(r"'(?:static|_|[a-z]\w*)\b", line[j:]):
                in_char = True
            elif ch == '{':
                depth += 1
                seen_open = True
            elif ch == '}':
                depth -= 1
                if seen_open and depth == 0:
                    return i
            j += 1
        i += 1
    return len(lines) - 1


def _raw_string_lines(lines: list[str]) -> set[int]:
    """Line indices sitting *inside* a `r#"..."#` literal.

    WGSL lives in raw strings, and WGSL declares `struct Globals { ... }` too. Without this mask the
    shader's own declarations get indexed as Rust items and shadow the real ones.
    """
    inside: set[int] = set()
    i = 0
    while i < len(lines):
        m = re.search(r'r(#+)"', lines[i])
        if m is not None:
            close = '"' + m.group(1)
            j = i + 1
            while j < len(lines) and close not in lines[j]:
                inside.add(j)
                j += 1
            i = j
        i += 1
    return inside


def _rust_items(lines: list[str], path: str) -> list[Item]:
    items: list[Item] = []
    scope: list[tuple[str, int]] = []  # (impl/mod name, closing line)
    masked = _raw_string_lines(lines)
    for idx, line in enumerate(lines):
        while scope and idx > scope[-1][1]:
            scope.pop()
        if idx in masked:
            continue
        if (m := WGSL_CONST.match(line)) is not None:
            end = idx
            while end < len(lines) and not re.search(r'"#[ \t]*;', lines[end]):
                end += 1
            first, doc = _comment_block_above(lines, idx, ('///', '//!', '//'))
            items.append(
                Item(
                    symbol=m.group('name'),
                    kind='wgsl',
                    line_start=first + 1,
                    line_end=min(end, len(lines) - 1) + 1,
                    doc=doc,
                    code='\n'.join(lines[first : min(end, len(lines) - 1) + 1]),
                )
            )
            continue
        m = RUST_ITEM.match(line)
        if m is None:
            continue
        kind = m.group('kind')
        rest = m.group('rest')
        name_m = RUST_NAME.match(rest)
        if kind == 'impl':
            # `impl Foo`, `impl<T> Foo for Bar` -> name the target type.
            target = re.search(r'(?:for[ \t]+)?(?P<name>[A-Z][\w]*)[ \t]*(?:<[^>]*>)?[ \t]*\{', rest)
            name = target.group('name') if target else 'impl'
        elif name_m is None:
            continue
        else:
            name = name_m.group('name')
        has_body = '{' in rest or (kind in ('fn', 'impl', 'struct', 'enum', 'trait', 'mod', 'union'))
        if ';' in rest.split('//')[0] and '{' not in rest.split('//')[0]:
            end = idx
        elif has_body:
            end = _brace_span(lines, idx)
        else:
            end = idx
        first, doc = _comment_block_above(lines, idx, ('///', '//!', '//'))
        prefix = '::'.join(s[0] for s in scope)
        symbol = f'{prefix}::{name}' if prefix else name
        items.append(
            Item(
                symbol=symbol,
                kind=kind,
                line_start=first + 1,
                line_end=end + 1,
                doc=doc,
                code='\n'.join(lines[first : end + 1]),
            )
        )
        if kind in ('impl', 'mod') and end > idx:
            scope.append((name, end))
    return items


def _python_items(text: str, lines: list[str]) -> list[Item]:
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:  # pragma: no cover - a broken source file is worth shouting about
        print(f'  ! python parse failed: {exc}')
        return []
    items: list[Item] = []

    def visit(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                start = min([child.lineno] + [d.lineno for d in child.decorator_list]) - 1
                first, _ = _comment_block_above(lines, start, ('#',))
                doc = ast.get_docstring(child) or _strip_doc(lines[first:start], ('#',))
                end = (child.end_lineno or child.lineno) - 1
                symbol = f'{prefix}.{child.name}' if prefix else child.name
                items.append(
                    Item(
                        symbol=symbol,
                        kind='class' if isinstance(child, ast.ClassDef) else 'def',
                        line_start=first + 1,
                        line_end=end + 1,
                        doc=doc or '',
                        code='\n'.join(lines[first : end + 1]),
                    )
                )
                visit(child, symbol)
            elif isinstance(child, (ast.Assign, ast.AnnAssign)) and prefix == '':
                targets = child.targets if isinstance(child, ast.Assign) else [child.target]
                names = [t.id for t in targets if isinstance(t, ast.Name)]
                if not names or not names[0].isupper():
                    continue
                start = child.lineno - 1
                first, doc = _comment_block_above(lines, start, ('#',))
                end = (child.end_lineno or child.lineno) - 1
                items.append(
                    Item(
                        symbol=names[0],
                        kind='const',
                        line_start=first + 1,
                        line_end=end + 1,
                        doc=doc,
                        code='\n'.join(lines[first : end + 1]),
                    )
                )

    visit(tree, '')
    return items


def _ts_items(lines: list[str]) -> list[Item]:
    items: list[Item] = []
    for idx, line in enumerate(lines):
        m = TS_ITEM.match(line)
        if m is None or m.group('indent'):
            continue
        stripped = line.split('//')[0]
        end = _brace_span(lines, idx) if '{' in stripped or '=>' in stripped else idx
        if end < idx:
            end = idx
        first = idx
        doc = ''
        if idx > 0 and lines[idx - 1].strip().endswith('*/'):
            j = idx - 1
            while j >= 0 and '/**' not in lines[j]:
                j -= 1
            first = max(j, 0)
            doc = _strip_doc(lines[first:idx], ('/**', '*/', '*'))
        else:
            first, doc = _comment_block_above(lines, idx, ('//',))
        items.append(
            Item(
                symbol=m.group('name'),
                kind=m.group('kind').replace('async function', 'function'),
                line_start=first + 1,
                line_end=end + 1,
                doc=doc,
                code='\n'.join(lines[first : end + 1]),
            )
        )
    return items


def _toml_items(lines: list[str]) -> list[Item]:
    items: list[Item] = []
    start: int | None = None
    name = ''
    for idx, line in enumerate(lines):
        if line.startswith('['):
            if start is not None:
                items.append(
                    Item(symbol=name, kind='table', line_start=start + 1, line_end=idx,
                         doc='', code='\n'.join(lines[start:idx]))
                )
            start = idx
            name = line.strip().strip('[]')
    if start is not None:
        items.append(
            Item(symbol=name, kind='table', line_start=start + 1, line_end=len(lines),
                 doc='', code='\n'.join(lines[start:]))
        )
    return items


def _fill_gaps(items: list[Item], lines: list[str]) -> list[Item]:
    """Adds a `region` item for every line range no real item covers.

    Without this, a citation into a module header, an import block or a gap between functions
    resolves to the *nearest* item — i.e. to the wrong code, silently. A region is honest: it says
    "these are the lines you asked for" and nothing more.
    """
    # Coverage counts *leaf* items only. An `impl` block spans hundreds of lines, so if it counted
    # as coverage, a citation into the space between two of its methods would resolve to the whole
    # impl — 500 lines of snippet for a 3-line claim.
    containers = {'impl', 'mod', 'class', 'table'}
    covered = [False] * (len(lines) + 2)
    for it in items:
        if it['kind'] in containers:
            continue
        for n in range(it['line_start'], min(it['line_end'], len(lines)) + 1):
            covered[n] = True
    out = list(items)
    n = 1
    while n <= len(lines):
        if covered[n]:
            n += 1
            continue
        start = n
        while n <= len(lines) and not covered[n]:
            n += 1
        end = n - 1
        if end - start < 1 and not lines[start - 1].strip():
            continue
        label = 'module header' if start == 1 else f'lines {start}-{end}'
        out.append(
            Item(
                symbol=label,
                kind='region',
                line_start=start,
                line_end=end,
                doc=_strip_doc(
                    [ln for ln in lines[start - 1 : end] if ln.lstrip().startswith(('//!', '#!'))],
                    ('//!', '#!'),
                ),
                code='\n'.join(lines[start - 1 : end]),
            )
        )
    out.sort(key=lambda it: (it['line_start'], it['line_end']))
    return out


def build() -> dict[str, tp.Any]:
    files: dict[str, tp.Any] = {}
    missing: list[str] = []
    for rel in SOURCES:
        path = REPO / rel
        if not path.exists():
            missing.append(rel)
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        lines = text.split('\n')
        suffix = path.suffix
        if suffix == '.rs':
            lang, items = 'rust', _rust_items(lines, rel)
        elif suffix == '.py':
            lang, items = 'python', _python_items(text, lines)
        elif suffix in ('.ts', '.tsx'):
            lang, items = 'typescript', _ts_items(lines)
        elif suffix == '.toml':
            lang, items = 'toml', _toml_items(lines)
        else:
            lang, items = 'text', []
        items = _fill_gaps(items, lines)
        files[rel] = {
            'lang': lang,
            'basename': path.name,
            'n_lines': len(lines),
            'items': items,
            'source': text,
        }
        print(f'  {rel}: {len(items)} items, {len(lines)} lines')
    return {'repo': str(REPO), 'files': files, 'missing': missing}


def main() -> None:
    index = build()
    out = HERE / 'code_index.json'
    out.write_text(json.dumps(index), encoding='utf-8')
    n_items = sum(len(f['items']) for f in index['files'].values())
    print(f'wrote {out} ({round(out.stat().st_size / 1024)} KB, '
          f'{len(index["files"])} files, {n_items} items)')
    if index['missing']:
        print('MISSING (cited but not found):')
        for rel in index['missing']:
            print(f'  {rel}')


if __name__ == '__main__':
    main()
