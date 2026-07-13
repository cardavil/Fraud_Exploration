# LAYOUT_SPEC — Fraud & Compliance Exploration Board

Diseno del tablero Power BI (entregable Layer 1): 4 paginas, storytelling por insight,
mockups y mapeo visual-por-visual para armado mecanico en Desktop. Medidas y modelo en
[measures.md](measures.md); tema en [theme.json](theme.json); convenciones de la capa
semantica en [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md) §6; cifras trazan a
[../reports/EXECUTIVE_SUMMARY.md](../reports/EXECUTIVE_SUMMARY.md).
Fecha del documento: 2026-07-13.

---

## 1. Principios de diseno

Sintesis de la investigacion (tendencias 2025-2026 de dashboards ejecutivos y reportes
de compliance) aplicada a este tablero:

| Principio | Aplicacion aqui |
|---|---|
| Una pantalla, sin scroll | cada pagina cierra su mensaje en un canvas 16:9; el detalle vive en su pagina, no debajo del fold |
| Patron Z | banda de KPI cards arriba (lo mas critico arriba-izquierda), tendencia al centro, desglose abajo-derecha |
| Titulo de pagina = oracion | el titulo afirma el hallazgo ("Detection works; escalation does not"), no un sustantivo ("Alerts") |
| Rejilla de 8px | gutters de 8/16px, bordes alineados, maximo 8 visuales por pagina |
| Disciplina de color | paleta sobria navy/azul/grises; rojo y ambar RESERVADOS a semantica de riesgo (sanctioned / warning), nunca decorativos — misma regla del board |
| Riesgo nunca solo por color | rojo/ambar siempre acompanados de etiqueta o icono (accesibilidad y lectura regulatoria) |
| Sin metricas desnudas | todo numero lleva contexto en reference label gris ("357 of 409 flagged") |
| Sello de frescura | "Data as of 2026-07-11" en la esquina superior derecha de cada pagina (el "now" canonico de CLAUDE.md) |
| Nav de rail izquierdo | franja navy con Page Navigator nativo + slicer de periodo, identica jerarquia visual al topbar del board |

Solo features GA de Desktop (sin visuales custom, sin previews): new card visual,
page navigator, button slicer, small multiples, decomposition tree, conditional
formatting, binning nativo. El list slicer (preview) queda excluido.

## 2. Estructura: 4 paginas, insights como historia

Los tres niveles de deteccion (transaction → account → customer) NO son las paginas:
el entregable se evalua por los 5 insights del executive summary, asi que las paginas
siguen esa numeracion (que ya es la de las carpetas de medidas 01-05). Los tres niveles
viven juntos en la pagina 4 como diferenciador que enlaza con el board (Layer 2).

| # | Pagina | Titulo (oracion) | Insights |
|---|---|---|---|
| 1 | Overview | Detection works; escalation does not | los 5, en 30 segundos |
| 2 | Risk deep-dive | Where the unworked risk concentrates | 01 escalation gap · 02 screening · 03 structuring |
| 3 | Controls & operations | Controls unenforced, monitoring unscaled | 04 account controls · 05 operations |
| 4 | Detection layers | Three model tiers surface what rules miss | modelo ML (transaction → account → customer) |

### Shell comun (todas las paginas)

```
+==(rail navy #0A1633, 168px)==+==(canvas #F5F7FB)=========================================+
|                              |                                                           |
|  FRAUD & COMPLIANCE          |  <Titulo-oracion 20px semibold>       Data as of          |
|  EXPLORATION                 |                                       2026-07-11          |
|   ^-- 13px, blanco           |   ^-- #0A1633                          ^-- 10px gris      |
|                              |                                                           |
|  [ > Overview            ]   |                                                           |
|  [   Risk deep-dive      ]   |            (area de visuales de la pagina)                |
|  [   Controls & ops      ]   |                                                           |
|  [   Detection layers    ]   |                                                           |
|   ^-- Page Navigator nativo, |                                                           |
|       seleccionado = fondo   |                                                           |
|       rgba blanco .12        |                                                           |
|                              |                                                           |
|  REPORTING PERIOD            |                                                           |
|  [ 2025-10 |======| 2026-07 ]|                                                           |
|   ^-- slicer Between sobre   |                                                           |
|       DATE[Date], sync en    |                                                           |
|       las 4 paginas          |                                                           |
+------------------------------+-----------------------------------------------------------+
```

