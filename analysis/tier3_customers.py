"""
Tier 3 — customer-level anomaly detection. The customer is the legal subject
(SARs are filed on people, not accounts) and the only level where cross-account
schemes are visible: structuring split across the customer's own accounts,
total exposure, activity after a confirmed sanctions match, screening gaps.

Input:  data/clean.db + outputs/transaction_scores.csv + outputs/account_features_scores.csv
Output: outputs/customer_scores.csv + app/data/tier3_validation.json

Run from the repo root: python analysis/tier3_customers.py
"""
import json
import sqlite3

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
PARAMS = {"n_estimators": 300, "contamination": 0.08, "random_state": 42}
RNG = np.random.default_rng(42)

con = sqlite3.connect("data/clean.db")
c = pd.read_sql("SELECT * FROM customers", con)
a = pd.read_sql("SELECT account_id, customer_id, status FROM accounts", con)
tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"]) \
       .merge(a, on="account_id")
sc = pd.read_sql("SELECT * FROM sanctions_screening", con)
t1 = pd.read_csv("outputs/transaction_scores.csv")
t2 = pd.read_csv("outputs/account_features_scores.csv")

tx = tx.merge(t1[["transaction_id", "score", "anomaly"]]
              .rename(columns={"score": "t1_score", "anomaly": "t1_anomaly"}), on="transaction_id")

# cross-account structuring: customer-days summing >= $10k, every txn under, > 1 account
def structuring_days(g):
    days = 0
    for _, day in g.dropna(subset=["amount"]).groupby(g.transaction_date.dt.date):
        if day.amount.sum() >= 10000 and (day.amount < 10000).all() and day.account_id.nunique() > 1:
            days += 1
    return days

by_cust = tx.groupby("customer_id")
value = by_cust.amount.sum()
hr_value = tx[tx.counterparty_country.isin(HIGH_RISK)].groupby("customer_id").amount.sum()
nonactive_value = tx[tx.status.isin(["Closed", "Dormant", "Frozen"])].groupby("customer_id").amount.sum()

match_dates = sc[sc.match_result == "Confirmed Match"].groupby("customer_id").screening_date.min()
post_match = []
for cust, mdate in match_dates.items():
    g = tx[(tx.customer_id == cust) & (tx.transaction_date > pd.Timestamp(mdate))]
    post_match.append((cust, g.amount.sum()))
post_match = pd.Series(dict(post_match), name="post_match_value")

feat = pd.DataFrame({
    "n_accounts": a.groupby("customer_id").size(),
    "n_anomalous_accounts": t2[t2.anomaly == -1].groupby("customer_id").size(),
    "max_account_score": t2.groupby("customer_id").score.max(),
    "total_value": value,
    "pct_txn_anomalous": by_cust.t1_anomaly.apply(lambda s: (s == -1).mean()),
    "max_txn_score": by_cust.t1_score.max(),
    "structuring_days": by_cust.apply(structuring_days, include_groups=False),
    "hr_value_share": (hr_value / value),
    "nonactive_value_share": (nonactive_value / value),
    "risk_ordinal": c.set_index("customer_id").risk_rating.map({"Low": 1, "Medium": 2, "High": 3}),
    "pep": c.set_index("customer_id").pep_flag.map({"Yes": 1, "Unknown": 0.5, "No": 0}),
    "never_screened": (~c.customer_id.isin(set(sc.customer_id))).astype(int).set_axis(c.customer_id),
    "post_match_value": post_match,
}).reindex(c.customer_id).fillna(0)

# Customers with no accounts/activity have no behavior to model: score only the
# active book and surface the KYC-only records as a data finding, not "risk".
kyc_only = feat[feat.n_accounts == 0].index
feat = feat[feat.n_accounts > 0]

X = StandardScaler().fit_transform(feat)
iso = IsolationForest(**PARAMS).fit(X)
feat["anomaly"] = iso.predict(X)
feat["score"] = np.round(-iso.score_samples(X), 6)

out = feat.reset_index().merge(c[["customer_id", "full_name", "nationality"]], on="customer_id")
out.to_csv("outputs/customer_scores.csv", index=False)
anom = out[out.anomaly == -1].sort_values("score", ascending=False)

# ---------- validation + cross-tier coherence ----------
jaccard = lambda x, y: len(x & y) / len(x | y) if x | y else 1.0
base_set = set(anom.customer_id)
seed_j = [jaccard(set(out.customer_id[IsolationForest(**{**PARAMS, "random_state": s})
          .fit(X).predict(X) == -1]), base_set) for s in range(20)]
included = np.zeros(len(X)); flagged = np.zeros(len(X))
for _ in range(100):
    idx = RNG.choice(len(X), size=int(len(X) * 0.8), replace=False)
    m = IsolationForest(**PARAMS).fit(X[idx])
    included[idx] += 1
    flagged[idx[m.predict(X[idx]) == -1]] += 1
freq = np.divide(flagged, included, out=np.zeros_like(flagged), where=included > 0)

anom_account_customers = set(t2[t2.anomaly == -1].customer_id)
rho, rho_p = stats.spearmanr(out.score, out.max_account_score)
ranked = out.sort_values("score", ascending=False).customer_id.tolist()
ranks = {cust: ranked.index(cust) + 1 for cust in anom_account_customers}
coverage_top15 = sum(1 for r in ranks.values() if r <= 15) / len(ranks)

validation = {
    "n_flagged": len(anom),
    "flagged": [{"customer_id": r.customer_id, "score": round(r.score, 4),
                 "n_accounts": int(r.n_accounts), "n_anomalous_accounts": int(r.n_anomalous_accounts),
                 "structuring_days": int(r.structuring_days),
                 "never_screened": bool(r.never_screened), "post_match_value": round(r.post_match_value),
                 "bootstrap_freq": round(float(freq[out.customer_id == r.customer_id][0]), 2)}
                for r in anom.itertuples()],
    "seed_stability": {"n_seeds": 20, "jaccard_mean": round(float(np.mean(seed_j)), 2),
                       "jaccard_min": round(float(np.min(seed_j)), 2)},
    "cross_tier": {
        "anomalous_account_customers_in_top15": round(coverage_top15, 2),
        "ranks_of_anomalous_account_customers": {k: v for k, v in sorted(ranks.items(), key=lambda x: x[1])},
        "spearman_score_vs_max_account_score": round(float(rho), 2),
        "note": "the customer tier re-ranks by subject-level severity: KYC and cross-account signals add information beyond the account tier",
    },
    "kyc_only_customers": {
        "count": int(len(kyc_only)),
        "note": "KYC records with no accounts at all — excluded from scoring, a data-governance finding in itself",
    },
}
with open("app/data/tier3_validation.json", "w", encoding="utf-8") as f:
    json.dump(validation, f, indent=1)

print(f"tier3: {len(anom)} anomalous customers of {len(out)} active ({len(kyc_only)} KYC-only excluded)")
print(anom[["customer_id", "n_accounts", "n_anomalous_accounts", "structuring_days",
            "never_screened", "post_match_value", "total_value", "score"]].round(2).to_string(index=False))
print("coherence: anomalous-account customers in top-15:", round(coverage_top15, 2),
      "| ranks:", validation["cross_tier"]["ranks_of_anomalous_account_customers"],
      "| spearman:", round(float(rho), 2), "| CUST0003 in set:", "CUST0003" in base_set)
print("seed stability:", validation["seed_stability"])
