# MEASURES — Fraud & Compliance Exploration Board

Catalogo de la capa semantica del .pbix, generado del modelo en vivo el 2026-07-13
(via TOM contra el Analysis Services local de Desktop). Nombres y formulas siguen
[../docs/CONVENTIONS.md](../docs/CONVENTIONS.md) §6: termino canonico del KPI tile,
formula identica a la superficie canonica del board. Layout en
[layout_spec.md](layout_spec.md).

---

## 1. Modelo

9 tablas del warehouse (BigQuery `fraud-exploration-cd.fraud_exploration`, snake_case)
+ 2 tablas de modelo en mayusculas: `KPI` (todas las medidas) y `DATE` (calendario
2025-2026 marcado como date table).

```
customers 1--* accounts 1--* transactions 1--* chargebacks
customers 1--1 customer_scores        transactions 1--1 transaction_scores
customers 1--* sanctions_screening    accounts 1--1 account_scores
                                      accounts 1--* compliance_alerts

DATE[Date] 1--* transactions[Transaction date]        (ACTIVA)
DATE[Date] 1--* compliance_alerts[Alert date]         (inactiva -> USERELATIONSHIP)
DATE[Date] 1--* chargebacks[Chargeback date]          (inactiva -> USERELATIONSHIP)
DATE[Date] 1--* sanctions_screening[Screening date]   (inactiva -> USERELATIONSHIP)
```

Las columnas de fecha fisicas (texto ISO) estan ocultas; las visibles son columnas
calculadas tipadas Date en sentence case ("Transaction date", "Alert date", ...).

## 2. Medidas (22, tabla KPI)

Fechas fijas por diseno: el "now" canonico es 2026-07-11 (CLAUDE.md) en
[Backlog median age (days)]; el ancla 2026-03 de [Chargeback growth] replica el KPI
tile del board (core.js). Ambas son inmunes al slicer de periodo.

### 00 Base

| Medida | Formato | DAX |
|---|---|---|
| Total transaction value | `$#,0` | `SUM(transactions[amount])` |
| Transaction count | `#,0` | `COUNTROWS(transactions)` |

### 01 Escalation gap

| Medida | Formato | DAX |
|---|---|---|
| Escalation gap | `0.0%` | `DIVIDE([Flagged no-alert count], [Flagged transaction count])` |
| Flagged transaction count | `#,0` | `CALCULATE(COUNTROWS(transactions), transactions[flagged_for_review] = "Yes")` |
| Flagged no-alert count | `#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN COUNTROWS(FILTER(transactions, transactions[flagged_for_review] = "Yes" && NOT transactions[transaction_id] IN alerted))` |
| Flagged no-alert value | `$#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN SUMX(FILTER(transactions, transactions[flagged_for_review] = "Yes" && NOT transactions[transaction_id] IN alerted), transactions[amount])` |
| Unalerted high-risk count | `#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN COUNTROWS(FILTER(transactions, transactions[counterparty_country] IN {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"} && NOT transactions[transaction_id] IN alerted))` |
| Unalerted high-risk value | `$#,0` | `VAR alerted = VALUES(compliance_alerts[transaction_id]) RETURN SUMX(FILTER(transactions, transactions[counterparty_country] IN {"Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"} && NOT transactions[transaction_id] IN alerted), transactions[amount])` |

### 02 Sanctions screening

| Medida | Formato | DAX |
|---|---|---|
| Screening coverage | `0.0%` | `DIVIDE(DISTINCTCOUNT(sanctions_screening[customer_id]), COUNTROWS(customers))` |
| Never-screened customers | `0` | `COUNTROWS(customers) - DISTINCTCOUNT(sanctions_screening[customer_id])` |
| Post-match value | `$#,0` | `SUMX(FILTER(transactions, VAR cid = RELATED(accounts[customer_id]) VAR mdate = CALCULATE(MIN(sanctions_screening[Screening date]), FILTER(ALL(sanctions_screening), sanctions_screening[customer_id] = cid && sanctions_screening[match_result] = "Confirmed Match")) RETURN NOT ISBLANK(mdate) && transactions[Transaction date] > mdate), transactions[amount])` |

