"""
Isolation Forest parameter sensitivity sweep for the board's ML section.
Grid: contamination x n_estimators. For each configuration: how many accounts
flag as anomalous, and how stable the ranking is versus the base configuration
(Jaccard overlap of the top-5 by score, plus overlap with the base anomaly set).

Feature engineering mirrors analysis/anomaly.py (same columns, same encoding).
Output: app/data/model_sensitivity.json

Run from the repo root: python analysis/model_sensitivity.py
"""
import json
import sqlite3

import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
OFFSHORE = {"Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"}
BASE = {"contamination": 0.08, "n_estimators": 300}
GRID_CONTAMINATION = [0.04, 0.06, 0.08, 0.10, 0.12]
GRID_ESTIMATORS = [100, 300, 500]
SEED = 42

con = sqlite3.connect("data/clean.db")
tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"])
al = pd.read_sql("SELECT * FROM compliance_alerts", con)

tx["hr"] = tx.counterparty_country.isin(HIGH_RISK)
tx["off"] = tx.counterparty_country.isin(OFFSHORE)
tx["cash"] = tx.transaction_type.str.contains("Cash")
tx["struct"] = (tx.amount >= 9000) & (tx.amount < 10000)
tx["intl"] = tx.is_international == "Yes"

span = tx.groupby("account_id").transaction_date.agg(lambda s: (s.max() - s.min()).days + 1)
feat = tx.groupby("account_id").agg(
    n_tx=("transaction_id", "count"), avg_amt=("amount", "mean"),
    std_amt=("amount", "std"), max_amt=("amount", "max"), total=("amount", "sum"),
    pct_hr=("hr", "mean"), pct_off=("off", "mean"), pct_cash=("cash", "mean"),
    pct_struct=("struct", "mean"), pct_intl=("intl", "mean"),
).fillna(0)
feat["tx_per_month"] = feat.n_tx / (span / 30.44)
feat["velocity_value"] = feat.total / (span / 30.44)
X = StandardScaler().fit_transform(feat)
alerted = set(al.account_id)


def run(contamination, n_estimators):
    iso = IsolationForest(n_estimators=n_estimators, contamination=contamination,
                          random_state=SEED)
    pred = iso.fit_predict(X)
    score = -iso.score_samples(X)
    df = pd.DataFrame({"account_id": feat.index, "anomaly": pred, "score": score})
    anoms = df[df.anomaly == -1].sort_values("score", ascending=False)
    return set(anoms.account_id), list(anoms.account_id[:5])


def jaccard(a, b):
    a, b = set(a), set(b)
    return round(len(a & b) / len(a | b), 2) if a | b else 1.0


base_set, base_top5 = run(**BASE)
grid = []
for cont in GRID_CONTAMINATION:
    for n_est in GRID_ESTIMATORS:
        anom_set, top5 = run(cont, n_est)
        grid.append({
            "contamination": cont, "n_estimators": n_est,
            "n_anomalies": len(anom_set),
            "jaccard_top5_vs_base": jaccard(top5, base_top5),
            "overlap_with_base_set": len(anom_set & base_set),
            "never_alerted": len(anom_set - alerted),
        })

out = {
    "base": {**BASE, "seed": SEED, "n_accounts": len(feat),
             "n_anomalies": len(base_set),
             "never_alerted": len(base_set - alerted),
             "top5": base_top5},
    "grid": grid,
    "features": list(feat.columns),
}
with open("app/data/model_sensitivity.json", "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)

print("base:", out["base"])
for g in grid:
    print(g)
