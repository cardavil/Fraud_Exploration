# PRD — Fraud & Compliance Exploration Board

Definicion de producto del board publico de exploracion de riesgo y compliance.
Terminologia canonica y reglas de codigo/documentacion en [CONVENTIONS.md](CONVENTIONS.md); analisis completo en [../outputs/EDA_FINDINGS.md](../outputs/EDA_FINDINGS.md).
Fecha del documento: 2026-07-12. Codigo = fuente de verdad (CONVENTIONS §3).

---

## 1. Problema

Un dataset dummy de riesgo y compliance (6 tablas SQLite, sucio: duplicados, whitespace,
casing inconsistente, flags PEP vacios) esconde hallazgos materiales — brecha de escalamiento,
matches de sanciones sin resolver, structuring, controles de estado de cuenta no aplicados,
monitoreo mal calibrado. El entregable clasico (dashboard + resumen ejecutivo) muestra el
resultado pero no el proceso.

Este producto convierte ese analisis en una **herramienta self-serve** que evidencia el
proceso analitico completo: limpieza auditada → EDA → deteccion de anomalias interpretable →
capa de servicio solo-lectura → board web con un copiloto de IA aterrizado en los datos servidos.

**Contexto**: proyecto de portfolio (Layer 2 de un hiring assessment). Disclaimer permanente:
sin afiliacion con ninguna empresa de pagos; datos 100% dummy; ningun dato real de clientes.
Los 5 insights del assessment NO son UI: viven en `reports/EXECUTIVE_SUMMARY.md` (Layer 1).

```
SQLite sucio ──> clean.py ──> clean.db ──> anomaly.py ──> scores
                    │  (audita a cleaning_log)              │
                    └────────── generate_seed.py <──────────┘
                                     │
                                     v
                    Supabase Postgres (RLS: SELECT-only para anon)
                       │                          │
             anon key  │ (solo SELECT)            │ service role
                       v                          v
          Board estatico (Cloudflare Pages)   Edge Function copilot ──> Gemini API
                       │                          ^
                       └───── POST {account_id} ──┘
```

## 2. Modelo funcional: quien ve que, quien hace que

| Actor | Ve | Hace | NO hace |
|---|---|---|---|
| **Visitante** | Los 6 tabs completos, KPIs vivos, datos de las 8 tablas, charts, model card, pipeline del copilot | Navega por hash, filtra el explorador, abre popups KPI, corre el copilot sobre una cuenta | NO escribe nada; NO se autentica; NO ve PII (los datos son dummy y ademas se pseudonimizan en el copilot) |
| **Board / sistema** | Las 8 tablas servidas por PostgREST + `eda_stats.json` y `model_sensitivity.json` estaticos | Lee via anon key con RLS SELECT-only; calcula los KPIs en cliente; renderiza charts SVG | NO escribe en Postgres (sin policy de escritura y privilegios revocados); NO llama a Gemini directo |
| **Copilot** (Edge Function) | Perfil, screening, transacciones, alertas y scores de UNA cuenta via service role | Corre el pipeline de 5 agentes; escribe SOLO `copilot_audit` y los contadores de rate limit (RPC `copilot_hit`) | NO escribe en tablas de datos; NO expone la API key (viaja en header server-side); NO toma decisiones — recomienda |
| **Owner** | Todo el repo, la consola de Supabase, Cloudflare Pages | Mantiene pipeline Python, seed, secrets y deploy; corrige docs en el mismo commit que el codigo | NO commitea tokens ni datos personales; NO edita datos servidos a mano |

## 3. Los 6 tabs y su proposito

