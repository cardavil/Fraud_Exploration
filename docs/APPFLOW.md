# APPFLOW — Fraud & Compliance Exploration Board

Los cuatro flujos del sistema: el recorrido del visitante por el board, el pipeline de datos
de SQLite crudo a Supabase y Pages, el request del sentinel de punta a punta (con sus caminos
de degradacion) y el flujo de deploy. Fuentes: `app/js/core.js`, `app/js/tab-*.js`,
`supabase/functions/sentinel/index.ts`, `supabase/deploy_function.py`, `wrangler.toml`.
Docs hermanos: [UI.md](UI.md) (sistema visual) · [MOCKUPS.md](MOCKUPS.md) (wireframes) ·
[TRD.md](TRD.md) (diseno tecnico) · [PRD.md](PRD.md) (producto).
Fecha: 2026-07-12.

---

## 1. Flujo del visitante

El board es un recorrido guiado: del resumen ejecutivo (Overview) hacia la evidencia
(Data → EDA → Findings → ML) y remata en la maquina (AI Engine). Router por hash en
`core.js`: cada tab es linkeable (`#overview` ... `#engine`) y se renderiza lazy en su
primera activacion.

```
Visitante llega (Cloudflare Pages)
        |
        v
FE.boot()  -- en paralelo: data/eda_stats.json + data/model_sensitivity.json
        |     + 8 tablas via PostgREST (paginado Range de a 1,000)
        |     -> computeKpis(): una sola fuente para tiles y popups
        v
#overview  OVERVIEW — 8 KPI tiles (grid 4x2, MOCKUPS §2)
        |
        |  click en un tile
        v
POPUP (modal): definicion + formula viva + why it matters + link al tab
        |
        |  click en "See the full picture in the <tab> tab ->"
        v
#data      DATA — 8 tablas crudas, filtros derivados por tipo de columna
        |
        v
#eda       EDA — proceso en 6 pasos (cleaning log en vivo, stats, charts)
        |
        v
#findings  FINDINGS — 6 hallazgos tematicos, cada uno con su chart de evidencia
        |
        v
#ml        ML MODEL — model card + sweep de sensibilidad + cuentas anomalas
        |
        v
#engine    AI ENGINE — pipeline visible + guardrails + runner en vivo
        |
        |  selecciona cuenta + Analyze  (~30 s, 5 llamadas secuenciales)
        v
POST al sentinel -> 5 stages pulsing -> verdict + audit por agente (§3)
```

Notas:
- Si `boot()` falla, ningun tab se renderiza: banner de error global con retry (UI §5).
- La navegacion tambien funciona directo por URL con hash; hash desconocido cae a
  `overview` (`activateTab` en `core.js`).

## 2. Flujo de datos

Pipeline reproducible de punta a punta: cada paso es un script re-ejecutable y ningun
numero se edita a mano (CONVENTIONS §2). Rama izquierda: el dato servido (Supabase).
Rama derecha: los estadisticos precalculados que viajan como JSON estatico con el frontend.

```
data/Risk_and_compliance_dummy_dataset.db     (SQLite crudo, 6 tablas sucias)
        |
        v
analysis/clean.py  ------------------------>  outputs/cleaning_log.csv
        |                                     (31 issues, cero fixes silenciosos)
        v
data/clean.db      (SQLite limpio)
        |
        +--------------------------------------------+
        |                                            |
        v                                            v
analysis/anomaly.py                        analysis/export_eda_stats.py
  Isolation Forest 300 trees / 8%                    |
        |                                            v
        v                                  app/data/eda_stats.json
outputs/account_features_scores.csv                  |
outputs/anomalous_accounts.csv             analysis/model_sensitivity.py
        |                                            |
        v                                            v
supabase/generate_seed.py                  app/data/model_sensitivity.json
        |                                            |
        v                                            |
supabase/seed.sql                                    |
  (DDL + INSERTs + RLS SELECT-only)                  |
        |                                            |
        v                                            v
supabase/apply_seed.py                     Cloudflare Pages
        |                                    (sirve /app como estaticos)
        v                                            |
Supabase Postgres  (8 tablas; anon = solo SELECT)    |
        |                                            |
        v                                            v
PostgREST /rest/v1  ----------------->  navegador: FE.boot()
  (supabaseFetchAll pagina con                (junta ambas ramas en
   headers Range 0-999, 1000-1999, ...)        window.FE.state)
```

Notas:
- Las 8 tablas servidas: `customers`, `accounts`, `transactions`, `compliance_alerts`,
  `sanctions_screening`, `chargebacks`, `account_scores` (derivada del modelo) y
  `cleaning_log` (el audit trail de limpieza, servido como dato).
