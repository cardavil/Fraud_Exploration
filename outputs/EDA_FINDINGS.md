# Risk & Compliance Analysis — EDA Findings
**Dataset:** Risk and compliance dummy dataset (6 tables) · **Analysis date:** 11 July 2026
**Clean row counts:** 83 customers · 105 accounts · 1,600 transactions · 65 alerts · 95 screenings · 70 chargebacks

---

## 1. Data quality (pre-analysis)

31 distinct data-quality issues were identified and treated; full audit trail in `cleaning_log.csv`. Highlights:

- 36 duplicate records dropped across all six tables (18 duplicate transaction IDs alone).
- Systematic casing/whitespace inconsistencies (`'india'`, `'  Active  '`, `'CARD PAYMENT'`) — 240 transaction-type values normalized.
- 3 customers with an **empty PEP flag** — recoded as *Unknown*, not assumed *No* (a compliance-relevant distinction).
- 5 zero/negative transaction amounts and 3 negative balances — retained and flagged, not silently fixed.
- **The `is_international` flag is unreliable:** 152 transactions with counterparties in sanctioned jurisdictions are marked as domestic. ~83% of all transactions are marked "No" regardless of counterparty country. This field cannot be trusted for monitoring and is itself a control finding.

## 2. Descriptive statistics — transactions

| Metric | Value |
|---|---|
| n (valid amounts) | 1,587 |
| Mean / Median | $45,032 / $9,234 |
| Std deviation | $106,628 (CV = 2.37) |
| Skewness / Kurtosis | +2.85 / 6.92 (heavily right-skewed) |
| P95 / Max | $346,210 / $498,896 |

The mean is ~5× the median — a small number of very large wires dominate total value. Median, not mean, should drive operational thresholds.

## 3. Structuring signature (statistical anomaly)

Transaction counts per $1,000 band around the $10,000 reporting threshold:

| Band | 5–6k | 6–7k | 7–8k | 8–9k | **9–10k** | 10–11k | 11–12k |
|---|---|---|---|---|---|---|---|
| Count | 91 | 87 | 75 | 90 | **276** | 78 | 52 |

The 9,000–9,999 band holds **17.4% of all transactions — 3.2× its neighboring bands**, collapsing to 78 immediately above $10k. This is the classic structuring pattern (splitting amounts to stay under the reporting threshold). The rule engine partially sees it (83% of these are flagged) but only 9 structuring alerts exist — the flags are not converting into cases.

## 4. Trends (time series)

- **Transaction volume is growing ~14 txns/month** (linear fit r = 0.75, p = 0.001); monthly count tripled from ~90 (Q4-2025) to ~270 (Q2-2026). Monthly value grew from ~$2.7M to ~$13.7M.
- **Alert creation is flat** (4–12/month) — monitoring capacity has not scaled with volume.
- **Chargebacks are accelerating sharply:** 3 → 8 → 11 → 15 → 17 per month (Mar–Jul 2026); monthly value grew from $5.7K to $124K — a ~20× increase in four months.
- Flagged-for-review rate is stable at ~23–28% of transactions (itself abnormally high — a quarter of all activity is "suspicious," suggesting mis-calibrated rules).

## 5. Correlations & associations

| Association | Cramér's V | p | Reading |
|---|---|---|---|
| counterparty_country × flagged | **0.591** | <0.001 | Flags are driven by geography |
| transaction_type × flagged | **0.499** | <0.001 | …and by type (cash-heavy) |
| transaction_type × structuring-zone | 0.554 | <0.001 | Structuring concentrates in specific types |
| **risk_rating × flagged** | **0.052** | 0.117 | **Customer risk rating has NO relationship with flagged activity** |
| onboarding_channel × risk_rating | 0.200 | <0.001 | Weak but real channel effect |

Spearman correlations between assigned `risk_rating` and actual behavior (per customer): all near zero and non-significant (n_tx ρ=+0.15, %high-risk-country ρ=+0.04, %flagged ρ=+0.13); only %cash reaches significance (ρ=+0.27, p=0.043).

**Interpretation: the KYC risk rating is disconnected from observed transactional behavior.** 9 of 31 "Low"-rated customers show elevated-risk behavior (>15% sanctioned-country transactions or >40% flagged), including one Low-rated customer with $2.57M in volume and 35% flagged activity.

Pearson (numeric): amount × balance r=−0.03, amount × flagged r=−0.12 — no meaningful linear correlations; risk here is categorical/geographic, not amount-driven.

## 6. The alert funnel is broken (detection ≠ escalation)

