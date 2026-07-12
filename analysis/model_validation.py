"""
Rigorous validation for the unsupervised Isolation Forest — the honest
substitutes for "accuracy" and "overfitting" when no labels exist:

1. Train/held-out score comparison (memorization check)
2. Bootstrap detection frequency (confidence per detection)
3. Seed stability (Jaccard of the anomaly set across random states)
4. Score distribution + the model's real cutoff (offset_)
5. Convergent validity vs the rules engine's alerts (weak labels, with caveat)
6. Feature ablation (leave-one-feature-out influence)

Feature engineering mirrors analysis/anomaly.py. Output: app/data/model_validation.json
Run from the repo root: python analysis/model_validation.py
"""
import json
import pathlib
import sqlite3
import sys

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from account_features import build_features

BASE_PARAMS = {"n_estimators": 300, "contamination": 0.08, "random_state": 42}
N_BOOTSTRAP = 200
N_SPLITS = 50
N_SEEDS = 50
RNG = np.random.default_rng(42)

con = sqlite3.connect("data/clean.db")
al = pd.read_sql("SELECT * FROM compliance_alerts", con)
feat = build_features(con)
X = StandardScaler().fit_transform(feat)
accounts = feat.index.to_numpy()
has_alert = pd.Series(accounts).isin(set(al.account_id)).to_numpy()


def fit(X_fit, **overrides):
    return IsolationForest(**{**BASE_PARAMS, **overrides}).fit(X_fit)


base = fit(X)
base_scores = -base.score_samples(X)          # higher = more anomalous
base_set = set(accounts[base.predict(X) == -1])
jaccard = lambda a, b: len(a & b) / len(a | b) if a | b else 1.0

# ---------- 1. overfitting: train vs held-out score distributions ----------
gaps, train_means, hold_means = [], [], []
for i in range(N_SPLITS):
    idx = RNG.permutation(len(X))
    cut = int(len(X) * 0.7)
    tr, ho = idx[:cut], idx[cut:]
    m = fit(X[tr])
    s_tr, s_ho = -m.score_samples(X[tr]), -m.score_samples(X[ho])
    train_means.append(s_tr.mean())
    hold_means.append(s_ho.mean())
    gaps.append(s_tr.mean() - s_ho.mean())
overfitting = {
    "n_splits": N_SPLITS, "train_frac": 0.7,
    "mean_score_train": round(float(np.mean(train_means)), 4),
    "mean_score_holdout": round(float(np.mean(hold_means)), 4),
    "gap": round(float(np.mean(gaps)), 4),
    "gap_std": round(float(np.std(gaps)), 4),
}

# ---------- 2. bootstrap detection frequency (confidence per detection) ----------
included = np.zeros(len(X))
flagged = np.zeros(len(X))
for i in range(N_BOOTSTRAP):
    idx = RNG.choice(len(X), size=int(len(X) * 0.8), replace=False)
    m = fit(X[idx])
    pred = m.predict(X[idx])
    included[idx] += 1
    flagged[idx[pred == -1]] += 1
freq = np.divide(flagged, included, out=np.zeros_like(flagged), where=included > 0)
bootstrap = {
    "n_iterations": N_BOOTSTRAP, "subsample": 0.8,
    "accounts": [
        {"account_id": str(a), "frequency": round(float(f), 2), "in_base_set": a in base_set}
        for a, f in zip(accounts, freq) if a in base_set or f >= 0.2
    ],
}
bootstrap["accounts"].sort(key=lambda x: -x["frequency"])

# ---------- 3. seed stability ----------
seed_jaccards = []
for seed in range(N_SEEDS):
    m = fit(X, random_state=seed)
    seed_jaccards.append(jaccard(set(accounts[m.predict(X) == -1]), base_set))
seed_stability = {
    "n_seeds": N_SEEDS,
    "jaccard_mean": round(float(np.mean(seed_jaccards)), 3),
    "jaccard_min": round(float(np.min(seed_jaccards)), 3),
}

# ---------- 4. score distribution + real cutoff ----------
cutoff = -float(base.offset_)                 # anomalous ⇔ score > cutoff
lo, hi = float(base_scores.min()), float(base_scores.max())
edges = np.linspace(lo, hi, 13)
hist, _ = np.histogram(base_scores, bins=edges)
score_distribution = {
    "cutoff": round(cutoff, 4),
    "bins": [{"lo": round(float(edges[i]), 4), "hi": round(float(edges[i + 1]), 4),
              "count": int(hist[i])} for i in range(len(hist))],
}

# ---------- 5. convergent validity vs rule alerts (weak labels) ----------
order = np.argsort(-base_scores)
top_decile = order[: max(1, len(X) // 10)]
rest = order[len(top_decile):]
corr, corr_p = stats.pearsonr(base_scores, has_alert.astype(float))
flagged_ids = accounts[np.isin(accounts, list(base_set))]
convergent = {
    "top_decile_alert_rate": round(float(has_alert[top_decile].mean()), 2),
    "rest_alert_rate": round(float(has_alert[rest].mean()), 2),
    "score_alert_correlation": round(float(corr), 2),
    "correlation_p": round(float(corr_p), 4),
    "flagged_with_alert": int(sum(has_alert[np.isin(accounts, list(base_set))])),
    "flagged_total": len(base_set),
}

# ---------- 6. feature ablation ----------
ablation = []
for j, feature_name in enumerate(feat.columns):
    Xa = np.delete(X, j, axis=1)
    m = fit(Xa)
    a_set = set(accounts[m.predict(Xa) == -1])
    ablation.append({"feature": feature_name,
                     "jaccard_vs_base": round(jaccard(a_set, base_set), 2),
                     "n_anomalies": len(a_set)})
ablation.sort(key=lambda x: x["jaccard_vs_base"])

out = {"overfitting": overfitting, "bootstrap": bootstrap,
       "seed_stability": seed_stability, "score_distribution": score_distribution,
       "convergent_validity": convergent, "ablation": ablation}
with open("app/data/model_validation.json", "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)

print("overfitting:", overfitting)
print("seed_stability:", seed_stability)
print("cutoff:", cutoff)
print("convergent:", convergent)
print("bootstrap top:", bootstrap["accounts"][:12])
print("ablation (most influential first):", ablation[:5])