El rail es un rectangulo navy + Page Navigator (Insert > Buttons > Navigators); el slicer
de periodo se sincroniza en las 4 paginas (View > Sync slicers). Cards blancos, radio 10,
borde #E3E8F2 — los fija theme.json, no formateo manual.

## 3. Tema

[theme.json](theme.json) traduce los tokens de `app/styles.css` (CONVENTIONS §2):
canvas `--bg #F5F7FB`, superficie blanca, tinta `--text #0A1633`, acento `--brand-blue
#2E5BFF`, semantica bad/neutral/good = `#D64545 / #E8A33D / #2FA36B`. dataColors solo
contiene azules/grises sobrios — el rojo/ambar se aplica por formato condicional o
seleccion manual SOLO donde significa riesgo. Fuente Segoe UI (equivalente nativo del
Inter del board). Importar via View > Browse for themes ANTES de crear visuales.

## 4. Pagina 1 — Overview

```
+==(canvas)==================================================================================+
|  Detection works; escalation does not                            Data as of 2026-07-11    |
|                                                                                            |
|  +----------+ +----------+ +----------+ +----------+ +----------+ +----------+            |
|  | $4.32M   | | 87.3%    | | 66.3%    | | $15.3M   | | 8        | | 20.1x    |            |
|  | Unalerted| | Escalat. | | Screening| | Non-activ| | Unresolv.| | Chargebk |            |
|  | high-risk| | gap      | | coverage | | accounts | | Crit/High| | growth   |            |
|  | 147 txns | | 357 of   | | 28 never | | Closed+  | | median   | | Mar->Jul |            |
|  |          | | 409 flag.| | screened | | Dorm+Frzn| | 90 days  | | monthly  |            |
|  +----------+ +----------+ +----------+ +----------+ +----------+ +----------+            |
|   ^-- new card visual (6 cards en 1 visual), callout 28px, reference label 10px gris;     |
|       $4.32M y 8 con acento rojo, 66.3% y 20.1x con acento ambar (riesgo, no decorado)    |
|                                                                                            |
|  +--------------------------------------------------+  +--------------------------------+ |
|  | Monthly transactions vs alerts created           |  | Unalerted high-risk value      | |
|  | 300|                    ____ transactions (azul) |  | by counterparty country        | |
|  |    |               ____/                         |  |  Iran        ============ $1.xM| |
|  | 150|        ______/                              |  |  Russia      =========         | |
|  |    | ______/                                     |  |  Syria       ======            | |
|  |   0| .-.-.-.-.-.-.-.-.-. alerts (gris #5A6B8C)   |  |  North Korea ====              | |
|  |    +------------------------------------------   |  |  Myanmar     ===               | |
|  |     Oct    Dec    Feb    Apr    Jun              |  |  Afghanistan ==   (barras rojas)| |
|  +--------------------------------------------------+  +--------------------------------+ |
|   ^-- el mensaje central: volumen x3, alertas planas     ^-- riesgo detectado sin caso    |
+============================================================================================+
```

| Visual | Tipo (nativo) | Campos | Nota |
|---|---|---|---|
| Banda KPI | Card (nuevo) x6 | [Unalerted high-risk value] · [Escalation gap] · [Screening coverage] · [Value through non-active accounts] · [Unresolved Critical / High] · [Chargeback growth] | reference labels: [Unalerted high-risk count] "txns" · "[Flagged no-alert count] of [Flagged transaction count] flagged" · "[Never-screened customers] never screened" · "Closed+Dormant+Frozen" · "median [Backlog median age (days)] days" · "Mar -> Jul monthly value" |
| Tendencia central | Line chart | Eje X: DATE[Year-Month] · Y: [Transaction count] y [Alerts created] | ambas son conteos: un solo eje, JAMAS eje dual; transactions #2E5BFF, alerts #5A6B8C punteada; etiqueta directa al final de cada linea, sin leyenda |
| Riesgo por pais | Bar chart horizontal | Eje: transactions[counterparty_country] · X: [Unalerted high-risk value] | solo paises HR quedan (la medida ya filtra); barras #D64545; data labels $ |

