---
name: smr_pigtail_compact_regold
description: "Rebuild the compact test ASLs and re-gold the pigtail screenshots for the smr_outlet_pigtail test collection (akselos-testing/smr/test_smr_outlet_pigtail), e.g. when new full-model Unit_1 ASLs or Row CSVs arrive. Covers: reducing a full solution ASL to a small self-consistent compact, regenerating nodal_average_year + refine fixtures, and re-rendering the vm/cr gold images (train-1 = 3 components, train-2 = 4 with the reducer). Use whenever the task mentions smr_outlet_pigtail compacts/fixtures/gold images, the AKS-21093 reducer-screenshot work, 'redo the compact ASL', 'regenerate the pigtail screenshots/gold', or updating the SMR outlet pigtail Row files. Ticket: AKS-21093."
---

# SMR outlet pigtail — compact ASL + screenshot re-gold

This skill rebuilds the test fixtures for `data/collections/akselos-testing/smr/test_smr_outlet_pigtail`
after new source data arrives, and re-renders the pigtail gold images. There are **two trains**:

| Train | Row files | ref dir | job (`<date>_<short_job_id>`) | components framed |
|-------|-----------|---------|-------------------------------|-------------------|
| train-1 | `row_files_train_1` | `ref_results` | `20250701_1778840002` | 3 (Weld/Bend/Hanger, **no reducer**) |
| train-2 | `row_files_train_2` | `ref_results_train_2` | `20260331_1785070922` | 4 (+ **Reducer**) |

The ticket goal (AKS-21093): the train-2 creep/von-Mises pigtail screenshots must **frame the reducer**.
The reducer is **render-only** — excluded from the compute path (`create_component_to_metadata` uses the
3-column default), included in the render frame via `SCREENSHOT_COLUMN_NAMES`. The pigtail is framed
centred (horizontally on its centroid) and vertically balanced, with the colour-bar legend on the right;
see the framing / gotchas below.

All Python runs use the WSL Linux venv from `/mnt/e/.../akselos-dev-2`:
`PYTHONPATH=tools .venv-linux/bin/python`. GL renders need `xvfb-run`. `/mnt/e` is slow — a full render is
~5–8 min. Do **not** touch anything under `scrbe/`.

## Inputs (from the user, typically in `C:\Users\User\Downloads`)

- Full train-1 ASL (e.g. `Unit_1 (1).asl`) and full train-2 ASL (e.g. `Unit_1_nodal_average.asl`).
  These are whole-train solutions but **already `model == solution`** (every component has a solution exo).
- Row CSV zips `row_files_train_1.zip` / `row_files_train_2.zip`, each with `Row.csv`/`Row1.csv`/`Row2.csv`.
  4 pigtails (No 1/18/53/68). Train-2 has an extra `Reducer` column.

Sanity-check a source ASL before using it (should print `model == exos: True`):
```python
import zipfile, json
z = zipfile.ZipFile(ASL); n = z.namelist()
exos = {int(x.split('component_')[-1].split('.exo')[0]) for x in n if 'component_solutions' in x and x.endswith('.exo')}
d = json.loads(z.read('solutions/solution_0/component_system_solution_data.json'))
model = {c['component_id'] for c in d['akselos_assembly']['component_system']['components']}
print('model==exos:', model == exos, '| 1 in exos:', 1 in exos, '| n:', len(model))
```

## Workflow

Run the steps in order. Steps 1–3 are GL-free (fast); step 5 needs GL.

### 1. Enable collection resolution (directory junctions)

The compact ASL keeps its embedded collection ref (`ShellQatar/Pearl_GTL/LPU/SMR_Dashboard_Integration`
for train-1, `..._Train_2` for train-2). Loading/rendering it needs that collection to resolve to the test
collection's component types (`components/` flat for train-1, `components/study_200_1mm/` for train-2 — both
already present). Create Windows directory junctions once (idempotent; safe to leave in place):

```bash
B='E:\akselos-dev-3.10\data\collections'
T="$B\\akselos-testing\\smr\\test_smr_outlet_pigtail"
cmd.exe //c mklink //J "$B\\ShellQatar\\Pearl_GTL\\LPU\\SMR_Dashboard_Integration" "$T"
cmd.exe //c mklink //J "$B\\ShellQatar\\Pearl_GTL\\LPU\\SMR_Dashboard_Integration_Train_2" "$T"
```
(`akselos-dev-2/data/collections` is itself a junction onto `akselos-dev-3.10/data/collections`, so both
paths point at the same store.)

### 2. Build the compact ASLs

