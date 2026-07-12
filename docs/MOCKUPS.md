# MOCKUPS — Fraud & Compliance Exploration Board

Wireframes ASCII de las pantallas del board, una por seccion, tal como estan implementadas
en `app/index.html` + `app/js/tab-*.js`. Tokens, componentes y reglas de color en UI;
la logica detras de cada pantalla en APPFLOW.
Docs hermanos: [UI.md](UI.md) (sistema visual) · [APPFLOW.md](APPFLOW.md) (flujos) ·
[TRD.md](TRD.md) (diseno tecnico).
Fecha: 2026-07-12.

---

## 1. Shell (topbar + tabbar + panel + footer)

```
+-----------------------------------------------------------------------------+
| TOPBAR (navy #0A1633)                                                       |
|  Fraud & Compliance Exploration Board                 ( Dummy data )  pill  |
|  From raw data to AI-assisted triage — an end-to-end risk & ...             |
+-----------------------------------------------------------------------------+
| TABBAR (sticky top 0, superficie blanca, borde inferior)                    |
|  Overview   Data   EDA   Findings   ML Model   AI Engine                    |
|  ========                                          <- activo: borde azul 3px|
+-----------------------------------------------------------------------------+
|                                                                             |
|  MAIN (max-width 1560px, centrado)                                          |
|  [ banner de error global — oculto salvo fallo de boot ]                    |
|  [ "Loading the serving layer…" mientras carga ]                            |
|  [ tab-panel activo — los otros cinco ocultos ]                             |
|                                                                             |
+-----------------------------------------------------------------------------+
| FOOTER: Repo & methodology · Full EDA findings · Design docs                |
|         Personal portfolio project on a dummy dataset — no real ...         |
+-----------------------------------------------------------------------------+
```

La tabbar queda pegada arriba al hacer scroll (UI §3.1); todo el contenido usa el ancho
completo hasta 1560px. Modal y tooltip de charts viven fuera del main como overlays.

## 2. Overview (grid 4x2 de KPI tiles)

```
 intro: "Executive surface ... click one for its definition" + links a los tabs

+----------------+----------------+----------------+----------------+
|=== rojo =======|=== rojo =======|=== ambar ======|=== ambar ======|
| UNALERTED      | ESCALATION     | SCREENING      | FALSE-POSITIVE |
| HIGH-RISK VALUE| GAP            | COVERAGE       | RATE           |
|                |                |                |                |
| $4.32M         | 87%            | 66%            | 77%            |
| 147 sanctioned-| 357 of 411     | 28 of 83 cust. | 37 of 48 closed|
| country txns...| flagged txns...| never screened | alerts were FP |
+----------------+----------------+----------------+----------------+
|=== rojo =======|=== rojo =======|=== ambar ======|=== ambar ======|
| UNRESOLVED     | VALUE THROUGH  | STRUCTURING-   | CHARGEBACK     |
| CRITICAL/HIGH  | NON-ACTIVE     | BAND SHARE     | GROWTH         |
|                | ACCOUNTS       |                |                |
| 8              | $15.3M         | 17.4%          | 20x            |
| high-severity  | 224 txns thru  | 276 txns in    | monthly value  |
| alerts open    | Closed/Dorm/Frz| $9,000-9,999...| $30K -> $600K  |
+----------------+----------------+----------------+----------------+
```

Cada tile es un `<button>` con borde superior semantico (rojo `.kpi-risk`, ambar
`.kpi-warn`) y abre el popup de §3. Colapsa a 2 columnas ≤1080px y 1 columna ≤560px.
Los valores mostrados son ilustrativos: se computan en vivo (`computeKpis`, APPFLOW §1).

## 3. Popup de KPI (modal)

```
        (backdrop rgba(10,22,51,.45) — click fuera cierra)
   +---------------------------------------------------------+
   |  Unalerted high-risk value                        [ x ]  |
   |---------------------------------------------------------|
   |  Total value of transactions with counterparties in     |
   |  sanctioned or high-risk jurisdictions (Iran, North     |
   |  Korea, Syria, Russia, Myanmar, Afghanistan) that never  |
   |  generated a compliance alert.                           |
   |                                                          |
   |  +-----------------------------------------------------+ |
   |  | 147 sanctioned-country txns − 0 with an alert       | |  <- caja de
   |  | = 147 unalerted worth $4,318,569                    | |     formula viva
   |  +-----------------------------------------------------+ |     (fondo tint)
   |                                                          |
   |  Why it matters: These are the highest-inherent-risk    |
   |  flows in the book. Every one was detected — none was   |
   |  worked. ...                                             |
   |                                                          |
   |  See the full picture in the findings tab ->             |  <- cierra modal
   +---------------------------------------------------------+     y navega
```

