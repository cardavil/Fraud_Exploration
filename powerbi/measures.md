# MEASURES — Fraud & Compliance Exploration Board

Catalog of the .pbix semantic layer, generated from the live model on 2026-07-13
(via TOM against Desktop's local Analysis Services). Names and formulas follow
[../docs/CONVENTIONS.md](../docs/CONVENTIONS.md) §6: the canonical KPI-tile term, with the
formula identical to the board's canonical surface. Layout in [layout_spec.md](layout_spec.md).

---

## 1. Model

11 tables total: 9 warehouse tables (BigQuery dataset `fraud_exploration`, snake_case) plus
2 uppercase model tables: `KPI` (all measures) and `DATE` (a calculated calendar, marked as
the date table).

```
customers 1--* accounts 1--* transactions 1--* chargebacks
customers 1--1 customer_scores        transactions 1--1 transaction_scores
customers 1--* sanctions_screening    accounts 1--1 account_scores
                                      accounts 1--* compliance_alerts

DATE[Date] 1--* transactions[Transaction date]        (ACTIVE)
DATE[Date] 1--* compliance_alerts[Alert date]         (inactive -> USERELATIONSHIP)
DATE[Date] 1--* chargebacks[Chargeback date]          (inactive -> USERELATIONSHIP)
DATE[Date] 1--* sanctions_screening[Screening date]   (inactive -> USERELATIONSHIP)
```

The physical date columns (ISO text) are hidden; the visible ones are calculated, Date-typed
columns in sentence case ("Transaction date", "Alert date", ...).

## 2. Measures (22, table KPI)

Dates fixed by design: the canonical "now" is 2026-07-11 (CLAUDE.md) in
[Backlog median age (days)]; the 2026-03 anchor in [Chargeback growth] mirrors the board's KPI
tile (core.js). Both are immune to the reporting-period slicer.

### 00 Base

| Measure | Format | DAX |
|---|---|---|
| Total transaction value | `$#,0` | `SUM(transactions[amount])` |
| Transaction count | `#,0` | `COUNTROWS(transactions)` |

### 01 Escalation gap

| Measure | Format | DAX |
|---|---|---|
| Escalation gap | `0.0%` | `DIVIDE([Flagged no-alert count], [Flagged transaction count])` |
| Flagged transaction count | `#,0` | `CALCULATE(COUNTROWS(transactions), transactions[flagged_for_review] = "Yes")` |
| Flagged no-alert count | `#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN COUNTROWS(FILTER(transactions, transactions[flagged_for_review] = "Yes" && NOT transactions[transaction_id] IN alerted))` |
| Flagged no-alert value | `$#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN SUMX(FILTER(transactions, transactions[flagged_for_review] = "Yes" && NOT transactions[transaction_id] IN alerted), transactions[amount])` |
| Unalerted high-risk count | `#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN COUNTROWS(FILTER(transactions, transactions[counterparty_country] IN {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"} && NOT transactions[transaction_id] IN alerted))` |
| Unalerted high-risk value | `$#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN SUMX(FILTER(transactions, transactions[counterparty_country] IN {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"} && NOT transactions[transaction_id] IN alerted), transactions[amount])` |

### 02 Sanctions screening

| Measure | Format | DAX |
|---|---|---|
| Screening coverage | `0.0%` | `DIVIDE(DISTINCTCOUNT(sanctions_screening[customer_id]), COUNTROWS(customers))` |
| Never-screened customers | `0` | `COUNTROWS(customers) - DISTINCTCOUNT(sanctions_screening[customer_id])` |
| Post-match value | `$#,0` | `SUMX(FILTER(transactions, VAR cid = RELATED(accounts[customer_id]) VAR mdate = CALCULATE(MIN(sanctions_screening[Screening date]), FILTER(ALL(sanctions_screening), sanctions_screening[customer_id] = cid && sanctions_screening[match_result] = "Confirmed Match")) RETURN NOT ISBLANK(mdate) && transactions[Transaction date] > mdate), transactions[amount])` |

### 03 Structuring

| Measure | Format | DAX |
|---|---|---|
| Structuring-band count | `#,0` | `COUNTROWS(FILTER(transactions, transactions[amount] >= 9000 && transactions[amount] < 10000))` |
| Structuring-band share | `0.0%` | `DIVIDE([Structuring-band count], COUNTROWS(FILTER(transactions, NOT ISBLANK(transactions[amount]) && transactions[amount] > 0)))` |

### 04 Account controls

| Measure | Format | DAX |
|---|---|---|
| Value through non-active accounts | `$#,0` | `CALCULATE(SUM(transactions[amount]), accounts[status] IN {"Closed", "Dormant", "Frozen"})` |

### 05 Operations

| Measure | Format | DAX |
|---|---|---|
| Unresolved Critical / High | `0` | `COUNTROWS(FILTER(compliance_alerts, compliance_alerts[severity] IN {"Critical", "High"} && LEFT(compliance_alerts[status], 6) <> "Closed"))` |
| False-positive rate | `0.0%` | `DIVIDE(CALCULATE(COUNTROWS(compliance_alerts), compliance_alerts[status] = "Closed - False Positive"), COUNTROWS(FILTER(compliance_alerts, LEFT(compliance_alerts[status], 6) = "Closed")))` |
| Backlog median age (days) | `0` | `MEDIANX(FILTER(compliance_alerts, LEFT(compliance_alerts[status], 6) <> "Closed"), INT(DATE(2026, 7, 11) - compliance_alerts[Alert date]))` |
| Alerts created | `#,0` | `CALCULATE(COUNTROWS(compliance_alerts), USERELATIONSHIP('Date'[Date], compliance_alerts[Alert date]))` |
| Chargeback value | `$#,0` | `SUM(chargebacks[amount])` |
| Chargeback count | `#,0` | `COUNTROWS(chargebacks)` |
| Monthly chargeback value | `$#,0` | `CALCULATE(SUM(chargebacks[amount]), USERELATIONSHIP('Date'[Date], chargebacks[Chargeback date]))` |
| Chargeback growth | `0.0"×"` | `VAR mcur = EOMONTH(MAX(chargebacks[Chargeback date]), 0) VAR cur = CALCULATE(SUM(chargebacks[amount]), FILTER(ALL(chargebacks), EOMONTH(chargebacks[Chargeback date], 0) = mcur)) VAR base = CALCULATE(SUM(chargebacks[amount]), FILTER(ALL(chargebacks), EOMONTH(chargebacks[Chargeback date], 0) = DATE(2026, 3, 31))) RETURN DIVIDE(cur, base)` |

## 3. Verified values (2026-07-14, EVALUATE against the model)

| Measure | Value | Canonical source |
|---|---|---|
| Total transaction value | $71,466,414 | live EVALUATE |
| Transaction count | 1,600 | live EVALUATE |
| Escalation gap | 87.3% (357 of 409) | README Key findings #1 |
| Flagged no-alert value | $7,664,215 | $7.66M (Key findings #1) |
| Unalerted high-risk count / value | 147 / $4,323,306 | 147 / $4.32M (Key findings #1) |
| Screening coverage / Never-screened | 66.3% / 28 | 34% of 83 never screened (Key findings #2) |
| Post-match value | $1,856,243 | ~$1.85M (Key findings #2) |
| Structuring-band count / share | 276 / 17.4% | 276 / 17.4% (base 1,587 valid-amount, Key findings #3) |
| Value through non-active accounts | $15,254,133 | $15.3M (Key findings #4) |
| Unresolved Critical / High | 8 | 8 open (Key findings #5) |
| False-positive rate | 76.9% | 77% (Key findings #5) |
| Backlog median age (days) | 90.5 | 90d (Key findings #5) |
| Chargeback count | 70 | live EVALUATE |
| Chargeback value | $497,020 | live EVALUATE |
| Chargeback growth | 20.1× | ~20× (2026-03 → latest month, Key findings #5) |