| Tab | Proposito | Fuente de datos |
|---|---|---|
| **Overview** | Superficie ejecutiva: 8 KPI tiles calculados en vivo; cada tile abre un popup con definicion, formula exacta con valores vivos, por que importa y link al tab de profundizacion | Las 8 tablas via anon key (`state.kpis` derivado en cliente) |
| **Data** | Explorador de las 8 tablas servidas, con filtros derivados de los propios datos y paginacion | PostgREST (anon key, SELECT-only) |
| **EDA** | El proceso analitico en 6 pasos, con el cleaning log vivo (31 issues auditados por `clean.py`) | Tabla `cleaning_log` + `app/data/eda_stats.json` |
| **Findings** | 6 cards tematicos con charts SVG y tooltip "how to read" por chart | `eda_stats.json` + tablas servidas |
| **ML Model** | Model card del Isolation Forest (300 arboles, 8% contamination, features por cuenta) + sweep real de sensibilidad | Tabla `account_scores` + `app/data/model_sensitivity.json` |
| **AI Engine** | Pipeline visual de los 5 agentes, guardrails, y el runner en vivo del copilot con tabla de auditoria por agente | Edge Function `copilot` (POST `{account_id}`) + `account_scores` para el selector |

Los 8 KPIs de Overview (de `app/js/tab-overview.js`): unalerted high-risk value, escalation gap,
screening coverage, false-positive rate, unresolved Critical/High, value through non-active
accounts, structuring-band share, chargeback growth.

## 4. Contrato de salida del copilot

El Edge Function (`supabase/functions/copilot/index.ts`) fuerza el schema via
`responseSchema` de Gemini; `recommended_action` es un enum cerrado.

```json
{
  "risk_summary": "2-4 frases, hechos materiales primero, siempre cuantificado",
  "key_factors": ["un bullet cuantificado por riesgo distinto"],
  "recommended_action": "Escalate | Request documentation | Close as false positive",
  "confidence": 0.78,
  "run_id": "uuid del run",
  "pipeline": "v2",
  "audit": [
    {
      "agent": "profile_analyst",
      "model_used": "gemini-flash-lite-latest",
      "attempts": 1,
      "fallback_used": false,
      "latency_ms": 2100,
      "ok": true
    }
  ]
}
```

Pipeline interno (5 agentes, secuenciales; tier fast = `gemini-flash-lite-latest`,
tier heavy = `gemini-flash-latest`):

```
POST {account_id}
  -> rate limiter (RPC copilot_hit en Postgres)
  -> anonimizador + sanitizador (tools deterministas)
  -> profile_analyst -> behavior_analyst -> anomaly_interpreter   (fast)
  -> risk_synthesizer -> compliance_reviewer                      (heavy)
  -> JSON verdict + audit[]
```

Degradacion (segun `runPipeline`): si cae UNA nota de analista, el synthesizer sigue con lo
que existe; si cae el reviewer, se sirve el draft del synthesizer marcado en el audit; si cae
el synthesizer, el pipeline falla con error.

## 5. Requerimientos funcionales

**RF1 — Trazabilidad de cifras**: toda cifra mostrada en la UI traza a
`outputs/EDA_FINDINGS.md` o a `app/data/eda_stats.json`; si el codigo cambia un numero,
el doc se corrige en el mismo commit (CONVENTIONS §3).

**RF2 — Serving layer solo lectura**: RLS habilitado en todas las tablas con una unica
policy SELECT para `anon`; privilegios de escritura revocados ademas de la ausencia de
policy (defensa en profundidad). La anon key es publica por diseno.

**RF3 — Popups KPI con formula viva**: cada uno de los 8 tiles abre un modal con
definicion, la formula exacta interpolando los valores vivos del serving layer, "why it
matters" y link al tab de profundizacion (PRD §3).

**RF4 — Explorador de las 8 tablas**: el tab Data filtra `customers`, `accounts`,
`transactions`, `compliance_alerts`, `sanctions_screening`, `chargebacks`,
`account_scores` y `cleaning_log`; los filtros se derivan de los datos, no se hardcodean.

**RF5 — Charts con "how to read"**: cada chart SVG de Findings expone tooltip por punto
y una nota de como leerlo; los charts se generan en `app/js/charts.js`, sin librerias.

**RF6 — Copilot rate-limited**: 8 requests/min por IP + 250/dia globales, aplicados en
Postgres via el RPC atomico `copilot_hit` (no in-process, porque el endpoint es publico).
Si el limitador falla, el copilot falla abierto para no tumbar la demo.

