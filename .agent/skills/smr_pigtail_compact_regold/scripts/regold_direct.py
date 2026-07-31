# Copyright (C) 2026 Akselos
"""Re-gold one train's pigtail screenshots by rendering straight from the installed
collection (GL/WSL), then copying the 8 PNGs into `<ref>/Bigquery/images/Unit_1/`.

This renders directly from the installed compact ASL (whose embedded collection ref,
e.g. `ShellQatar/.../SMR_Dashboard_Integration`, must resolve — see SKILL.md on the
directory junctions). It deliberately avoids the `test_regold_*` temp-collection path:
that clones a temp collection and rewrites the ~0.5 GB ASL via
`rename_collection_in_asl_files`, which is slow and, in this WSL box, crashes the GL
process partway through. Rendering in place is faster and stable.

`generate_smr_screenshots` frames Weld/Bend/Hanger [+ Reducer] per pigtail and, because
`show_color_bar` is enabled in the screenshot template, draws the von-Mises / creep
colour bar. The camera lift in smr_screenshot_utils aligns each tube's top tip with the
top of that bar (a larger lift for the 4-component reducer frame than the 3-component one).

Run in WSL under a fresh X server (kill stale Xvfb + clear /tmp/.X*-lock first if a
previous run died):
    xvfb-run -a env PYTHONPATH=tools .venv-linux/bin/python regold_direct.py \
        --collection <abs collection path> --date 20260331 --job 1785070922 \
        --ref ref_results_train_2 --rows row_files_train_2
"""
import argparse
import shutil
from pathlib import Path

import pandas as pd

import set_akselos_path  # noqa: F401
import applet_scripts.smr_outlet_pigtail.smr_screenshot_utils as ssu
import applet_scripts.smr_outlet_pigtail.workspace as ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", required=True)
    ap.add_argument("--date", required=True, help="sensor_date_str, e.g. 20260331")
    ap.add_argument("--job", required=True, help="short_job_id, e.g. 1785070922")
    ap.add_argument("--ref", required=True, help="ref_results or ref_results_train_2")
    ap.add_argument("--rows", required=True, help="row_files_train_1 or row_files_train_2")
    ap.add_argument("--out", default="/tmp/regold_out", help="scratch render dir")
    args = ap.parse_args()

    col = Path(args.collection)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    workspace = ws.Workspace(
        is_running_whatif=False,
        collection_dir=col,
        restart_data_dir=col,
        pi_tags_file=col / "dummy_pi_tags.json",
        row_files_dir=col / "input" / args.rows,
        input_sectional_creep_dir=col,
        dow_and_iow_properties=col,
        big_query_dir=col,
        creep_analysis_dir=out,
        queried_operational_sensordata_dir=col,
        sensor_data_processing_dir=col,
    )
    job = f"{args.date}_{args.job}"
    asl_path = col / args.ref / "CreepAnalysis" / "results" / job / "Unit_1.asl"
    refine = pd.read_csv(col / args.ref / "CreepAnalysis" / job / "Max_creep_damage_Unit_1_t_last_refine.csv")

    ssu.generate_smr_screenshots(
        workspace=workspace, asl_path=asl_path, refine_dataframe=refine,
        sensor_date_str=args.date, short_job_id=args.job, unit=1)

    out_dir = workspace.get_unit_results_dir(args.date, args.job, 1)
    imgs = list(out_dir.glob("*-vm.png")) + list(out_dir.glob("*-cr.png"))
    assert len(imgs) == 8, f"expected 8 pigtail images, got {len(imgs)}"

    dst = col / args.ref / "Bigquery" / "images" / "Unit_1"
    dst.mkdir(parents=True, exist_ok=True)
    for p in imgs:
        shutil.copyfile(p, dst / p.name)
    print(f">> re-golded {len(imgs)} images into {dst}")


if __name__ == "__main__":
    main()
