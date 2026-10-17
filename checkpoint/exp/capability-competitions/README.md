# CapabilityLab competition reference implementations

This folder connects two bounded Python experiment runners to the pinned CapabilityLab runtime: Name That LLM and NFL WR cut-recovery. The runner reports are imported as `capability-competition-report.v1`; native composed descriptors call the existing `ml.classificationMetrics`, `ml.regressionMetrics`, and `statistics.mean` capabilities. Evaluation executions include registry traces and deterministic replay receipts.

The browser's **Reference implementations** panel runs two tiny literal synthetic reports. The Name That LLM example has all 18 fixed labels and every actual class is supported. The NFL example keeps five play rows grouped under two players; it shows row-weighted regression metrics beside MAE and RMSE that first average plays within player and then give every player equal weight. Run and Replay act on the same native registry receipt. These examples show evaluation plumbing only: they do not train a model, fetch data, or provide competition evidence.

Full competition data and generated run evidence live in the [Drive folder](https://drive.google.com/drive/folders/17r9efXgPC-NRwLtMPj7EET3cZLXp6_bO). No full datasets or generated report files belong in Git or the browser bundle. Use local files and explicitly run the Python runner:

```sh
cd checkpoint
python3 --version  # validated with Python 3.12.14
python3 -m pip install -r exp/capability-competitions/requirements.txt
node exp/capability-competitions/cli.mjs list
node exp/capability-competitions/cli.mjs fixture
node exp/capability-competitions/cli.mjs run ntllm --train /path/to/train.csv
node exp/capability-competitions/cli.mjs run nfl --data-dir /path/to/csvs --drill "<drill name>" --route-family "<route label>"
node exp/capability-competitions/cli.mjs evaluate --report /path/to/report.json
```

The `fixture` command labels each run `synthetic-fixture`; both reports remain `inconclusive`, and the aggregate remains inconclusive even when execution and replay succeed. Missing real inputs produce a structured `blocked` report and a nonzero CLI exit. A completed real-data report still describes only its frozen experiment checks and does not establish a general scientific claim.

The report importer rejects unknown envelope properties, mismatched experiment/source metadata, malformed optional details/reason, blocked reports with an evaluation, and completed reports without one. An inconclusive report without evaluation remains a valid structured result. It checks array lengths, finite numeric cells, nonempty labels and group IDs, and the complete 18-class NTL taxonomy. It does not independently confirm external fitting, split construction, or file provenance; inspect the retained runner report and its detailed audit before treating any result as evidence.

The overlay is materialized during assembly from the immutable vendor snapshot and these new browser files. The vendor tree and its `SOURCE-PIN.json` remain unchanged.
