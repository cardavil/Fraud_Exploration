"""
Shared account-level feature engineering (tier 2). Single source imported by
anomaly.py, model_sensitivity.py, model_validation.py and export_model.py —
the browser scorer (app/js/iforest.js) mirrors this exactly.

16 features = 12 behavioral aggregates + 4 tier-1/dynamics:
  pct_txn_anomalous / max_txn_score  come from outputs/transaction_scores.csv
  max_day_share                      burstiness: biggest single day / total value
  recent_intensity                   share of value moved in the last 90 days
"""
import pandas as pd

HIGH_RISK = {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"}
OFFSHORE = {"Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"}
RECENT_DAYS = 90


def build_features(con):
    tx = pd.read_sql("SELECT * FROM transactions", con, parse_dates=["transaction_date"])
    t1 = pd.read_csv("outputs/transaction_scores.csv")

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

    t1_agg = t1.groupby("account_id").agg(
        pct_txn_anomalous=("anomaly", lambda s: (s == -1).mean()),
        max_txn_score=("score", "max"),
    )
    feat = feat.join(t1_agg).fillna({"pct_txn_anomalous": 0, "max_txn_score": 0})

    day_sum = tx.dropna(subset=["amount"]).groupby(
        ["account_id", tx.transaction_date.dt.date]).amount.sum()
    max_day = day_sum.groupby("account_id").max()
    feat["max_day_share"] = (max_day / feat.total).fillna(0).clip(upper=1)

    recent_cut = tx.transaction_date.max() - pd.Timedelta(days=RECENT_DAYS)
    recent_value = tx[tx.transaction_date > recent_cut].groupby("account_id").amount.sum()
    feat["recent_intensity"] = (recent_value / feat.total).reindex(feat.index).fillna(0).clip(upper=1)

    return feat