**RF7 — Audit por agente persistido**: cada run escribe una fila por agente en
`copilot_audit` (solo service role): `run_id`, `account_id`, `agent`, `model_used`,
`attempts`, `fallback_used`, `latency_ms`, `ok`. El mismo audit vuelve en la respuesta
y se renderiza como tabla en el tab AI Engine.

**RF8 — Anonimizacion PII**: `full_name` y `date_of_birth` nunca se seleccionan de la
base; el modelo ve un pseudonimo (`Customer CUST0000`). Datos dummy, pero el pipeline se
construye como si no lo fueran.

**RF9 — Defensa contra prompt injection**: todo dato de cuenta viaja envuelto como
`<data>` (DATA de terceros, no instrucciones); cada string se sanitiza (control chars,
code fences, tope de 300 chars); la salida se fuerza por JSON schema; el reviewer
descarta cifras no trazables a las notas.

**RF10 — Deep links por hash**: cada tab es direccionable por hash (`#data`, `#eda`,
`#findings`, `#ml`, `#engine`); los links internos y los modales navegan via `goTo(tab)`.

**RF11 — Validacion de entrada del copilot**: `account_id` debe cumplir `^ACC\d{5}$`;
metodo POST unico; CORS restringido al origen de Cloudflare Pages y localhost.

## 6. No-goals

| No-goal | Razon |
|---|---|
| Sin auth ni gestion de usuarios | El board es publico por diseno; RLS hace segura la anon key |
| Sin escritura desde la UI | Unica escritura del sistema: `copilot_audit` + contadores de rate limit, ambas server-side |
| Sin Power BI en el board | El .pbix es Layer 1 (entregable mandado); el board es Layer 2 y no lo embebe |
| Sin datos reales | Dataset dummy siempre; el disclaimer es permanente |
| El copilot no toma decisiones | Recomienda una accion del enum cerrado; la decision es humana |

## 7. Metricas de exito

| Metrica | Objetivo | Como se verifica |
|---|---|---|
| Board carga sin errores desde el serving layer | 6 tabs renderizan con datos vivos | Smoke test manual en el deploy de Pages |
| KPIs reproducibles | Los 8 valores coinciden con EDA_FINDINGS.md | RF1: trazabilidad de cifras |
| Escritura imposible via anon key | INSERT/UPDATE/DELETE rechazados | Verificacion RLS post-seed (hecha 2026-07-12) |
| Copilot completa un run | ~30 s, 5 agentes, verdict + audit renderizados | Runner del tab AI Engine |
| Abuso contenido | 429 al exceder 8/min/IP o 250/dia | RPC `copilot_hit` |
| Historia legible como portfolio | Un revisor sigue todo el camino analitico sin el repo | Recorrido Overview → Data → EDA → Findings → ML → Engine |

## 8. Evolucion futura

| Evolucion | Descripcion |
|---|---|
| Warehouse analitico | Separar la capa analitica (agregacion pesada, features, backtesting) a BigQuery o Snowflake; Postgres queda como serving operacional alimentado por marts curados |
| Datos frescos | Reemplazar el seed estatico por ingesta periodica; "now" dejaria de estar fijado a 2026-07-11 |
| Mas connectors | Nuevos tools deterministas para los agentes (listas de sanciones externas, adverse media, device data) sin tocar el contrato de salida (PRD §4) |
| PII real | Enmascarado/tokenizacion antes del serving y modelo en entorno controlado, como anota el README |

---

## Registro de decisiones

**2026-07-12** — v2.1 "nivel perfilador" (patron tomado de Conciliacion): se agregan RF de
perfilado por columna en el tab Data, ejemplos before/after expandibles en la limpieza (EDA
paso 2), panel de integridad computado live (FKs, duplicados, umbral de vacios 20%) y
drill-down hallazgo→Data con filtros pre-aplicados (`FE.openData`). Los 5 insights del
entregable siguen fuera de la UI (reporte anexo). **Vigente.**
