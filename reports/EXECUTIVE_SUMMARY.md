# Risk & Compliance Review — Executive Summary

**Scope:** 6-table transaction and compliance dataset (83 customers, 105 accounts, 1,600
transactions, Oct 2025 – Jul 2026), cleaned with a fully audited pipeline (31 documented
treatments) and analyzed statistically plus with an interpretable ML model.
**Method & evidence:** [EDA_FINDINGS.md](../outputs/EDA_FINDINGS.md) ·
**Live exploration tool:** https://fraud-exploration.pages.dev

---

### 1. $4.3M in sanctioned-country transactions was detected — and never worked

147 of 170 transactions with counterparties in sanctioned or high-risk jurisdictions
($4.32M) were flagged by the monitoring rules but never became an alert. Overall, 87% of
flagged transactions (357 of 409, $7.7M) never turned into a case. **Detection works;
escalation doesn't** — the highest-value fix in this book is operational, not technological.

### 2. Confirmed sanctions matches keep transacting; a third of customers were never screened

4 confirmed sanctions matches, zero resolved; ~$1.85M moved *after* the match was confirmed
(one customer alone moved $1.0M across 20 transactions while "Pending" since Aug 2025).
28 of 83 customers (34%) — including sanctioned-nationality customers and 2 of 3 PEPs —
have never been screened at all.

### 3. A structuring pattern sits in plain sight

276 transactions (17.4% of the book) fall in the $9,000–9,999 band — 3.3× the neighboring
$1k bands, collapsing immediately above the $10,000 reporting threshold. The rules flag 83%
of them individually, yet only 9 structuring alerts exist: the pattern-level signal is lost.

### 4. Account-status controls are not enforced

$15.3M flowed through accounts that should not transact — Dormant ($8.6M), Closed ($5.3M)
and Frozen ($1.4M). The `is_international` flag misclassifies 148 sanctioned-country
transactions as domestic, so geography-based monitoring cannot rely on it. Either the status
data is stale or the blocking control is inoperative; both are audit findings.

### 5. Monitoring never scaled — and is aimed at the wrong risk

Transaction volume tripled (≈90 → ≈270/month) while alert creation stayed flat; 77% of
closed alerts are false positives, and the backlog holds 8 unresolved Critical/High alerts
with a median age of 90 days. The KYC risk rating shows **no statistical relationship** with
flagged activity (Cramér's V = 0.05) — while an interpretable Isolation Forest surfaces
9 structurally anomalous accounts, **5 of which never had an alert**, including single-day
bursts of $600K+. Chargeback value is compounding ~20× in four months on top.

---

**Recommended next steps (90 days):** (1) work the 147 unalerted sanctioned-country
transactions and the 8 aged Critical/High alerts; (2) freeze-and-resolve the 4 confirmed
matches and close the screening gap; (3) add a pattern-level structuring rule; (4) enforce
status-based blocking and fix `is_international` at source; (5) re-tune monitoring rules
against outcomes and pilot the anomaly model as an enhanced-review feed.

*Prepared as part of a personal portfolio project on a dummy dataset; the live tool at the
link above lets every figure here be explored interactively. Not affiliated with any
payments company.*