Interaccion: clic en un pais cruza-filtra la tendencia; cada card no filtra (son titulares).

## 5. Pagina 2 — Risk deep-dive

```
+==(canvas)==================================================================================+
|  Where the unworked risk concentrates                            Data as of 2026-07-11    |
|                                                                                            |
|  01 ESCALATION GAP                        02 SANCTIONS SCREENING                           |
|  +------------------------------------+  +----------------------------------------------+ |
|  | Flagged 409 ==================     |  | Confirmed matches — post-match activity       | |
|  | Alerted   52 ====                  |  | customer  match date   post-match value       | |
|  | Unworked 357 ================ (rojo)|  | CUST0079  2025-11-02   ========== $1.00M     | |
|  |  ^-- funnel/bar de 3 pasos         |  | CUST0035  2026-01-15   ======== $844K        | |
|  +------------------------------------+  | CUST0012  2026-02-08   == $8K                | |
|  +------------------------------------+  | CUST0044  2026-03-19   = $2K                 | |
|  | Unalerted high-risk transactions   |  |  ^-- matrix, data bars rojos                 | |
|  | country      txns   value          |  +----------------------------------------------+ |
|  | Iran          52   $1.2M           |  +----------------------+ +---------------------+ |
|  | Russia        41   $0.9M           |  | $1.85M               | | 28 (34%)            | |
|  |  ^-- table, data bars              |  | Post-match value     | | Never-screened      | |
|  +------------------------------------+  +----------------------+ +---------------------+ |
|                                                                                            |
|  03 STRUCTURING                                                                            |
|  +--------------------------------------------------------------------------------------+ |
|  | Transactions per $1k band          276                                                | |
|  |  100|  91   87   75   90  +----+   78   52      <- bins nativos de $1,000 sobre       | |
|  |     | ==== ==== ==== ==== |####| ==== ====         transactions[amount]; banda 9-10k  | |
|  |     | 5-6k 6-7k 7-8k 8-9k |9-10| 10-11 11-12       en ambar #E8A33D, resto #9DB1F2;   | |
|  |     +---------------------+----+------------       card lateral: 17.4% / 3.3x vecinos | |
|  +--------------------------------------------------------------------------------------+ |
+============================================================================================+
```

| Visual | Tipo | Campos | Nota |
|---|---|---|---|
| Funnel escalation | Funnel o bar | [Flagged transaction count] · [Flagged no-alert count] (+ conteo alertado por resta visual) | barra "unworked" roja; titulo con [Escalation gap] |
| Tabla HR sin alerta | Table | transactions[counterparty_country] · [Unalerted high-risk count] · [Unalerted high-risk value] | data bars en value; orden desc |
| Matriz post-match | Matrix | account_scores... via customers: customer_id, sanctions_screening[Screening date] (min) · [Post-match value] | data bars rojos; solo match_result = "Confirmed Match" (filtro de visual) |
| Cards screening | Card x2 | [Post-match value] · [Never-screened customers] | never-screened con "(34%)" en reference label desde [Screening coverage] |
| Histograma structuring | Column chart | Eje X: bins de $1,000 sobre transactions[amount] (clic derecho > New group > Bin size 1000) · Y: [Transaction count] | resaltar banda 9-10k ambar via formato condicional; cards laterales [Structuring-band count] y [Structuring-band share] |

## 6. Pagina 3 — Controls & operations

