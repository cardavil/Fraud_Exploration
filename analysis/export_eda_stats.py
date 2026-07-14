"""
Export the EDA's statistical results to app/data/eda_stats.json so the board
renders the exact figures computed here — one source, no client-side
reimplementation of statistics.

Run from the repo root: python analysis/export_eda_stats.py
"""
import json
import sqlite3

import numpy as np
import pandas as pd
from scipy import stats

OUT = "app/data/eda_stats.json"

con = sqlite3.connect("data/clean.db")
tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"])
c = pd.read_sql("SELECT * FROM customers", con)
a = pd.read_sql("SELECT * FROM accounts", con)
al = pd.read_sql("SELECT * FROM compliance_alerts", con, parse_dates=["alert_date"])
cb = pd.read_sql("SELECT * FROM chargebacks", con, parse_dates=["chargeback_date"])


def cramers_v(x, y):
    table = pd.crosstab(x, y)
    chi2, p, _, _ = stats.chi2_contingency(table)
    n = table.to_numpy().sum()
    v = float(np.sqrt(chi2 / (n * (min(table.shape) - 1))))
    return round(v, 3), float(p)


# ---------- descriptive stats (valid = non-null, positive amounts) ----------
amounts = tx.amount.dropna()
valid = amounts[amounts > 0]
descriptive = {
    "n_valid": int(len(valid)),
    "mean": round(float(valid.mean())),
    "median": round(float(valid.median())),
    "std": round(float(valid.std())),
    "cv": round(float(valid.std() / valid.mean()), 2),
    "skewness": round(float(stats.skew(valid, bias=False)), 2),
    "kurtosis_excess": round(float(stats.kurtosis(valid, bias=False)), 2),
    "p95": round(float(valid.quantile(0.95))),
    "max": round(float(valid.max())),
}

# ---------- structuring bands ($1k bands around the 10k threshold) ----------
bands = []
for lo in range(5000, 12000, 1000):
    n = int(((tx.amount >= lo) & (tx.amount < lo + 1000)).sum())
    bands.append({"band": f"{lo // 1000}-{lo // 1000 + 1}k", "lo": lo, "count": n})
band_9k = next(b["count"] for b in bands if b["lo"] == 9000)
neighbors = [b["count"] for b in bands if b["lo"] in (8000, 10000)]
structuring = {
    "bands": bands,
    "band_9k_count": band_9k,
    "band_9k_share": round(band_9k / len(valid), 3),  # share of valid-amount txns
    "ratio_vs_neighbors": round(band_9k / (sum(neighbors) / len(neighbors)), 1),
}

# ---------- monthly series ----------
def monthly(df, date_col, value_col=None):
    m = df.dropna(subset=[date_col]).copy()
    m["month"] = m[date_col].dt.to_period("M").astype(str)
    g = m.groupby("month")
    out = g.size().rename("count").to_frame()
    if value_col:
        out["value"] = g[value_col].sum().round()
    return [{"month": k, **{col: (int(v[col]) if col == "count" else float(v[col]))
                            for col in out.columns}} for k, v in out.iterrows()]

series = {
    "transactions": monthly(tx, "transaction_date", "amount"),
    "alerts": monthly(al, "alert_date"),
    "chargebacks": monthly(cb, "chargeback_date", "amount"),
}

# ---------- associations (Cramér's V) ----------
tx_cust = tx.merge(a[["account_id", "customer_id"]], on="account_id") \
            .merge(c[["customer_id", "risk_rating", "onboarding_channel"]], on="customer_id")
tx_cust["struct_zone"] = ((tx_cust.amount >= 9000) & (tx_cust.amount < 10000)).map(
    {True: "9k-10k", False: "other"})
pairs = [
    ("counterparty_country × flagged", tx.counterparty_country, tx.flagged_for_review),
    ("transaction_type × flagged", tx.transaction_type, tx.flagged_for_review),
    ("transaction_type × structuring-zone", tx_cust.transaction_type, tx_cust.struct_zone),
    ("risk_rating × flagged", tx_cust.risk_rating, tx_cust.flagged_for_review),
    # Transaction-level, like the original EDA: weights channels by activity.
    ("onboarding_channel × risk_rating", tx_cust.onboarding_channel, tx_cust.risk_rating),
]
associations = []
for label, x, y in pairs:
    v, p = cramers_v(x, y)
    associations.append({"pair": label, "cramers_v": v,
                         "p": round(p, 4) if p >= 0.0001 else 0.0})

# ---------- Spearman: risk rating vs observed behavior (per customer) ----------
rating_ord = {"Low": 1, "Medium": 2, "High": 3}
HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
per_cust = tx_cust.assign(
    hr=tx_cust.counterparty_country.isin(HIGH_RISK),
    flagged=tx_cust.flagged_for_review == "Yes",
    cash=tx_cust.transaction_type.str.contains("Cash"),
).groupby("customer_id").agg(
    n_tx=("transaction_id", "count"), pct_hr=("hr", "mean"),
    pct_flagged=("flagged", "mean"), pct_cash=("cash", "mean"),
    rating=("risk_rating", "first"),
)
per_cust["rating_ord"] = per_cust.rating.map(rating_ord)
spearman = []
for feat, label in [("n_tx", "transaction count"), ("pct_hr", "% high-risk-country"),
                    ("pct_flagged", "% flagged"), ("pct_cash", "% cash")]:
    rho, p = stats.spearmanr(per_cust.rating_ord, per_cust[feat])
    spearman.append({"feature": label, "rho": round(float(rho), 2), "p": round(float(p), 3)})

out = {"descriptive": descriptive, "structuring": structuring,
       "monthly": series, "associations": associations, "spearman_vs_rating": spearman}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)

print(f"Wrote {OUT}")
print("descriptive:", descriptive)
print("structuring:", {k: v for k, v in structuring.items() if k != "bands"})
print("associations:", [(x["pair"], x["cramers_v"]) for x in associations])
print("spearman:", [(s["feature"], s["rho"], s["p"]) for s in spearman])
