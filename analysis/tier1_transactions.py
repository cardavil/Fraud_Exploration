"""
Tier 1 — transaction-level anomaly detection.

Scores every individual transaction with contextual features (each one doubles
as a human-readable reason code): how unusual the amount is FOR ITS OWN
ACCOUNT, proximity to the $10k reporting threshold, geography, cash, whether
the account should even be transacting, burst timing and counterparty novelty.
This catches the needles that account-level aggregates dilute.

Outputs:
  outputs/transaction_scores.csv   (features + score + anomaly flag)
  app/data/tier1_validation.json   (bootstrap confidence, seed stability,
                                    contamination sweep, convergence vs rules)

Run from the repo root: python analysis/tier1_transactions.py
"""
import json
import sqlite3

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
OFFSHORE = {"Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"}
PARAMS = {"n_estimators": 300, "contamination": 0.05, "random_state": 42}
RNG = np.random.default_rng(42)

con = sqlite3.connect("data/clean.db")
tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"])
acc = pd.read_sql("SELECT account_id, status FROM accounts", con)
tx = tx.merge(acc, on="account_id").sort_values(["account_id", "transaction_date"])

amount = tx.amount.fillna(0)
acct_median = tx.groupby("account_id").amount.transform("median").replace(0, np.nan)
gap = tx.groupby("account_id").transaction_date.diff().dt.days

feat = pd.DataFrame({
    "transaction_id": tx.transaction_id,
    "log_amount": np.log1p(amount.clip(lower=0)),
    "rel_amount": (amount / acct_median).fillna(1.0).clip(upper=50),
    "band_9k": ((tx.amount >= 9000) & (tx.amount < 10000)).astype(int),
    "hr_country": tx.counterparty_country.isin(HIGH_RISK).astype(int),
    "offshore": tx.counterparty_country.isin(OFFSHORE).astype(int),
    "cash": tx.transaction_type.str.contains("Cash").astype(int),
    "nonactive_status": tx.status.isin(["Closed", "Dormant", "Frozen"]).astype(int),
    "days_since_prev_txn": gap.fillna(gap.median()).clip(upper=90),
    "same_day_txns": tx.groupby(["account_id", tx.transaction_date.dt.date])
                       .transaction_id.transform("count"),
    "counterparty_novelty": (~tx.duplicated(["account_id", "counterparty_name"])).astype(int),
    "intl_mismatch": (tx.counterparty_country.isin(HIGH_RISK)
                      & (tx.is_international == "No")).astype(int),
}).set_index("transaction_id")

X = StandardScaler().fit_transform(feat)
iso = IsolationForest(**PARAMS).fit(X)
scores = -iso.score_samples(X)
pred = iso.predict(X)

out = feat.reset_index()
out["score"] = np.round(scores, 6)
out["anomaly"] = pred
out["account_id"] = tx.account_id.values
out["amount"] = tx.amount.values
out["flagged_by_rules"] = (tx.flagged_for_review == "Yes").astype(int).values
out.to_csv("outputs/transaction_scores.csv", index=False)

anom = out[out.anomaly == -1]
jaccard = lambda a, b: len(a & b) / len(a | b) if a | b else 1.0
base_set = set(anom.transaction_id)

# ---------- validation ----------
included = np.zeros(len(X))
flagged = np.zeros(len(X))
for _ in range(100):
    idx = RNG.choice(len(X), size=int(len(X) * 0.8), replace=False)
    m = IsolationForest(**PARAMS).fit(X[idx])
    included[idx] += 1
    flagged[idx[m.predict(X[idx]) == -1]] += 1
freq = np.divide(flagged, included, out=np.zeros_like(flagged), where=included > 0)
base_mask = out.anomaly.to_numpy() == -1
stable_share = float((freq[base_mask] >= 0.8).mean())

seed_j = [jaccard(set(out.transaction_id[IsolationForest(**{**PARAMS, "random_state": s})
          .fit(X).predict(X) == -1]), base_set) for s in range(20)]

sweep = []
for c in (0.02, 0.05, 0.08):
    m = IsolationForest(**{**PARAMS, "contamination": c}).fit(X)
    s = set(out.transaction_id[m.predict(X) == -1])
    sweep.append({"contamination": c, "n_anomalies": len(s),
                  "jaccard_vs_base": round(jaccard(s, base_set), 2)})

overlap = int(anom.flagged_by_rules.sum())
validation = {
    "n_flagged": len(anom),
    "value_flagged": round(float(anom.amount.sum())),
    "bootstrap": {"n_iterations": 100, "share_of_detections_stable": round(stable_share, 2)},
    "seed_stability": {"n_seeds": 20, "jaccard_mean": round(float(np.mean(seed_j)), 2),
                       "jaccard_min": round(float(np.min(seed_j)), 2)},
    "contamination_sweep": sweep,
    "convergence_vs_rules": {
        "flagged_by_both": overlap,
        "model_only": len(anom) - overlap,
        "rules_flag_rate_overall": round(float(out.flagged_by_rules.mean()), 2),
        "note": "partial overlap is the design goal: the rules are geography/type-driven; "
                "tier 1 adds amount-context, burst timing and account-status needles",
    },
    "top_needles_outside_rules": [
        {"transaction_id": r.transaction_id, "account_id": r.account_id,
         "amount": r.amount, "score": round(r.score, 4)}
        for r in anom[anom.flagged_by_rules == 0].nlargest(5, "score").itertuples()
    ],
}
with open("app/data/tier1_validation.json", "w", encoding="utf-8") as f:
    json.dump(validation, f, indent=1)

print(f"tier1: {len(anom)} anomalous txns (${anom.amount.sum():,.0f})")
print(f"  stable detections (freq>=0.8): {stable_share:.0%} | seed jaccard {np.mean(seed_j):.2f}/{np.min(seed_j):.2f}")
print(f"  overlap with rules: {overlap}/{len(anom)} | model-only needles: {len(anom) - overlap}")
print("  top model-only:", [(t['transaction_id'], t['amount']) for t in validation['top_needles_outside_rules'][:3]])