```
+==(canvas)==================================================================================+
|  Controls unenforced, monitoring unscaled                        Data as of 2026-07-11    |
|                                                                                            |
|  04 ACCOUNT CONTROLS                      05 OPERATIONS                                    |
|  +------------------------------------+  +----------------------------------------------+ |
|  | Value by account status            |  | Alert backlog by severity and status         | |
|  | Active  ================== $56.2M  |  |           Open  Escal.  U.Rev.  Closed       | |
|  | Dormant ==== $8.6M  (ambar)        |  | Critical  [2]   [1]    [1]      [8]          | |
|  | Closed  === $5.3M   (ambar)        |  | High      [3]   [.]    [1]      [15]         | |
|  | Frozen  = $1.4M     (ambar)        |  | Medium/Lo [..]  [..]   [..]     [..]         | |
|  |  ^-- $15.3M no deberia moverse     |  |  ^-- matrix, fondo condicional rojo en        | |
|  +------------------------------------+  |      Critical/High no cerrados                | |
|  +------------------------------------+  +----------------------------------------------+ |
|  | 148                                |  +----------------------+ +---------------------+ |
|  | sanctioned-country txns            |  | 77% False-positive   | | 90 days median      | |
|  | marked "domestic"                  |  | rate (closed alerts) | | backlog age         | |
|  |  ^-- card con nota                 |  +----------------------+ +---------------------+ |
|  +------------------------------------+  +----------------------------------------------+ |
|                                          | Monthly chargeback value       $124.9K       | |
|                                          |  120K|                    ____/####          | |
|                                          |      |            ____/####                  | |
|                                          |   60K|      ____/                            | |
|                                          |     0| ==__/     (columnas ambar)            | |
|                                          |      +-- Mar Apr May Jun Jul --- 20.1x ->    | |
|                                          +----------------------------------------------+ |
+============================================================================================+
```

| Visual | Tipo | Campos | Nota |
|---|---|---|---|
| Valor por status | Bar chart | accounts[status] · [Total transaction value] | Active gris #9DB1F2; Closed/Dormant/Frozen ambar (formato condicional por regla); titulo cita [Value through non-active accounts] |
| Card misclasificados | Card | conteo de transactions con filtro visual counterparty_country HR + is_international = "No" | el numero canonico es 148 (EDA_FINDINGS) |
| Backlog matrix | Matrix | filas compliance_alerts[severity] · columnas compliance_alerts[status] · valores conteo alert_id | fondo rojo condicional en Critical/High con status no "Closed…" |
| Cards ops | Card x2 | [False-positive rate] · [Backlog median age (days)] | |
| Chargebacks | Column chart | Eje X: DATE[Year-Month] · Y: [Monthly chargeback value] | columnas ambar; card [Chargeback growth] al lado; el eje usa la relacion inactiva via la medida puente |

## 7. Pagina 4 — Detection layers

```
+==(canvas)==================================================================================+
|  Three model tiers surface what rules miss                       Data as of 2026-07-11    |
|                                                                                            |
|  +----------+     +----------+     +----------+                                            |
|  | 80 / 1600|  -> | 9 / 105  |  -> | 5 / 59   |   <- cards: anomalias por nivel;          |
|  | txns     |     | accounts |     | customers|      flujo transaction -> account ->       |
|  +----------+     +----------+     +----------+      customer (flechas = shapes)           |
|                                                                                            |
|  +--------------------------------------------+  +--------------------------------------+ |
|  | Tier 1 — model score vs amount             |  | Tier 2 — accounts: score vs value    | |
|  |  score|        . x        x model-only     |  | score|         o    O = anomalo      | |
|  |       |     .x. .  x      . rules-flagged  |  |      |      o    O  (rojo si sin     | |
|  |       |  . .:.::.                          |  |      |  o o   O     alerta previa)   | |
|  |       +--------------- amount ($ log)      |  |      +-------------- total value     | |
|  +--------------------------------------------+  +--------------------------------------+ |
|                                                                                            |
|  +--------------------------------------------------------------------------------------+ |
|  | Tier 3 — anomalous customers                                                          | |
|  | customer  score  anomalous accts  structuring days  never screened  post-match value | |
|  | CUST0054  -0.08        0                12               si   (!)         $0         | |
|  | CUST00xx  ...          ...              ...              ...              ...        | |
|  |  ^-- table: iconos condicionales en structuring days > 0 y never screened            | |
|  +--------------------------------------------------------------------------------------+ |
|  Verificacion en navegador y detalle por cuenta: fraud-exploration.pages.dev (Layer 2)    |
+============================================================================================+
```