`role="dialog"` + `aria-modal`; foco al boton de cierre al abrir; cierra con Esc, click
fuera o la [x] (UI §6). La formula usa los mismos numeros del tile — una sola fuente.

## 4. Data explorer (selector + filtros + tabla + paginacion)

```
+-----------------------------------------------------------------------------+
| Table                          The transaction ledger    1,203 of 1,600 rows|
| [ transactions (1,600) v ]     (1,600 rows).             · $18.2M total amt |
|-----------------------------------------------------------------------------|
| transaction_id   account_id      amount            transaction_date   ...   |
| [contains…]      [contains…]     [min] [max]       [from][to]         ...   |
|                                                                             |
| counterparty_country  flagged_for_review  is_international                  |
| [ All          v ]    [ All  v ]          [ All v ]        <- categoricas   |
|-----------------------------------------------------------------------------|
| TRANSACTION_ID | ACCOUNT_ID | AMOUNT    | ... | COUNTERPARTY | FLAGGED      |
|----------------+------------+-----------+-----+--------------+--------------|
| TXN00042       | ACC00017   |     9,420 | ... | Iran         | Yes          |
| TXN00043       | ACC00088   |    12,003 | ... | Germany      | No           |
|   ... (25 filas por pagina, hover en fila) ...                              |
|-----------------------------------------------------------------------------|
| Page 1 of 49                                   [ <- Prev ]  [ Next -> ]     |
+-----------------------------------------------------------------------------+
```

Los filtros se generan del tipo real de cada columna (UI §3.3): categorica→select,
numerica→min/max, fecha→rango, texto→contains. Todo client-side; el resumen y la
paginacion se recalculan en cada tecla.

## 5. EDA step (circulo numerado + titulo + cuerpo)

```
+==(borde izquierdo azul 3px)=================================================+
|  (4)  Descriptive statistics                                                |
|   ^-- circulo 28px azul, numero en blanco                                   |
|                                                                             |
|  +--------------+--------------+--------------+--------------+             |
|  | N (VALID)    | MEAN         | MEDIAN       | STD DEV      |  stat-tiles |
|  | 1,587        | $11,412      | $2,310       | $28,940      |  (fondo     |
|  +--------------+--------------+--------------+--------------+   tint)     |
|  | CV           | SKEWNESS     | KURTOSIS     | P95 / MAX    |             |
|  | 2.54         | +6.1         | +48.2        | $52K / $663K |             |
|  +--------------+--------------+--------------+--------------+             |
|                                                                             |
|  The mean is ~5x the median: a small number of very large wires             |
|  dominates total value. Operational thresholds should key off the           |
|  MEDIAN, not the mean.                                                      |
+=============================================================================+
```

Seis pasos asi apilados (intake → cleaning log en vivo → verificacion de conteos con
badges → estadisticos → charts en grid 2 col → asociaciones). Numeros ilustrativos:
vienen de `eda_stats.json` (APPFLOW §2).

## 6. Finding card (titulo + lead + chart con figcaption)

```
+------------------------------------------------------------------+
| Detection works; escalation doesn't                              |
|                                                                  |
| All 147 sanctioned-country transactions were flagged by the      |
| rules — but only 0 ever became an alert, leaving $4.3M unworked. |
|                                                                  |
| The escalation funnel, in transactions        (i) how to read    |  <- figcaption
|                                                                  |
| Flagged for review     |||||||||||||||||||||||||||||  411        |
| ...that got an alert   ||||  54                                  |  <- rojo, bold
| Sanctioned-country txns|||||||||||  147                          |
| ...that got an alert   |  0                                      |  <- rojo, bold
|                                                                  |
|        ^ hover sobre cualquier barra -> tooltip navy con detalle |
+------------------------------------------------------------------+
```

Seis cards en grid de 2 columnas (1 col ≤1180px). Cada chart lleva su boton
"ⓘ how to read" y tooltip por marca (UI §4); las barras enfatizadas llevan direct
label en tinta bold, el resto en muted.

## 7. ML (2 col: model card | sweep; abajo anomalias con score bar)

