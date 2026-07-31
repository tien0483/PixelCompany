# Copyright (C) 2026 Akselos
"""Regenerate the GL-free derived fixtures for one train from its compact ASL.

Runs `post_processing_utils.process_results` on the installed compact
`ref_results[_train_2]/CreepAnalysis/results/<job>/Unit_1.asl`, which:
  * writes the per-component time-averaged exos into `Unit_1_nodal_average_year/`
    (these carry the creep_damage / von_mises fields the render colours by), and
  * returns the refined max-creep dataframe, which we save as
    `ref_results[_train_2]/CreepAnalysis/<job>/Max_creep_damage_Unit_1_t_last_refine.csv`.

No GL/server needed — averaging + extraction are pure numpy over the solution exos.
Afterwards it prunes any stale exos in the nodal_average_year dir that don't belong to
the compact's component set (an earlier gold's leftovers), so the dir matches the ASL.

Run in WSL:
    PYTHONPATH=tools .venv-linux/bin/python regen_fixtures.py \
        --collection <abs collection path> --ref ref_results_train_2 \
        --job 20260331_1785070922 --rows row_files_train_2
"""
import argparse
import glob
import os
import types
import zipfile
import json
from pathlib import Path

import set_akselos_path  # noqa: F401
import applet_scripts.smr_outlet_pigtail.post_processing_utils as ppu


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", required=True, help="absolute path to the test collection root")
    ap.add_argument("--ref", required=True, help="ref_results or ref_results_train_2")
    ap.add_argument("--job", required=True, help="<date>_<short_job_id>, e.g. 20260331_1785070922")
    ap.add_argument("--rows", required=True, help="row_files_train_1 or row_files_train_2")
    args = ap.parse_args()

    col = Path(args.collection)
    job_dir = col / args.ref / "CreepAnalysis" / "results" / args.job
    asl_path = job_dir / "Unit_1.asl"
    refine_out = col / args.ref / "CreepAnalysis" / args.job / "Max_creep_damage_Unit_1_t_last_refine.csv"
    workspace = types.SimpleNamespace(row_files_dir=col / "input" / args.rows)

    print(f"[regen] process_results on {asl_path}")
    _, averaged_dir, refine_df = ppu.process_results(
        workspace=workspace, asl_path=asl_path, solution_applet_job_dir=job_dir)
    refine_out.parent.mkdir(parents=True, exist_ok=True)
    refine_df.to_csv(refine_out, index=False)
    print(f"[regen] refine rows={len(refine_df)} -> {refine_out}")
    print(refine_df[["comp_aks_id", "part_name", "pigtail_group_id", "pigtail_id",
                     "max_creep_damage", "row_id", "pigtail_index"]].to_string())

    # Prune stale exos so nodal_average_year matches the compact's component set.
    z = zipfile.ZipFile(asl_path)
    d = json.loads(z.read("solutions/solution_0/component_system_solution_data.json"))
    keep = {c["component_id"] for c in d["component_solutions"]}
    removed = 0
    for f in glob.glob(str(Path(averaged_dir) / "*.exo")):
        cid = int(os.path.basename(f).split("_")[-1].split(".exo")[0])
        if cid not in keep:
            os.remove(f)
            removed += 1
    print(f"[regen] nodal_average_year pruned {removed} stale exos; kept {len(keep)}-comp set")


if __name__ == "__main__":
    main()
