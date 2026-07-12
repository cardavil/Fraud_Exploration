"""
Account-level anomaly detection — Isolation Forest.
Input:  data/clean.db (produced by clean.py)
Output: outputs/account_features_scores.csv, outputs/anomalous_accounts.csv

Features are behavioral, per account:
volume, amount mean/std/max, total value, % high-risk-country counterparties,
% offshore, % cash, % structuring-zone (9,000-9,999), % international,
transaction velocity and value velocity per month.
"""
import sqlite3
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
OFFSHORE = {"Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"}

con = sqlite3.connect("data/clean.db")
c = pd.read_sql("SELECT * FROM customers", con)
a = pd.read_sql("SELECT * FROM accounts", con)
tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"])
al = pd.read_sql("SELECT * FROM compliance_alerts", con)

tx["hr"] = tx.counterparty_country.isin(HIGH_RISK)
tx["off"] = tx.counterparty_country.isin(OFFSHORE)
tx["cash"] = tx.transaction_type.str.contains("Cash")
tx["struct"] = (tx.amount >= 9000) & (tx.amount < 10000)
tx["intl"] = tx.is_international == "Yes"

span = tx.groupby("account_id").transaction_date.agg(lambda s: (s.max() - s.min()).days + 1)
feat = tx.groupby("account_id").agg(
    n_tx=("transaction_id", "count"),
    avg_amt=("amount", "mean"),
    std_amt=("amount", "std"),
    max_amt=("amount", "max"),
    total=("amount", "sum"),
    pct_hr=("hr", "mean"),
    pct_off=("off", "mean"),
    pct_cash=("cash", "mean"),
    pct_struct=("struct", "mean"),
    pct_intl=("intl", "mean"),
).fillna(0)
feat["tx_per_month"] = feat.n_tx / (span / 30.44)
feat["velocity_value"] = feat.total / (span / 30.44)

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
print(f"{len(anom)} anomalous accounts of {len(out)}; "
      f"{(~anom.has_alert).sum()} never alerted")
print(anom[["account_id", "full_name", "risk_rating", "status",
            "n_tx", "total", "pct_hr", "pct_cash", "score", "has_alert"]]
      .round(2).to_string(index=False))