`scripts/build_compact.py` reduces each full ASL to the 4 test pigtails + structural backbone. See the
script header for *why* it's a scripted zip-prune (the SDK `delete_entities_command` doesn't persist into a
saved solution; a hand-strip is only unsafe on `model != solution` sources, which these are not). Plain
CPython — no SDK:
```bash
python scripts/build_compact.py "<full_train1>.asl" <row1>/Row.csv  _out/compact_train1.asl
python scripts/build_compact.py "<full_train2>.asl" <row2>/Row.csv  _out/compact_train2.asl
```
Each prints `keep=… delete=…`, the kept reducer ids (train-2 only), and a `VERIFY ok` line
(`model==exos==component_solutions`, `component_1` present, <2 GiB). Expect ~36 comps/~0.44 GB (train-1),
~45 comps/~0.52 GB (train-2).

### 3. Install into the collection

Copy the new Row CSVs and compacts into place (all four ASL destinations use the same per-train compact):
```
input/row_files_train_1/{Row,Row1,Row2}.csv               <- new train-1 Row CSVs
input/row_files_train_2/{Row,Row1,Row2}.csv               <- new train-2 Row CSVs (with Reducer column)
aks_files/saved_asl_for_automation_test/Unit_1_nodal_average.asl            <- compact_train1
aks_files/saved_asl_for_automation_test_train_2/Unit_1_nodal_average.asl    <- compact_train2
ref_results/CreepAnalysis/results/20250701_1778840002/Unit_1.asl            <- compact_train1
ref_results_train_2/CreepAnalysis/results/20260331_1785070922/Unit_1.asl    <- compact_train2
```

### 4. Regenerate the derived fixtures (GL-free)

`scripts/regen_fixtures.py` runs `process_results` to (re)write `Unit_1_nodal_average_year/` and the
`Max_creep_..._t_last_refine.csv` next to each compact, then prunes stale exos from the nodal dir. Run once
per train (WSL):
```bash
PYTHONPATH=tools .venv-linux/bin/python scripts/regen_fixtures.py \
    --collection /mnt/e/akselos-dev-3.10/data/collections/akselos-testing/smr/test_smr_outlet_pigtail \
    --ref ref_results_train_2 --job 20260331_1785070922 --rows row_files_train_2
# train-1: --ref ref_results --job 20250701_1778840002 --rows row_files_train_1
```
The refine CSV must have `row_id` = 1,1,2,2 and `pigtail_group_id` = 401,403,402,402 for pigtails 1,18,53,68.
If `row_id` is all 1, the **Group_ID header bug** (see Gotchas) has regressed — fix it before rendering, or
the Row-2 pigtails (53, 68) render blank.

**Verify the Row-CSV reducer ids** against the model before trusting them — a user-supplied Reducer column
can be wrong. Each pigtail's reducer must be the one that physically docks to its hanger (a port_constraint),
otherwise it renders detached/floating next to the tube. Check with the source ASL:
```python
import zipfile, json, collections
z = zipfile.ZipFile(SRC); d = json.loads(z.read('solutions/solution_0/component_system_solution_data.json'))
cs = d['akselos_assembly']['component_system']
typeof = {c['component_id']: c['ref_component_type'].split('/')[-1] for c in cs['components']}
edges = collections.defaultdict(set)
for pc in cs['port_constraints']:
    ids = [p['component_id'] for p in pc.get('port_id_data', [])]
    for a in ids:
        for b in ids:
            if a != b: edges[a].add(b)
# for each pigtail's Hanger id, the docked reducer is:
for hanger in HANGER_IDS:
    print(hanger, [n for n in edges[hanger] if 'reducer' in typeof[n]])
```
(This is how the AKS-21093 pigtail-18 fix was found: Row said reducer 477, but hanger 128 docks 478.)

### 5. Re-gold the screenshots (GL / WSL)

Use `scripts/regold_direct.py` — it renders in place and is stable. **Do not** use the `test_regold_*`
temp-collection path (it rewrites the ~0.5 GB ASL and crashes the GL process here). Kill any stale X server
first, then run one train at a time:
```bash
wsl.exe -e bash -lc "pkill -9 -f Xvfb 2>/dev/null; rm -f /tmp/.X*-lock; sleep 1"
xvfb-run -a env PYTHONPATH=tools .venv-linux/bin/python scripts/regold_direct.py \
    --collection /mnt/e/.../test_smr_outlet_pigtail --date 20260331 --job 1785070922 \
    --ref ref_results_train_2 --rows row_files_train_2
# train-1: --date 20250701 --job 1778840002 --ref ref_results --rows row_files_train_1
```
Each writes 8 PNGs (4 pigtails × vm/cr) into `<ref>/Bigquery/images/Unit_1/`. Run trains **sequentially** —
back-to-back `xvfb-run` invocations in one shell tend to collide on the X display.