| Visual | Tipo | Campos | Nota |
|---|---|---|---|
| Cards por nivel | Card x3 | conteos de transaction_scores / account_scores / customer_scores con filtro visual anomaly = -1 | subtitulos "of 1,600 / of 105 / of 59 active" |
| Scatter tier 1 | Scatter | X: transaction_scores[amount] · Y: transaction_scores[score] · leyenda: flagged_by_rules | model-only en azul #2E5BFF, rules-flagged gris; eje X escala log si el sesgo molesta |
| Scatter tier 2 | Scatter | X: account_scores[total] · Y: account_scores[score] · tamano: n_tx · leyenda: anomaly | anomalos con borde; rojo solo si has_alert = false (riesgo sin caso) |
| Tabla tier 3 | Table | customer_scores: customer_id, score, n_anomalous_accounts, structuring_days, never_screened, post_match_value, nationality | filtro visual anomaly = -1; iconos condicionales (! en structuring_days > 0 y never_screened = 1) |
| Nota Layer 2 | Text box | enlace al board | cierra la historia de dos capas |

## 8. Interacciones

- Cross-filtering por defecto entre visuales de la misma pagina; sin drillthrough
  obligatorio (opcional: clic derecho pais -> Risk deep-dive).
- Tooltips por defecto enriquecidos: agregar [Total transaction value] al pozo de
  tooltip de los charts de transacciones.
- El slicer de periodo (DATE) se sincroniza en las 4 paginas. Las medidas con fecha
  fija ([Backlog median age (days)], [Chargeback growth], [Post-match value]) son
  inmunes por diseno — documentado en measures.md.
- Sin visuales custom de AppSource, sin features preview: el archivo abre limpio en
  cualquier Desktop razonablemente actual.

## 9. Checklist de armado (orden mecanico)

1. View > Browse for themes > `powerbi/theme.json`.
2. Canvas: Page view 16:9; fondo lo da el tema. Crear las 4 paginas con sus nombres.
3. Shell en pagina 1: rectangulo navy 168px + titulo + Page Navigator + slicer DATE
   (estilo Between) -> copiar el shell a las otras 3 paginas; View > Sync slicers.
4. Overview: card visual x6 -> line chart -> bar por pais (tabla §4).
5. Risk deep-dive: funnel + tabla HR + matrix post-match + cards + bins de $1,000
   sobre transactions[amount] + histograma (tabla §5).
6. Controls & ops: bar por status + card 148 + matrix backlog + cards + columnas
   mensuales de chargebacks (tabla §6).
7. Detection layers: 3 cards + 2 scatters + tabla tier 3 + text box con el enlace
   (tabla §7).
8. Sello "Data as of 2026-07-11" (text box 10px gris) en cada pagina.
9. Revision final contra §1: sin eje dual, rojo/ambar solo semantico, sin metricas
   desnudas, alineacion a la rejilla, y numeros contra EXECUTIVE_SUMMARY.md.

## Registro de decisiones

- 2026-07-13 — 4 paginas tematicas (insights) y NO una pagina por nivel de deteccion:
  el entregable se evalua por los 5 insights; los 3 niveles del modelo son UNA pagina
  (Detection layers) que enlaza al board. Overview no falta: es la pagina 1.
- 2026-07-13 — new card visual (GA nov-2025) para la banda KPI; fallback documentado:
  cards clasicos si el Desktop del revisor fuera anterior a 2024.
- 2026-07-13 — rojo/ambar excluidos de dataColors del tema para que el motor no los
  asigne a series decorativas; se aplican solo por formato condicional o seleccion
  manual en visuales de riesgo (regla heredada del board, CONVENTIONS §2).
