# CONVENTIONS — Fraud & Compliance Exploration Board

Terminologia canonica y reglas de codigo, documentacion y commits del proyecto.
Definicion de producto en [PRD.md](PRD.md); analisis en [../outputs/EDA_FINDINGS.md](../outputs/EDA_FINDINGS.md).
Fecha del documento: 2026-07-12.

---

## 1. Terminologia canonica

Regla: **un concepto = un termino**. Si un termino nuevo entra al codigo o a un doc,
este glosario se actualiza en el mismo commit.

| Termino | Significado | Evitar |
|---|---|---|
| **board** | La web estatica completa en Cloudflare Pages (`app/`) | "dashboard", "app", "sitio" |
| **tab** | Una de las 6 vistas del board (Overview, Data, EDA, Findings, ML Model, AI Engine); modulo `app/js/tab-*.js` | "pagina", "seccion", "panel" |
| **serving layer** | Supabase Postgres + PostgREST con RLS SELECT-only para anon | "backend", "la base", "API" |
| **anon key** | Key publica del frontend; segura porque RLS la limita a SELECT | "api key publica", "token" |
| **finding** | Hallazgo tematico con card + chart en el tab Findings (son 6) | confundir con "insight" |
| **insight** | Uno de los 5 del entregable ejecutivo (`reports/EXECUTIVE_SUMMARY.md`) — NO es UI | confundir con "finding" |
| **KPI** | Tile del tab Overview (son 8); cada uno abre popup con definicion, formula viva y "why it matters" | "metrica", "indicador", "card" |
| **sentinel** | El Edge Function `supabase/functions/sentinel/index.ts` completo (pipeline v2) | "el bot", "la IA", "el asistente" |
| **agente** | Uno de los 5 del pipeline del sentinel: profile_analyst, behavior_analyst, anomaly_interpreter, risk_synthesizer, compliance_reviewer | "paso", "prompt", "modelo" |
| **tool** | Fetcher determinista que alimenta a un agente (profileFetcher, screeningFetcher, txnAggregator, txnSampler, scoreFetcher, alertFetcher) | "helper", "query", "funcion" |
| **model wrapper** | `callModel`: unico punto de llamada a Gemini, con retry + backoff + fallback chain y key en header | "cliente", "SDK" |
| **fallback chain** | Cadena de aliases de modelo: `gemini-flash-latest → gemini-flash-lite-latest → gemini-2.0-flash` | "backup model", "plan B" |
| **audit trail** | La tabla `sentinel_audit` (una fila por agente por run: run_id, model_used, attempts, fallback_used, latency_ms, ok) y su eco en la respuesta | "logs", "historial" |
| **banda structuring** | Transacciones de $9,000–9,999, justo bajo el umbral de reporte de $10,000 | "smurfing band", "rango sospechoso" |
| **HR country** | Pais del set de alto riesgo: Iran, North Korea, Syria, Russia, Myanmar, Afghanistan (`HIGH_RISK` en codigo) | "pais sancionado" a secas, listas ad-hoc |
| **offshore** | Pais del set offshore: Cayman Islands, British Virgin Islands, Panama, Cyprus, Malta (`OFFSHORE` en codigo) | "paraiso fiscal", listas ad-hoc |
| **cleaning log** | `outputs/cleaning_log.csv` y su tabla servida `cleaning_log`: los 31 issues tratados por `clean.py`, uno por fila | "log de errores", "changelog" |

## 2. Codigo

**Vanilla JS sin build**: el board es HTML/JS/CSS plano; ningun bundler, framework ni
paso de compilacion. Cloudflare Pages sirve `app/` tal cual en cada push.

**Modulos por tab**: cada tab vive en su propio `app/js/tab-*.js` y se registra en
`window.FE.tabs`; render lazy en la primera activacion. Lo compartido (estado, fetch
Supabase, router por hash, modal, formatters) vive solo en `app/js/core.js`; los charts
solo en `app/js/charts.js`.

**Tokens CSS en `:root`**: todo color, espaciado o radio sale de las custom properties
de `:root` — nunca hex sueltos en reglas ni en JS. La semantica de riesgo es fija:
rojo = sanctioned, ambar = offshore/warn.

**Nombres descriptivos, nunca genericos**: `summarizeTransactions`, `withinLimits`,
`persistAudit` — no `helper`, `process`, `doStuff`. Aplica a funciones, variables,
tablas y clases CSS.

