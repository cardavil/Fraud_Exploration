# LAYOUT_SPEC — Fraud & Compliance Exploration Board (Power BI report)

As-built specification of the Power BI report (Layer 1 deliverable): 4 pages, one insight
story per page, with a per-visual field mapping that matches the saved `.pbix`. Measures and
model live in [measures.md](measures.md); the visual theme in [theme.json](theme.json); the
semantic-layer conventions in [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md). Headline
figures trace to the "Key findings" section of [../README.md](../README.md) and the board's
Findings tab.

Document date: 2026-07-14. This document describes the report exactly as built and saved; it
is not a wishlist. Every visual, title, and field below is taken from the live model and the
saved report layout.

---

## 1. Design principles

Synthesis of executive-dashboard and compliance-reporting practice, applied to this report:

| Principle | Application here |
|---|---|
| One screen, no scroll | each page resolves its message within a 16:9 canvas; detail lives on its own page, not below a fold |
| Z-pattern reading | the most critical KPIs sit top-left, the trend in the central band, the breakdown lower and to the right |
| 8px grid | consistent 8/16px gutters and aligned edges; a focused set of content visuals sits over the shared shell |
| Color discipline | a sober navy/blue/grey palette; red and amber are reserved for risk semantics (sanctioned / warning) and are never decorative — the same rule as the board |
| Risk never encoded by color alone | red/amber are always paired with a label or value (accessibility and regulatory legibility) |
| Metrics carry context | card visuals pair each value with its category label rather than presenting a bare number |
| Left-rail navigation | a navy shell shape carries a native page navigator and the period slicer, mirroring the board's topbar hierarchy |

Only generally available Desktop visuals are used: the new card visual, the page navigator,
the slicer, native binning, matrix, table, scatter chart, funnel, and line/bar/column charts.
There are no custom or AppSource visuals and no preview features, so the file opens cleanly on
any reasonably current Desktop.

## 2. Report structure: four pages

The four pages follow the insight numbering of the measure display folders (00–05) rather than
the model's three detection tiers. The three tiers live together on the last page as the
differentiator that links to the live board (Layer 2).

| # | Page | Focus |
|---|---|---|
| 1 | Overview | all headline KPIs plus volume-versus-alerting and unworked risk by country |
| 2 | Risk deep-dive | 01 escalation gap · 02 sanctions screening · 03 structuring |
| 3 | Controls & operations | 04 account controls · 05 operations |
| 4 | Detection layers | the ML model, transaction → account → customer tiers |

### Shared shell (present on all four pages)

Every page carries the same four shell objects: a navy shell **shape**, a **REPORTING PERIOD**
slicer on `DATE[Date]`, a **FRAUD & COMPLIANCE EXPLORATION** text-box banner, and a native
**page navigator**.

```
+--(navy shell shape)--------+--(canvas #F5F7FB)-----------------------------+
| FRAUD & COMPLIANCE         |                                               |
| EXPLORATION   <- banner    |            (page content visuals)             |
|                            |                                               |
| [ > Overview            ]  |                                               |
| [   Risk deep-dive      ]  |                                               |
| [   Controls & ops      ]  |                                               |
| [   Detection layers    ]  |                                               |
|   ^ page navigator (native)|                                               |
|                            |                                               |
| REPORTING PERIOD           |                                               |
| [ 2025-10 |=====| 2026-07 ]|                                               |
|   ^ slicer on DATE[Date]   |                                               |
+----------------------------+-----------------------------------------------+
```

The rail is a navy rectangle plus a page navigator (Insert > Buttons > Navigators). The period
slicer is placed once and synced across the four pages (View > Sync slicers). Card surfaces,
corner radius, and borders are set by `theme.json`, not by manual formatting.

## 3. Theme