- Division de responsabilidad: lo que es join/filtro se computa en vivo en el navegador
  (`computeKpis`, `tab-findings.js`); lo que es estadistica (percentiles, Cramer's V,
  sweep del modelo) viene precalculado en los JSON — asi cada cifra traza a un script.

## 3. Flujo del sentinel end-to-end

Un POST dispara el pipeline de 5 agentes dentro del Edge Function
(`supabase/functions/sentinel/index.ts`). Detalle de agentes y wrapper en TRD §4-§5.

```
POST /functions/v1/sentinel   body: { account_id }
  |
  |   OPTIONS ------------------> 200 (CORS: ALLOWED_ORIGINS
  |                                    + *.fraud-exploration.pages.dev)
  |   metodo != POST -----------> 405
  |   falta GEMINI_API_KEY -----> 503
  v
VALIDACION
  |   body no es JSON ----------> 400
  |   no matchea ^ACC\d{5}$ ----> 400
  v
RATE LIMITER — RPC sentinel_hit(ip, 8/min, 250/dia)   [atomico, en Postgres]
  |   limite alcanzado ---------> 429
  |   RPC caido ----------------> fail open (una caida del limiter
  |                                no tumba la demo)
  v
LOOKUP CUENTA — accounts?account_id=eq.{id}&select=customer_id
  |   no existe ----------------> 404
  v
run_id = crypto.randomUUID()
  v
LOOP x5 agentes (secuencial):  profile_analyst -> behavior_analyst ->
  |                            anomaly_interpreter -> risk_synthesizer ->
  |                            compliance_reviewer
  |
  |  por agente:
  |   1. TOOLS declarados (least privilege): fetchers deterministas;
  |      full_name y date_of_birth jamas se seleccionan (pseudonimo
  |      "Customer CUST0000"); los 2 agentes heavy no tienen tools,
  |      reciben las notas previas
  |   2. SANITIZE — sanitizeDeep(): control chars -> espacio,
  |      ``` -> ', strings cap a 300 chars, recursivo
  |   3. PROMPT — persona + instruccion + <data>JSON</data>
  |      (todo dato enmarcado como DATA de terceros, no instrucciones)
  |   4. callModel(): cadena preferido -> fallbacks (max 3 modelos:
  |      gemini-flash-latest -> flash-lite-latest -> 2.0-flash);
  |      preferido 2 intentos con backoff 500ms*intentos, resto 1;
  |      timeout 25 s; responseSchema JSON; temperature 0.2;
  |      API key en header x-goog-api-key (nunca en la URL)
  |
  |  DEGRADACION (3 caminos):
  |   - nota de analista (fast) caida --> placeholder
  |     { risk_level: "medium", assessment: "unavailable", key_points: [] }
  |     y el pipeline sigue: el synthesizer ve lo que exista
  |   - reviewer caido con draft ------> final = draft del synthesizer,
  |     flaggeado en el audit (ok: false en su fila)
  |   - synthesizer caido -------------> throw -> 500
  v
PERSISTIR AUDIT — INSERT en sentinel_audit (service-role only):
  |   run_id, account_id, agente, modelo usado, intentos, fallback,
  |   latencia, ok — un fallo aqui se loggea pero NO es fatal
  v
200 JSON:
  { risk_summary, key_factors[], recommended_action, confidence,
    run_id, pipeline: "v2", audit[] }
        |
        v
frontend (tab-engine.js): stages done/failed + latencias,
verdict con badge de accion, tabla de audit por agente (MOCKUPS §8)
```

## 4. Flujo de deploy

Dos artefactos, dos caminos independientes. Detalle en TRD §9.

```
FRONTEND (estaticos)                     SENTINEL (Edge Function)
--------------------                     -----------------------
git push a main (GitHub)                 cambio en functions/sentinel/index.ts
        |                                        |
        v                                        v
Cloudflare Pages                         python supabase/deploy_function.py
  (integracion Git: build en push)         (auth: SUPABASE_ACCESS_TOKEN
  lee wrangler.toml:                        en env var; sin Docker, sin CLI)
    pages_build_output_dir = "app"               |
    sin comando de build                         v
        |                                Supabase Management API
        v                                  POST /v1/projects/{ref}
https://fraud-exploration.pages.dev            /functions/deploy?slug=sentinel
  (sirve /app tal cual)                    multipart: metadata (entrypoint
                                           index.ts, verify_jwt: true)
                                           + el fuente index.ts
                                                 |
                                                 v
                                         Edge Function sentinel en vivo
                                           (secrets aparte:
                                            GEMINI_API_KEY y overrides
                                            GEMINI_MODEL / _FAST via
                                            Supabase secrets)
```

Notas:
- El seed de datos NO es parte del deploy: se corre una vez con
  `supabase/apply_seed.py` (§2) y el board lee siempre lo mismo.
- El frontend no tiene paso de build: `wrangler.toml` solo declara que la raiz
  publicable es `app/`.
