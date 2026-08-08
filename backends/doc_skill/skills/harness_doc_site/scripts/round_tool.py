# Copyright (C) 2026 Akselos
"""Opens a harness round and records checks into `verdicts.json`, append-only.

The loop this supports:

    harness team reviews  ->  round_tool.py open      (declare a new round)
    write 0N_review_*.md  ->  round_tool.py check ... (one per claim the round touched)
    build_site.py                                    (renders the new layer, keeps the old ones)

Nothing here ever edits or deletes an earlier check: a re-run adds a layer, so the document's previous
state stays readable and dated. Your own findings go in the same way, with `--provenance user` (plus
`--url` for something you read elsewhere), which is what lets the team's response and your evidence sit
in one timeline.

    python round_tool.py open --at 2026-08-04 --trigger "P2 streaming upload landed" \\
        --reports 09_review_loader.md
    python round_tool.py check --doc 01_explorer_wgpu_bim_gap.md --match "Recommended order" \\
        --verdict CONFIRMED --now "Loader freeze is gone; peak wasm memory is one chunk." \\
        --by 09_review_loader.md
    python round_tool.py check --doc 05_benchmark_and_limits.md --match "Metrics to capture" \\
        --verdict ADDED --provenance user --url https://example.com/post \\
        --claim "(not stated) upload budget per frame" \\
        --now "Chrome's 4 ms budget guidance matches what we measured." --target "Budget honoured."
    python round_tool.py status
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
PATH = HERE / 'verdicts.json'

VERDICTS = ('CONFIRMED', 'STALE', 'WRONG', 'ADDED', 'SCOPE')
PROVENANCE = ('harness', 'user', 'external')


def load() -> dict:
    return json.loads(PATH.read_text(encoding='utf-8'))


def save(data: dict) -> None:
    PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def current_round(data: dict) -> int:
    return max((r['round'] for r in data.get('rounds', [])), default=0)


def cmd_open(args: argparse.Namespace) -> int:
    data = load()
    nxt = current_round(data) + 1
    data.setdefault('rounds', []).append({
        'round': nxt,
        'at': args.at,
        'trigger': args.trigger,
        'reports': args.reports or [],
    })
    save(data)
    print(f'opened round {nxt} ({args.at}): {args.trigger}')
    print('record checks with: python round_tool.py check --doc … --match … --verdict … --now …')
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    data = load()
    rnd = args.round or current_round(data)
    if rnd == 0:
        print('no round is open — run `round_tool.py open` first', file=sys.stderr)
        return 1
    at = args.at or next((r['at'] for r in data['rounds'] if r['round'] == rnd), '')

    check = {
        'round': rnd,
        'at': at,
        'verdict': args.verdict,
        'by': args.by or '',
        'provenance': args.provenance,
        'now': args.now,
        'fix_state': args.fix_state,
    }
    if args.url:
        check['source_url'] = args.url

    match = str(args.match)
    entry = next((e for e in data['entries']
                  if e['doc'] == args.doc and str(e['match']) == match), None)
    if entry is None:
        if not args.claim:
            print('new claim: --claim is required so the record says what was originally asserted',
                  file=sys.stderr)
            return 1
        entry = {
            'doc': args.doc,
            'match': match,
            'claim': args.claim,
            'claim_written': args.claim_written or at,
            'target': args.target or '',
            'checks': [],
        }
        data['entries'].append(entry)
        print(f'new entry: {args.doc} § {match}')
    else:
        if args.target:
            entry['target'] = args.target
        prev = max(entry['checks'], key=lambda c: (c.get('round', 0), c.get('at', '')), default=None)
        if prev and prev.get('round') == rnd:
            print(f'round {rnd} already has a check on this claim — appending a second one',
                  file=sys.stderr)
        if prev:
            print(f'superseding round {prev.get("round")} ({prev.get("verdict")}) '
                  f'-> round {rnd} ({args.verdict})')
    entry['checks'].append(check)
    save(data)
    print(f'recorded {args.verdict} on {args.doc} § {match} (round {rnd})')
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    data = load()
    rnd = current_round(data)
    print(f'{len(data["entries"])} claims, '
          f'{sum(len(e["checks"]) for e in data["entries"])} checks, '
          f'{len(data.get("rounds", []))} round(s); current = {rnd}')
    for r in data.get('rounds', []):
        touched = sum(1 for e in data['entries']
                      for c in e['checks'] if c.get('round') == r['round'])
        print(f'  round {r["round"]} ({r["at"]}): {touched} checks — {r["trigger"][:80]}')
    stale_greens = [
        e for e in data['entries']
        if max(e['checks'], key=lambda c: (c.get('round', 0), c.get('at', '')))
        .get('round', 0) < rnd
    ]
    print(f'  {len(stale_greens)} claims not re-checked in round {rnd} '
          f'(their green is older than this round)')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    op = sub.add_parser('open', help='declare a new harness round')
    op.add_argument('--at', required=True, help='date, YYYY-MM-DD')
    op.add_argument('--trigger', required=True, help='what prompted this round')
    op.add_argument('--reports', nargs='*', help='review docs this round produced')
    op.set_defaults(func=cmd_open)

    ck = sub.add_parser('check', help='record a verdict on a claim')
    ck.add_argument('--doc', required=True)
    ck.add_argument('--match', required=True, help='heading substring, or plan step number')
    ck.add_argument('--verdict', required=True, choices=VERDICTS)
    ck.add_argument('--now', required=True, help='the current statement (the green layer)')
    ck.add_argument('--target', help='exit condition; updates the existing one if given')
    ck.add_argument('--by', help='report file, person, or source name')
    ck.add_argument('--provenance', default='harness', choices=PROVENANCE)
    ck.add_argument('--url', help='link, for --provenance external')
    ck.add_argument('--fix-state', dest='fix_state', default='CONFIRMED',
                    choices=('CONFIRMED', 'PROPOSED'))
    ck.add_argument('--claim', help='required for a claim not already tracked')
    ck.add_argument('--claim-written', dest='claim_written')
    ck.add_argument('--at', help='override the round date')
    ck.add_argument('--round', type=int)
    ck.set_defaults(func=cmd_check)

    st = sub.add_parser('status', help='rounds, checks, and which claims are behind')
    st.set_defaults(func=cmd_status)

    args = ap.parse_args()
    return args.func(args)


if __name__ == '__main__':
    raise SystemExit(main())