**Comentarios = restricciones funcionales, nunca tareas**: un comentario explica por que
el codigo es asi ("Fail open: a limiter outage must not take the demo down", "URLs leak
into logs"), no que falta por hacer. Sin TODO/FIXME en main.

**Python re-ejecutable desde la raiz**: `python analysis/clean.py` →
`python analysis/anomaly.py` → `python supabase/generate_seed.py` reconstruyen todo
end-to-end. Nunca "arreglar" datos sospechosos en silencio: todo tratamiento se registra
en el patron del cleaning log (CONVENTIONS §1).

## 3. Documentacion

**Code as source of truth**: ante cualquier discrepancia entre un doc y el codigo, manda
el codigo, y el doc se corrige **en el mismo commit** que detecto o creo la discrepancia.

**Cifras siempre trazables**: todo numero en docs o en copy de UI traza a
`outputs/EDA_FINDINGS.md` o a `app/data/eda_stats.json` (PRD §5, RF1). Si un script
cambia un numero, EDA_FINDINGS.md se actualiza en el mismo commit.

**Estandar de casa**: espanol sin acentos; apertura
`# TITULO — Fraud & Compliance Exploration Board` + alcance de 1-3 lineas con links a
docs hermanos + `---`; secciones numeradas `## 1.`; tablas para lo enumerable; diagramas
solo ASCII en code fences (nunca mermaid); cross-refs estilo `PRD §4`; lead-ins en bold
`**RF1 — nombre**:`; fechas `yyyy-mm-dd`.

**Sin datos personales del propietario**: los docs se refieren a "el propietario" u
"owner"; nunca nombre, email ni caracterizaciones. El disclaimer de no-afiliacion y
datos dummy se mantiene en README y PRD.

## 4. Commits

**Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:` con scope
opcional (`feat(engine): ...`). Mensaje en el mismo tono del proyecto: conciso, primero
el que y el por que.

**Un cambio logico por commit**: codigo + su doc/glosario actualizado viajan juntos
(CONVENTIONS §3); cambios no relacionados se separan.

**Sin trailers de coautoria**: ningun `Co-Authored-By` ni firmas de herramientas. La
historia de git es parte del portfolio y debe leerse como trabajo del propietario.

**La historia es parte del portfolio**: no se reescribe main; los mensajes cuentan la
evolucion del proyecto (limpieza → modelo → serving → board → sentinel) y un revisor debe
poder auditarla commit a commit.

---

## 5. Copy de UI (v3.1, 2026-07-12)

- Tono profesional y declarativo: hechos con numeros, maximo una frase interpretativa por
  bloque. Sin metaforas, sin meta-comentario sobre el propio analisis, sin dramatizacion,
  sin retorica de guiones.
- Titulos = frases nominales descriptivas ("Parameter sensitivity", "Account detail").
- El registro de la conversacion de desarrollo NUNCA se traslada al producto.
- Terminos del glosario, tambien en identificadores de codigo. Filas nuevas:

| Termino | Significado | Evitar |
|---|---|---|
| model-only detection | deteccion del modelo sin flag del motor de reglas | needle, aguja |
| account detail | vista de perfil+actividad+modelo+controles de una cuenta | story, dossier, historia |
| in-browser verification | recomputo local de scores contra el pipeline | live scoring, demo |

| Sentinel | agente IA de analisis de sujetos (pipeline de 5 agentes en Edge Function) | copilot, Compliance Copilot |

- Los bloques colapsables de notas (`details.notes` / `details.criteria-legend`) van SIEMPRE
  al final del card o seccion, despues de los datos que anotan — nunca antes.

| evidence strength | fuerza de evidencia computada del checklist de señales (strong/moderate/limited) | confidence, confianza del modelo |

## 6. Capa semantica Power BI (2026-07-13)

El .pbix (entregable Layer 1) importa las 9 tablas del dataset `fraud_exploration`
de BigQuery (proyecto `fraud-exploration-cd`). Reglas del modelo semantico:

| Objeto | Convencion |
|---|---|
| Tablas y columnas fisicas | snake_case identico al warehouse — lineage 1:1 con BigQuery; nunca se renombran |
| Columnas de fecha | las fisicas (texto ISO) permanecen ocultas; cada una tiene su columna calculada tipada Date en sentence case ("Transaction date") |
| Medidas | termino canonico del KPI tile o del glosario, verbatim, en sentence case ("Unalerted high-risk value", "Unresolved Critical / High"); un concepto nuevo exige su fila de glosario en el mismo commit (§1) |
| Formulas | identicas a la superficie canonica (KPI tile / `eda_stats.json`); toda cifra reproduce EDA_FINDINGS (§3) |
| Tabla de medidas | todas las medidas viven en `KPI` (tabla calculada dummy con su unica columna oculta; termino del glosario §1 — "Measures" a secas es nombre reservado del motor) |
| Display folders | numerados por el orden de insights del executive summary: 00 Base, 01 Escalation gap, 02 Sanctions screening, 03 Structuring, 04 Account controls, 05 Operations |
| Tabla Date | calculada (CALENDAR 2025-2026) y marcada como date table; unica relacion activa a `transactions[Transaction date]`; Alert/Chargeback/Screening date se activan con USERELATIONSHIP en medidas puente (Alerts created, Monthly chargeback value) |
