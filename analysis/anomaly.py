"""
Tier 2 — account-level anomaly detection (Isolation Forest).
Input:  data/clean.db + outputs/transaction_scores.csv (tier 1)
Output: outputs/account_features_scores.csv, outputs/anomalous_accounts.csv

Features come from analysis/account_features.py (single source, mirrored by
the browser scorer): 12 behavioral aggregates + 4 tier-1/dynamics features
(pct_txn_anomalous, max_txn_score, max_day_share, recent_intensity) so a
single extreme transaction or a burst no longer dilutes into averages.
"""
import pathlib
import sqlite3
import sys

import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from account_features import build_features

con = sqlite3.connect("data/clean.db")
c = pd.read_sql("SELECT * FROM customers", con)
a = pd.read_sql("SELECT * FROM accounts", con)
al = pd.read_sql("SELECT * FROM compliance_alerts", con)

try:  # report the delta against the previous run, if one exists
    previous = set(pd.read_csv("outputs/anomalous_accounts.csv").account_id)
except FileNotFoundError:
    previous = set()

feat = build_features(con)
X = StandardScaler().fit_transform(feat)
iso = IsolationForest(n_estimators=300, contamination=0.08, random_state=42)
feat["anomaly"] = iso.fit_predict(X)
feat["score"] = -iso.score_samples(X)  # higher = more anomalous

alerted = set(al.account_id)
out = (
    feat.reset_index()
    .merge(a[["account_id", "customer_id", "status", "branch_country"]], on="account_id")
    .merge(c[["customer_id", "full_name", "risk_rating", "pep_flag"]], on="customer_id")
)
out["has_alert"] = out.account_id.isin(alerted)

out.to_csv("outputs/account_features_scores.csv", index=False)
anom = out[out.anomaly == -1].sort_values("score", ascending=False)
anom.to_csv("outputs/anomalous_accounts.csv", index=False)

current = set(anom.account_id)
print(f"{len(anom)} anomalous accounts of {len(out)}; "
      f"{(~anom.has_alert).sum()} never alerted")
if previous:
    print(f"delta vs previous run: entered={sorted(current - previous)} "
          f"left={sorted(previous - current)}")
print(anom[["account_id", "risk_rating", "status", "n_tx", "total",
            "pct_txn_anomalous", "max_day_share", "score", "has_alert"]]
      .round(2).to_string(index=False))