[theme.json](theme.json) translates the tokens of `app/styles.css` (CONVENTIONS §2): canvas
`--bg #F5F7FB`, white surface, ink `--text #0A1633`, accent `--brand-blue #2E5BFF`, and the
semantic bad/neutral/good triad `#D64545 / #E8A33D / #2FA36B`. The `dataColors` list holds only
the sober blues and greys; red and amber are applied through conditional formatting or manual
selection ONLY where they carry risk meaning. The font is Segoe UI (the native equivalent of
the board's Inter). Import the theme via View > Browse for themes before creating any visual.

## 4. Page 1 — Overview

Content visuals over the shared shell (§2):

| Idx | Visual | Type | Title | Fields |
|---|---|---|---|---|
| 4 | KPI band | Card (new card visual) | — | `[Unalerted high-risk value]` · `[Escalation gap]` · `[Screening coverage]` · `[Value through non-active accounts]` · `[Unresolved Critical / High]` · `[Chargeback growth]` |
| 5 | Trend | Line chart | Monthly transactions vs alerts created | Axis `DATE[Year-Month]` · Values `[Transaction count]`, `[Alerts created]` |
| 6 | Risk by country | Clustered bar chart | Unalerted high-risk value by country | Axis `transactions[counterparty_country]` · Value `[Unalerted high-risk value]` |

The KPI band presents six measures in a single new card visual. Verified values
(live EVALUATE, 2026-07-14): Unalerted high-risk value **$4,323,306**; Escalation gap
**87.3%**; Screening coverage **66.3%**; Value through non-active accounts **$15,254,133**;
Unresolved Critical/High **8**; Chargeback growth **20.1×**. The line chart plots two counts on
a single axis (never a dual axis): transactions climb while alerts created stay flat. The
`[Unalerted high-risk value]` measure already filters to the sanctioned-country set, so the bar
chart resolves to those countries only.

## 5. Page 2 — Risk deep-dive

Content visuals over the shared shell (§2):

| Idx | Visual | Type | Title | Fields |
|---|---|---|---|---|
| 4 | Escalation funnel | Funnel | Escalation funnel | `[Flagged transaction count]` → `[Flagged no-alert count]` |
| 5 | Unworked high-risk | Table | Unalerted high-risk transactions | `transactions[counterparty_country]` · `[Unalerted high-risk count]` · `[Unalerted high-risk value]` |
| 6 | Amount distribution | Clustered column chart | Transactions per $1,000 band | Axis `transactions[amount (bins)]` · Value `[Transaction count]` |
| 7 | Post-match activity | Matrix | Confirmed matches — activity after the match | `customers[customer_id]` · Min of `sanctions_screening[Screening date]` · `[Post-match value]` |
| 8 | Screening card | Card (new card visual) | — | `[Post-match value]` · `[Never-screened customers]` |
| 9 | Structuring card | Card (new card visual) | — | `[Structuring-band count]` · `[Structuring-band share]` |

The escalation funnel has exactly **two stages**: `[Flagged transaction count]` (409) narrowing
to `[Flagged no-alert count]` (357); the gap between them is the 87.3% `[Escalation gap]`. The
column chart uses the calculated `transactions[amount (bins)]` column (native $1,000 bins) on
its axis, which isolates the $9,000–9,999 structuring band. Verified values (2026-07-14):
Post-match value **$1,856,243**; Never-screened customers **28** (34% of 83); Structuring-band
count **276**; Structuring-band share **17.4%**.

## 6. Page 3 — Controls & operations

Content visuals over the shared shell (§2):

| Idx | Visual | Type | Title | Fields |
|---|---|---|---|---|
| 4 | Value by status | Card (new card visual) | Value by account status | `[Value through non-active accounts]` |
| 5 | Alert backlog | Matrix | — | Rows `compliance_alerts[severity]` · Columns `compliance_alerts[status]` · Values Min of `compliance_alerts[alert_id]` |
| 6 | Volume by status | Bar chart | — | Axis `accounts[status]` · Value `[Transaction count]` |
| 7 | Operations card | Card (new card visual) | — | `[False-positive rate]` · `[Backlog median age (days)]` |
| 8 | Chargeback trend | Clustered column chart | — | Axis `DATE[Year-Month]` · Value `[Monthly chargeback value]` |
| 9 | Misclassification card | Card (new card visual) | Sanctioned-country txns marked domestic | Min of `transactions[transaction_id]` |

The "Value by account status" card reports `[Value through non-active accounts]`
(**$15,254,133** verified) — the value flowing through Closed, Dormant, and Frozen accounts.
The backlog matrix cross-tabulates alerts by severity and status. The volume bar chart plots
`[Transaction count]` by `accounts[status]`. Operations card verified values (2026-07-14):
False-positive rate **76.9%**; Backlog median age **90.5 days**. The chargeback column chart
uses `[Monthly chargeback value]`, which activates the inactive `chargebacks[Chargeback date]`
→ `DATE[Date]` relationship via USERELATIONSHIP; total chargeback value is **$497,020** across
**70** chargebacks (verified 2026-07-14). The final card surfaces sanctioned-country
transactions flagged as domestic.

## 7. Page 4 — Detection layers

Content visuals over the shared shell (§2):

| Idx | Visual | Type | Title | Fields |
|---|---|---|---|---|
| 4 | Tier 1 counter | Card (new card visual) | Tier 1 · transactions | Min of `transaction_scores[transaction_id]` |
| 5 | Tier 1 scatter | Scatter chart | Tier 1 — model score vs amount | Details `transaction_scores[transaction_id]` · X Sum of `transaction_scores[amount]` · Y Sum of `transaction_scores[score]` · Legend `transaction_scores[flagged_by_rules]` |
| 6 | Tier 2 scatter | Scatter chart | Tier 2 — accounts: score vs value | Details `account_scores[account_id]` · X Sum of `account_scores[total]` · Y Sum of `account_scores[score]` · Legend `account_scores[anomaly]` · Size Sum of `account_scores[n_tx]` |
| 7 | Tier 2 counter | Card (new card visual) | Tier 2 · accounts | Min of `account_scores[account_id]` |
| 8 | Tier 3 counter | Card (new card visual) | Tier 3 · customers | Min of `customer_scores[customer_id]` |
| 9 | Tier 3 table | Table | — | `customer_scores[customer_id]` · Sum of `customer_scores[score]` · Sum of `customer_scores[n_anomalous_accounts]` · Sum of `customer_scores[structuring_days]` · Sum of `customer_scores[never_screened]` · Sum of `customer_scores[post_match_value]` · `customer_scores[nationality]` |

The page carries three tier counter cards (transaction / account / customer) alongside the two
scatter charts and the customer-level table. The Tier 1 scatter separates rules-flagged from
model-only transactions via the `flagged_by_rules` legend; the Tier 2 scatter sizes each account
by transaction count and colors it by `anomaly`. The Tier 3 table lists the model's anomalous
customers with their score and supporting features.

## 8. Interactions

- Cross-filtering is left at the Desktop default between visuals on the same page.
- The REPORTING PERIOD slicer on `DATE[Date]` is present on all four pages and synced across
  them (View > Sync slicers).
- Measures anchored to a fixed date are unaffected by the slicer by design:
  `[Backlog median age (days)]` is anchored to 2026-07-11, `[Chargeback growth]` compares the
  latest month against a 2026-03 baseline, and `[Post-match value]` is measured from each
  customer's first confirmed-match date. This is documented in measures.md.
- No custom or AppSource visuals and no preview features are used.

## 9. Decision log

- 2026-07-14 — Page 4 renamed from "Direction layers" to "Detection layers" (confirmed in the
  saved file).
- 2026-07-13 — Four thematic (insight) pages rather than one page per detection tier: the
  deliverable is judged on its headline insights, and the three model tiers are consolidated on
  a single page (Detection layers) that links to the board. Overview is page 1.
- 2026-07-13 — The new card visual is used for the KPI band on Overview; classic cards remain a
  fallback for older Desktop builds.
- 2026-07-13 — Red and amber are excluded from the theme's `dataColors` so the engine cannot
  assign them to decorative series; they are applied only through conditional formatting or
  manual selection on risk visuals (a rule inherited from the board, CONVENTIONS §2).
