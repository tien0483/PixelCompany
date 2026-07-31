# Copyright (C) 2026 Akselos
"""Build a compact, self-consistent test ASL from a full pigtail-model solution ASL.

Given a full `Unit_1*.asl` (the whole train, hundreds of components, but already
`model == solution` so every component has a solution exo) and the train's Row.csv,
this keeps only:

  * every structural component (main_pipe* / sub_header*), and
  * the 4 test pigtail branches (Weld/Bend/Hanger [+ Reducer for train-2] and any
    hanger_system they dock to), found by a BFS from the Row-CSV component ids that
    STOPS at structural components,

and deletes everything else. Because each pigtail branch is a leaf-chain hanging off
the structural backbone (which stays grounded by its own arity-1 port constraints),
dropping the other branches leaves the kept set self-consistent. This is verified: the
BFS is rejected if any kept non-structural component still references a deleted one.

Why a scripted zip-prune and not the SDK / Modeler:
  * `ModelState.delete_entities_command` operates on the editable component_system, but a
    loaded `.asl` solution is immutable — the deletion does NOT propagate into the saved
    solution, so `save_to_asl_file` writes the full component set back. (Verified.)
  * A naive hand-strip only fails when the source is `model != solution` (structural
    components without exos). These full ASLs are `model == solution`, so a principled
    prune that keeps ALL structural components is safe.

The prune rewrites the single `component_system_solution_data.json` (components,
port_constraints, stored_selections.selection_items, top-level component_solutions) and
drops the deleted components' exos. Output is verified `model == exos == component_solutions`
with `component_1` present, and is well under Mercurial's 2 GiB largefile limit.

Usage (plain CPython, no SDK needed):
    python build_compact.py <full_source.asl> <Row.csv> <out_compact.asl>
"""
import collections
import json
import os
import sys
import time
import zipfile

JSON_MEMBER = "solutions/solution_0/component_system_solution_data.json"


def _exo_id(name: str) -> int:
    return int(name.split("component_")[-1].split(".exo")[0])


def compute_keep_set(cs: dict, row_csv: str):
    """Return (keep, delete, typeof). Raises AssertionError if the keep-set is not
    self-consistent (a kept non-structural component docks to a deleted one)."""
    comps = cs["components"]
    typeof = {c["component_id"]: c["ref_component_type"].split("/")[-1] for c in comps}
    allids = set(typeof)
    struct = {c for c, t in typeof.items() if "main_pipe" in t or "sub_header" in t}

    lines = open(row_csv).read().strip().splitlines()
    hdr = lines[0].split(",")
    seed = set()
    for ln in lines[1:]:
        row = dict(zip(hdr, ln.split(",")))
        for col in ("Bend", "Hanger", "Weld", "Reducer"):
            if row.get(col):
                seed.add(int(row[col]))

    edges = collections.defaultdict(set)
    for pc in cs["port_constraints"]:
        cids = [p["component_id"] for p in pc.get("port_id_data", [])]
        for a in cids:
            for b in cids:
                if a != b:
                    edges[a].add(b)

    keep = set(struct) | set(seed)
    frontier = list(seed)
    while frontier:
        cur = frontier.pop()
        if cur in struct:
            continue  # structural is a boundary: keep it, but don't cross into other branches
        for nb in edges[cur]:
            if nb not in keep:
                keep.add(nb)
                frontier.append(nb)

    for c in keep - struct:
        for nb in edges[c]:
            assert nb in keep, f"non-structural kept {c} docks to deleted {nb}; keep-set unsafe"
    assert 1 in keep, "structural root component_1 missing from keep-set"
    return keep, allids - keep, typeof


def main():
    src, row_csv, out = sys.argv[1], sys.argv[2], sys.argv[3]
    t0 = time.time()
    zin = zipfile.ZipFile(src)
    d = json.loads(zin.read(JSON_MEMBER))
    cs = d["akselos_assembly"]["component_system"]

    keep, delete, typeof = compute_keep_set(cs, row_csv)
    print(f"keep={len(keep)} delete={len(delete)} "
          f"reducers_kept={sorted(c for c in keep if 'reducer' in typeof[c])}")

    cs["components"] = [c for c in cs["components"] if c["component_id"] in keep]
    cs["port_constraints"] = [pc for pc in cs["port_constraints"]
                              if all(p["component_id"] in keep for p in pc.get("port_id_data", []))]
    for ss in cs["stored_selections"]:
        if "selection_items" in ss:
            ss["selection_items"] = [it for it in ss["selection_items"]
                                     if it.get("component_id", -1) in keep or "component_id" not in it]
    d["component_solutions"] = [c for c in d["component_solutions"] if c["component_id"] in keep]

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    kept_exos = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zout:
        for item in zin.infolist():
            name = item.filename
            if name == JSON_MEMBER:
                zout.writestr(name, json.dumps(d))
            elif name.endswith(".exo") and "component_solutions" in name:
                if _exo_id(name) in keep:
                    zout.writestr(item, zin.read(name))
                    kept_exos += 1
            else:
                zout.writestr(item, zin.read(name))
    print(f"kept_exos={kept_exos} size={os.path.getsize(out)/1e6:.1f}MB time={time.time()-t0:.1f}s")

    # Verify self-consistency of the written compact.
    z = zipfile.ZipFile(out)
    exos = {_exo_id(x) for x in z.namelist() if "component_solutions" in x and x.endswith(".exo")}
    d2 = json.loads(z.read(JSON_MEMBER))
    model = {c["component_id"] for c in d2["akselos_assembly"]["component_system"]["components"]}
    csol = {c["component_id"] for c in d2["component_solutions"]}
    assert model == exos == csol and 1 in exos, "compact is not self-consistent"
    assert os.path.getsize(out) < 2 * 1024**3, "compact exceeds 2 GiB (hg largefile limit)"
    print(f"VERIFY ok: model==exos==component_solutions ({len(model)} comps), component_1 present")


if __name__ == "__main__":
    main()
