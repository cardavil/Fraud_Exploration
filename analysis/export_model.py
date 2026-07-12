"""
Export the trained Isolation Forest (same params/seed as analysis/anomaly.py)
plus the StandardScaler to app/data/isolation_forest.json so the board can run
inference in the browser (app/js/iforest.js).

Before writing, the script re-implements the scoring in pure Python from the
exported structure and requires |score_pure − score_sklearn| < 1e-9 on all
accounts — if a future sklearn changes internals, this fails loudly here, not
silently in the browser.

Run from the repo root: python analysis/export_model.py
"""
import json
import math
import pathlib
import sqlite3
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from account_features import build_features

con = sqlite3.connect("data/clean.db")
feat = build_features(con)

scaler = StandardScaler().fit(feat)
X = scaler.transform(feat)
iso = IsolationForest(n_estimators=300, contamination=0.08, random_state=42).fit(X)
sk_scores = -iso.score_samples(X)   # the pipeline's anomaly score (higher = worse)

model = {
    "features": list(feat.columns),
    "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
    "n_estimators": len(iso.estimators_),
    "max_samples": int(iso._max_samples),
    "offset": float(iso.offset_),   # anomalous ⇔ -score_samples > -offset
    "trees": [
        {
            "l": t.tree_.children_left.tolist(),
            "r": t.tree_.children_right.tolist(),
            "f": t.tree_.feature.tolist(),
            "t": t.tree_.threshold.tolist(),
            "n": t.tree_.n_node_samples.tolist(),
        }
        for t in iso.estimators_
    ],
    "estimators_features": [f.tolist() for f in iso.estimators_features_],
}


def avg_path_length(n):
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1.0) + 0.5772156649) - 2.0 * (n - 1.0) / n


def pure_score(x):
    """Re-implementation of sklearn's score from the exported dict only."""
    depths = 0.0
    for tree, feats in zip(model["trees"], model["estimators_features"]):
        node, path_nodes = 0, 1
        while tree["l"][node] != -1:
            xv = x[feats[tree["f"][node]]]
            node = tree["l"][node] if xv <= tree["t"][node] else tree["r"][node]
            path_nodes += 1
        depths += (path_nodes - 1.0) + avg_path_length(tree["n"][node])
    denom = model["n_estimators"] * avg_path_length(model["max_samples"])
    return 2.0 ** (-depths / denom)


worst = max(abs(pure_score(X[i]) - sk_scores[i]) for i in range(len(X)))
if worst >= 1e-9:
    sys.exit(f"FIDELITY CHECK FAILED: max |pure − sklearn| = {worst}")

with open("app/data/isolation_forest.json", "w", encoding="utf-8") as f:
    json.dump(model, f)

import os
size_mb = os.path.getsize("app/data/isolation_forest.json") / 1e6
print(f"Fidelity check OK (max diff {worst:.2e}); wrote isolation_forest.json ({size_mb:.2f} MB)")