### 6. Verify (always look at the images)

Open a few gold PNGs and confirm:
- **train-2**: each pigtail shows the tube **plus the reducer** (a widened cylinder/cap at the top) and a
  colour bar; the max-marker red circle is present.
- **train-1**: 3 components, **no reducer**; colour bar present.
- Non-blank geometry (a ~4 KB PNG is a blank render — investigate, don't ship it).
- The reducer sits **on** the tube top (not floating beside it — that's the reducer-id bug above).
- The tube is horizontally centred and vertically balanced (tip a little below the colour-bar top; the
  triad in the corner is close under the geometry, not stranded); nothing clipped off an edge.
- 8 images per train, filenames carry pigtail indices `1/18/53/68` (not the old `16/26/27/37`).

## Gotchas (each of these caused a real failure — keep them in mind)

- **Group_ID vs Pigtail_Group_ID** — `row_tube_utils.create_component_to_metadata` must read the pigtail
  group id from `Pigtail_Group_ID` *or* `Group_ID` (the updated Row/Row2 files use `Group_ID`). If it only
  reads `Pigtail_Group_ID`, every pigtail collapses to `row_id=1`, the render's `(row_id, pigtail_index)`
  lookup misses the Row-2 pigtails, and 53/68 render **blank**.
- **SDK delete doesn't persist** — deleting from a loaded `.asl` solution's component_system and re-saving
  keeps the full component set. Reduce via `build_compact.py`, not the model journal.
- **Compact must stay < 2 GiB** — keeps it under Mercurial's largefile limit so it clones through the normal
  test path; `build_compact.py` asserts this.
- **Colour bar** — off by default. The pigtail screenshots draw the legend only because
  `input/screenshots/screenshot_inputs.json` has `"show_color_bar": true` on both `simplified_screenshot_infos`
  (the displacement template already had it on). `color_bar_indices` only selects *which bounds colour the
  geometry*, not the legend.
- **Framing (centre + balance)** — `smr_screenshot_utils.generate_smr_screenshots` centres each pigtail via
  `offset_in_model_space = [0.0, 0.0, -0.20]` (subtracted from the coord mean; model +Z = screen up). `x=y=0`
  keeps it **horizontally centred** on its centroid — the legacy `-0.20/+0.20` nudge was tuned for an older
  model and shifts the current pigtails left. The small `-0.20` Z keeps it **vertically balanced**: the tube
  fills down toward the bottom so the corner orientation triad isn't stranded above a big empty gap, and the
  tip sits a little below the colour-bar top. Do NOT lift it further to make the tip exactly meet the bar —
  that empties the lower canvas and strands the triad (the user rejected that). Retune with the fast loop
  below only if the geometry changes.
- **Flaky GL / Xvfb** — renders occasionally die with no traceback (log stops after `collected 1 item`, or
  `Cannot establish any listening sockets`). It's the temp-collection ASL rewrite or a stale X server, not
  your data. Use `regold_direct.py`, `pkill -9 -f Xvfb` + `rm -f /tmp/.X*-lock` between runs, and retry.
- **hg largefiles on commit** — `.exo` is auto-largefile in this collection; a `.asl` over the pattern needs
  `hg add --large`. Commit code (git) and collection (hg) separately.

## Fast camera-tuning loop (only if you must retune the lift)

Rendering all 4 pigtails via the full path is slow. To tune `offset_in_model_space`, temporarily make it
env-driven in `smr_screenshot_utils.py`
(`offset_in_model_space = np.array([float(v) for v in os.environ["SMR_OFFSET"].split(",")])`) and render
just 1–2 pigtails straight from the installed collection (~4 min): a tiny script that calls
`generate_smr_screenshots` with a 1–2-row refine dataframe filtered to the pigtails of interest, output to a
scratch dir, then view the PNGs. Pick pigtails of different heights (e.g. a tall 53 and a short 18) so one
offset doesn't clip the other. Once dialled in, hardcode the value and remove the env hook.

## Commit

Use ticket **AKS-21093** in the subject; per user convention, no `Co-authored-by` trailer. Code changes go
to git (row_tube_utils, smr_screenshot_utils, tests); the collection (Row CSVs, compact ASLs,
nodal_average_year, refine CSVs, gold PNGs, plus the deletions of stale old-pigtail files) goes to hg.