- 409 transactions are `flagged_for_review = Yes` → only **52 (13%) ever received a compliance alert**. **357 flagged transactions worth $7.66M were never worked.**
- 170 transactions with counterparties in sanctioned/high-risk jurisdictions (Iran, North Korea, Syria, Russia, Myanmar, Afghanistan), worth **$5.04M**. All 170 were flagged — but only 23 have alerts. **147 sanctioned-country transactions ($4.32M) sit unalerted.**

## 7. Alert operations

- False-positive rate: **77%** of closed alerts (30/39). Analysts spend most capacity clearing noise while real flags (above) go unworked.
- SARs filed: 9.
- Closed alerts resolve fast (median 9 days, max 21) — but the **backlog of 26 open alerts has a median age of 90 days, max 417 days**, including **8 open Critical/High alerts**. Two-speed operation: new alerts get closed, old ones rot.
- 3 open alerts are **unassigned** to any analyst. Workload is otherwise evenly spread (2–6 open items per analyst) — this is a process problem, not a people problem.

## 8. Sanctions screening gaps

- **4 confirmed sanctions matches — zero resolved** (3 escalated, 1 pending). Post-match activity:
  - CUST0079 (Nigeria, *Pending* since Aug 2025): **20 transactions, $1.00M after the confirmed match**, account still Active.
  - CUST0035 (US, Escalated since May 2025): **26 transactions, $844K after the match.**
  - CUST0017 (Russia, High risk): 2 transactions after match, account Active.
- **28 of 83 customers (34%) have never been screened**, including 3 High-risk customers and — critically — **customers with Iran, Syria, and North Korea nationality** (CUST0015, CUST0036, CUST0062).
- 2 of 3 PEP customers never screened; 3 customers have Unknown PEP status.
- 4 screenings have no reviewer recorded; 3 potential matches still pending.

## 9. Account status controls failing

Transactions are flowing through accounts that should not transact:

| Account status | Transactions | Value |
|---|---|---|
| Closed | 171 | $5.28M |
| Dormant | 175 | $8.61M |
| Frozen | 32 | $1.36M |

$15.3M moved through Closed/Dormant/Frozen accounts — either the status field is stale (data governance) or the transaction-blocking control is not enforced (worse). Only 13 Dormant-reactivation alerts exist.

## 10. Chargebacks

- 70 chargebacks, $497K total. Fraud-related (CNP + Unauthorized): 15 cases (21%), $108K.
- Sharp acceleration since Mar-2026 (see §4). 25 (36%) unresolved.
- Concentration: GreenLeaf Grocers and Horizon Holdings (9 each), then a tight cluster at 6–7 — top-6 merchants account for 64% of cases. Win rate roughly balanced (21 merchant / 16 cardholder).

## 11. ML anomaly detection (Isolation Forest, account level)

Features per account: volume, amount μ/σ/max, % high-risk-country, % offshore, % cash, % structuring-zone, % international, velocity (txns and value per month). 300 trees, 8% contamination.

- **9 anomalous accounts detected; 5 of them have never had a compliance alert** — the model surfaces risk the rule engine misses.
- Dominant pattern: **single-day burst accounts** — e.g., ACC00100 (13 txns, $663K in one day), ACC00062 (13 txns, $639K in one day), ACC00007 (13 txns in one day). None generated a "Rapid Movement of Funds" alert.
- Also caught: ACC00032 (45% sanctioned-country transactions, $604K) and ACC00099 (67% cash, 22% structuring-zone).
- All model outputs are explainable — each account's feature profile shows *why* it scored anomalous (outputs in `account_features_scores.csv`).

---

## Candidate "Top 5 Insights" for the executive summary

1. **$4.3M in transactions to sanctioned jurisdictions were flagged but never alerted** (147 of 170); overall, 87% of flagged transactions ($7.7M) never became a case. Detection works; escalation doesn't.
2. **Confirmed sanctions matches keep transacting:** 4 confirmed matches, zero resolved, ~$1.85M moved after matching; 34% of the customer base — including sanctioned-nationality and PEP customers — has never been screened.
3. **A structuring pattern hides in plain sight:** 276 transactions (17%) sit in the $9,000–9,999 band — 3.2× the expected rate — yet only 9 structuring alerts exist.
4. **Controls on account status are not enforced:** $15.3M flowed through Closed, Dormant, and Frozen accounts; the `is_international` flag misclassifies 152 sanctioned-country transactions as domestic.
5. **Monitoring hasn't scaled and is mis-aimed:** volume tripled while alerting stayed flat; the false-positive rate is 77%; the KYC risk rating shows no statistical relationship to actual behavior (Cramér's V = 0.05) — and an interpretable ML model found 5 high-risk accounts (incl. $600K+ single-day bursts) the rules never caught. Chargebacks are up ~20× in value in four months.