### 03 Structuring

| Medida | Formato | DAX |
|---|---|---|
| Structuring-band count | `#,0` | `COUNTROWS(FILTER(transactions, transactions[amount] >= 9000 && transactions[amount] < 10000))` |
| Structuring-band share | `0.0%` | `DIVIDE([Structuring-band count], COUNTROWS(FILTER(transactions, NOT ISBLANK(transactions[amount]) && transactions[amount] > 0)))` |

### 04 Account controls

| Medida | Formato | DAX |
|---|---|---|
| Value through non-active accounts | `$#,0` | `CALCULATE(SUM(transactions[amount]), accounts[status] IN {"Closed", "Dormant", "Frozen"})` |

### 05 Operations

| Medida | Formato | DAX |
|---|---|---|
| Unresolved Critical / High | `0` | `COUNTROWS(FILTER(compliance_alerts, compliance_alerts[severity] IN {"Critical", "High"} && LEFT(compliance_alerts[status], 6) <> "Closed"))` |
| False-positive rate | `0.0%` | `DIVIDE(CALCULATE(COUNTROWS(compliance_alerts), compliance_alerts[status] = "Closed - False Positive"), COUNTROWS(FILTER(compliance_alerts, LEFT(compliance_alerts[status], 6) = "Closed")))` |
| Backlog median age (days) | `0` | `MEDIANX(FILTER(compliance_alerts, LEFT(compliance_alerts[status], 6) <> "Closed"), INT(DATE(2026, 7, 11) - compliance_alerts[Alert date]))` |
| Alerts created | `#,0` | `CALCULATE(COUNTROWS(compliance_alerts), USERELATIONSHIP('DATE'[Date], compliance_alerts[Alert date]))` |
| Chargeback value | `$#,0` | `SUM(chargebacks[amount])` |
| Chargeback count | `#,0` | `COUNTROWS(chargebacks)` |
| Monthly chargeback value | `$#,0` | `CALCULATE(SUM(chargebacks[amount]), USERELATIONSHIP('DATE'[Date], chargebacks[Chargeback date]))` |
| Chargeback growth | `0.0"x"` | `VAR mcur = EOMONTH(MAX(chargebacks[Chargeback date]), 0) VAR cur = CALCULATE(SUM(chargebacks[amount]), FILTER(ALL(chargebacks), EOMONTH(chargebacks[Chargeback date], 0) = mcur)) VAR base = CALCULATE(SUM(chargebacks[amount]), FILTER(ALL(chargebacks), EOMONTH(chargebacks[Chargeback date], 0) = DATE(2026, 3, 31))) RETURN DIVIDE(cur, base)` |

## 3. Valores verificados (2026-07-13, EVALUATE contra el modelo)

| Medida | Valor | Fuente canonica |
|---|---|---|
| Escalation gap | 87.3% (357 de 409) | EDA_FINDINGS / KPI tile |
| Flagged no-alert value | $7,664,215 | $7.66M |
| Unalerted high-risk count / value | 147 / $4,323,306 | 147 / $4.32M |
| Post-match value | $1,856,243 | ~$1.85M |
| Screening coverage / Never-screened | 66.3% / 28 | 34% de 83 nunca |
| Structuring-band count / share | 276 / 17.4% | 276 / 17.4% (base 1,587 valid-amount) |
| Value through non-active accounts | $15,254,133 | $15.3M |
| Unresolved Critical / High | 8 | 8 |
| False-positive rate | 76.9% | 77% |
| Backlog median age (days) | 90.5 | 90d |
| Chargeback growth | 20.1x | ~20x (2026-03 -> 2026-07) |
| Monthly chargeback value (2026-03 / 2026-06) | $5,694 / $124,945 | eda_stats.json exacto |