```
+--------------------------------+---------------------------------+
| Why Isolation Forest           | Parameter behavior — a real     |
|  ...no labels, auditable...    | sweep, not defaults on faith    |
|                                |                                 |
| How it was applied             | Anomalies flagged vs            |
|  transactions -> 12 features   | contamination   (i) how to read |
|  -> StandardScaler ->          |    ___/----  100 trees (azul)   |
|  IsolationForest(300, 8%)      |  _/----      300 trees (ambar)  |
|                                | /----        500 trees (verde)  |
| FEATURE      | MEANING         |  4%   6%   8%   10%   12%       |
| n_tx         | Number of txns  |                                 |
| pct_hr       | Share to sanc.. | Chosen: contamination 8% = 9 of |
| ...          | ...             | 105 accounts; 300 trees; seed.  |
+--------------------------------+---------------------------------+
| Results — 9 anomalous accounts, 5 never alerted                  |
|------------------------------------------------------------------|
| ACC00100  · High risk · Active · 12 txns · $663K   Never alerted |  <- rojo
| [==============================________________]                 |  <- score track
| Why: [value/month: $663K (14x median)] [txns/month: ...]         |     6px azul
|------------------------------------------------------------------|
| ACC00031  · Low risk · Active · 45 txns · $412K  (Has alert hist)|  <- badge plain
| [======================__________________________]               |
| Why: [sanctioned-country share: 40% (8x median)] ...             |
+------------------------------------------------------------------+
```

Grid `ml-grid` de 2 columnas (1 col ≤1180px). El score track es proporcional al score
maximo y lleva `aria-label` con el valor (UI §3.6); los why-chips explican que features
se desvian vs la mediana poblacional.

## 8. AI Engine (pipeline + agent cards + runner con audit)

```
+-----------------------------------------------------------------------------+
| Pipeline                                                                    |
|                                                                             |
| [POST        ]   [rate limiter ]   [anonymizer +]   [profile ]   [behavior] |
| [{account_id}] -> [Postgres RPC] -> [sanitizer   ] -> [analyst ] -> [analyst ]|
|   navy (io)        ambar (guard)     ambar (guard)    tint(fast)  tint(fast)|
|                                                                             |
|    [anomaly    ]    [risk       ]    [compliance ]    [JSON verdict]        |
| -> [interpreter] -> [synthesizer] -> [reviewer   ] -> [+ audit[]   ]        |
|     tint (fast)      AZUL (heavy)     AZUL (heavy)     navy (io)            |
+-----------------------------------------------------------------------------+
| [profile_analyst  (fast tier)]  [behavior_analyst (fast tier)]  [anomaly_.. ]|
|  KYC & sanctions-screening...    Transactional patterns...       Reads the  |
|  tools: profileFetcher,          tools: txnAggregator,           IF output..|
|  screeningFetcher · out:         txnSampler, alertFetcher        tools:     |
|  profile_risk                    · out: behavior_risk            scoreFet.. |
+-----------------------------------------------------------------------------+
| Guardrails: [Model wrapper] [Data anonymization] [Prompt-injection] [...]   |
+-----------------------------------------------------------------------------+
| Run it — grounded risk narrative for one account      ~30 s: five calls     |
|                                                                             |
| [ ACC00100 ⚠ anomalous · High risk        v ]        [ Analyze ]            |
|                                                                             |
| (profile_analyst 2.1s) -> (behavior_analyst 1.8s) -> (anomaly_int...) ->    |
|      done: verde              done: verde               pulsing: azul       |
|                                                                             |
| Risk summary: Account ACC00100 moved $663K in a single day...               |
| Recommended action: ( Escalate )  <- badge rojo   · model confidence 85%    |
| Key factors:  • $663K single-day burst ...  • never alerted ...             |
|                                                                             |
| Per-agent audit (run 3f2a...)                                               |
| AGENT             | MODEL USED           | ATTEMPTS | FALLBACK | LAT.  | OK |
| profile_analyst   | gemini-flash-lite-.. |    1     | no       | 2.1s  | ✓  |
| risk_synthesizer  | gemini-flash-latest  |    2     | no       | 6.4s  | ✓  |
| compliance_review | gemini-2.0-flash     |    3     | fallback | 9.0s  | ✓  |
+-----------------------------------------------------------------------------+
```

Los nodos del pipeline visualizan el flujo real del Edge Function (APPFLOW §3, TRD §4):
io en navy, guards en ambar, agentes fast en tint y heavy en azul. Los stages del runner
pasan de pulsing a done/failed con la latencia real del `audit[]`; la accion recomendada
usa la semantica de badges (Escalate=rojo, Request documentation=ambar, Close as FP=verde).
