# DATABASE — Fraud & Compliance Exploration Board

Esquema completo de Postgres (Supabase): las 8 tablas del seed generadas por `supabase/generate_seed.py` + las 3 tablas operativas del sentinelo (`supabase/rate_limit.sql`, `supabase/audit.sql`), con DDL real, quien escribe cada cosa, reglas de integridad y limites.
Docs hermanos: [PRD.md](PRD.md) (producto y alcance) · [TRD.md](TRD.md) (arquitectura y pipeline de IA).
Fecha: 2026-07-12.

---

## 1. Principios

| Principio | Detalle |
|---|---|
| Single-writer | TODO lo escribe el seed o el sistema: el seed puebla las 8 tablas de datos, la RPC `sentinel_hit` escribe los contadores, la Edge Function escribe el audit. El visitante NUNCA escribe nada |
| RLS en TODAS | Las 8 del seed: RLS + una policy SELECT-only para `anon`/`authenticated`. Las 3 operativas: RLS habilitado SIN policies + `REVOKE ALL` — solo el service role (que bypasea RLS) las toca |
| Defensa en profundidad | Ademas de RLS, `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` en las 8 del seed: aunque apareciera una policy de escritura por error, el privilegio no existe (TRD §3) |
| Naming | `snake_case` en tablas y columnas; IDs `text` con prefijo (`CUST...`, `ACC...`, `TXN...`) |
| Seed generado | `seed.sql` lo emite `generate_seed.py` desde `data/clean.db` + `outputs/account_features_scores.csv` — nunca se edita a mano |

Patron RLS aplicado a cada una de las 8 tablas del seed (emitido por `generate_seed.py::rls`):

```sql
ALTER TABLE {tabla} ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {tabla} FROM anon, authenticated;
CREATE POLICY "{tabla}_read_only" ON {tabla} FOR SELECT TO anon, authenticated USING (true);
```

Inventario:

| Tabla | Filas | Escribe | Acceso anon |
|---|---|---|---|
| `customers` | 83 | seed | SELECT |
| `accounts` | 105 | seed | SELECT |
| `transactions` | 1,600 | seed | SELECT |
| `compliance_alerts` | 65 | seed | SELECT |
| `sanctions_screening` | 95 | seed | SELECT |
| `chargebacks` | 70 | seed | SELECT |
| `account_scores` | 105 | seed | SELECT |
| `cleaning_log` | 31 | seed | SELECT |
| `sentinel_usage` | 1/dia | rpc | ninguno |
| `sentinel_ip_usage` | efimera | rpc | ninguno |
| `sentinel_audit` | 5/run | sentinel | ninguno |

## 2. customers

Titulares (KYC): identidad, tipo, PEP y rating de riesgo. PK `customer_id`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `customer_id` | text | seed | PK, formato `CUST####` |
| `full_name` | text | seed | Nombre completo (dummy). JAMAS se selecciona hacia el modelo (TRD §6) |
| `date_of_birth` | date | seed | Fecha de nacimiento. JAMAS se selecciona hacia el modelo (TRD §6) |
| `nationality` | text | seed | Nacionalidad — se cruza con el set de paises sancionados |
| `occupation` | text | seed | Ocupacion declarada — plausibilidad vs actividad |
| `customer_type` | text | seed | Individual / Business |
| `pep_flag` | text | seed | Persona expuesta politicamente; vacios recodeados `Unknown` por `clean.py` |
| `risk_rating` | text | seed | Rating KYC (Low/Medium/High) |
| `onboarding_date` | date | seed | Alta del cliente |
| `onboarding_channel` | text | seed | Canal de alta |

```sql
CREATE TABLE customers (
  customer_id        text PRIMARY KEY,
  full_name          text,
  date_of_birth      date,
  nationality        text,
  occupation         text,
  customer_type      text,
  pep_flag           text,
  risk_rating        text,
  onboarding_date    date,
  onboarding_channel text
);
```

## 3. accounts

Cuentas por cliente con estado y saldo. PK `account_id`, FK a `customers`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `account_id` | text | seed | PK, formato `ACC#####` (validado `^ACC\d{5}$` en el sentinelo) |
| `customer_id` | text | seed | FK → `customers.customer_id` |
| `account_type` | text | seed | Tipo de cuenta |
| `currency` | text | seed | Moneda |
| `open_date` | date | seed | Apertura |
| `status` | text | seed | Active / Closed / Dormant / Frozen — clave para el hallazgo de control failures |
| `branch_country` | text | seed | Pais de la sucursal |
| `account_balance` | numeric(14,2) | seed | Saldo |

```sql
CREATE TABLE accounts (
  account_id      text PRIMARY KEY,
  customer_id     text REFERENCES customers(customer_id),
  account_type    text,
  currency        text,
  open_date       date,
  status          text,
  branch_country  text,
  account_balance numeric(14,2)
);
```

## 4. transactions

Movimientos: la tabla mas grande y el corazon del analisis. PK `transaction_id`, FK a `accounts`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `transaction_id` | text | seed | PK — tambien tiebreaker de paginacion (TRD §3) |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `transaction_date` | date | seed | Fecha |
| `amount` | numeric(14,2) | seed | Monto; la banda 9,000-9,999 es la zona de structuring |
| `transaction_type` | text | seed | Tipo (Cash..., Wire, etc.) |
| `channel` | text | seed | Canal |
| `counterparty_name` | text | seed | Contraparte |
| `counterparty_country` | text | seed | Pais contraparte — se cruza con sets sancionado/offshore |
| `is_international` | text | seed | Yes/No — flag conocido como NO confiable (148 txns sancionadas marcadas domesticas) |
| `flagged_for_review` | text | seed | Yes/No — marca del sistema fuente |

```sql
CREATE TABLE transactions (
  transaction_id       text PRIMARY KEY,
  account_id           text REFERENCES accounts(account_id),
  transaction_date     date,
  amount               numeric(14,2),
  transaction_type     text,
  channel              text,
  counterparty_name    text,
  counterparty_country text,
  is_international     text,
  flagged_for_review   text
);
```

## 5. compliance_alerts

Alertas del motor de reglas y su ciclo de vida. PK `alert_id`, FKs a `accounts` y `transactions`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `alert_id` | text | seed | PK |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `transaction_id` | text | seed | FK → `transactions.transaction_id` (nullable — no toda alerta apunta a una txn) |
| `alert_date` | date | seed | Creacion de la alerta |
| `alert_type` | text | seed | Tipo (structuring, sanctions, etc.) |
| `severity` | text | seed | Critical / High / Medium / Low |
| `status` | text | seed | Abierta o `Closed - ...` (incluye `Closed - False Positive`) |
| `assigned_analyst` | text | seed | Analista asignado (nullable — backlog sin asignar) |
| `resolution_date` | date | seed | Cierre |
| `sar_filed` | text | seed | Se presento SAR |

```sql
CREATE TABLE compliance_alerts (
  alert_id         text PRIMARY KEY,
  account_id       text REFERENCES accounts(account_id),
  transaction_id   text REFERENCES transactions(transaction_id),
  alert_date       date,
  alert_type       text,
  severity         text,
  status           text,
  assigned_analyst text,
  resolution_date  date,
  sar_filed        text
);
```

## 6. sanctions_screening

Historial de screening contra listas de sancionados. PK `screening_id`, FK a `customers`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `screening_id` | text | seed | PK |
| `customer_id` | text | seed | FK → `customers.customer_id`; clientes SIN fila aqui = nunca screeneados (34%) |
| `screening_date` | date | seed | Fecha del screening |
| `list_checked` | text | seed | Lista consultada |
| `match_result` | text | seed | Resultado (match confirmado / no match / ...) |
| `reviewed_by` | text | seed | Revisor |
| `review_status` | text | seed | Estado de la revision |

```sql
CREATE TABLE sanctions_screening (
  screening_id   text PRIMARY KEY,
  customer_id    text REFERENCES customers(customer_id),
  screening_date date,
  list_checked   text,
  match_result   text,
  reviewed_by    text,
  review_status  text
);
```

## 7. chargebacks

Contracargos de tarjeta con red, comercio y responsabilidad. PK `chargeback_id`, FKs a `transactions` y `accounts`; escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `chargeback_id` | text | seed | PK |
| `transaction_id` | text | seed | FK → `transactions.transaction_id` |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `chargeback_date` | date | seed | Fecha del contracargo |
| `amount` | numeric(14,2) | seed | Monto disputado |
| `card_network` | text | seed | Red de tarjeta |
| `merchant_name` | text | seed | Comercio |
| `reason_category` | text | seed | Categoria del motivo |
| `filed_by` | text | seed | Quien presento |
| `status` | text | seed | Estado |
| `resolution_date` | date | seed | Resolucion |
| `liability_party` | text | seed | Parte responsable |

```sql
CREATE TABLE chargebacks (
  chargeback_id   text PRIMARY KEY,
  transaction_id  text REFERENCES transactions(transaction_id),
  account_id      text REFERENCES accounts(account_id),
  chargeback_date date,
  amount          numeric(14,2),
  card_network    text,
  merchant_name   text,
  reason_category text,
  filed_by        text,
  status          text,
  resolution_date date,
  liability_party text
);
```

## 8. account_scores

Tabla derivada: features de comportamiento por cuenta + salida del Isolation Forest (`anomaly.py` → `outputs/account_features_scores.csv`). PK `account_id` (1:1 con `accounts`); escribe el seed.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `account_id` | text | seed | PK y FK → `accounts.account_id` |
| `n_tx` | integer | seed | Numero de transacciones |
| `avg_amt` | double precision | seed | Monto promedio |
| `std_amt` | double precision | seed | Desviacion estandar del monto |
| `max_amt` | double precision | seed | Monto maximo |
| `total` | double precision | seed | Valor total movido |
| `pct_hr` | double precision | seed | Fraccion hacia paises sancionados |
| `pct_off` | double precision | seed | Fraccion hacia offshore |
| `pct_cash` | double precision | seed | Fraccion en efectivo |
| `pct_struct` | double precision | seed | Fraccion en la banda 9,000-9,999 |
| `pct_intl` | double precision | seed | Fraccion internacional |
| `tx_per_month` | double precision | seed | Velocidad (txns/mes) |
| `velocity_value` | double precision | seed | Valor/mes |
| `anomaly` | integer | seed | -1 = anomala, 1 = normal (Isolation Forest) |
| `score` | double precision | seed | Mas alto = mas anomala |
| `customer_id` | text | seed | FK → `customers.customer_id` (denormalizado para el board) |
| `status` | text | seed | Copia de `accounts.status` (denormalizado) |
| `branch_country` | text | seed | Copia denormalizada |
| `full_name` | text | seed | Copia denormalizada — el sentinelo NUNCA la selecciona (TRD §6) |
| `risk_rating` | text | seed | Copia denormalizada del rating KYC |
| `pep_flag` | text | seed | Copia denormalizada |
| `has_alert` | boolean | seed | La cuenta tiene alguna alerta; false + anomaly=-1 = el motor de reglas la perdio |

```sql
CREATE TABLE account_scores (
  account_id     text PRIMARY KEY REFERENCES accounts(account_id),
  n_tx           integer,
  avg_amt        double precision,
  std_amt        double precision,
  max_amt        double precision,
  total          double precision,
  pct_hr         double precision,
  pct_off        double precision,
  pct_cash       double precision,
  pct_struct     double precision,
  pct_intl       double precision,
  tx_per_month   double precision,
  velocity_value double precision,
  anomaly        integer,
  score          double precision,
  customer_id    text REFERENCES customers(customer_id),
  status         text,
  branch_country text,
  full_name      text,
  risk_rating    text,
  pep_flag       text,
  has_alert      boolean
);
```

## 9. cleaning_log

Bitacora de los 31 tratamientos de limpieza aplicados por `clean.py` (transparencia metodologica del board). PK `step_id`; escribe el seed desde `outputs/cleaning_log.csv`.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `step_id` | integer | seed | PK secuencial (1..31, generado al armar el seed) |
| `table_name` | text | seed | Tabla afectada (renombrado desde `table` del CSV) |
| `issue` | text | seed | Problema detectado |
| `treatment` | text | seed | Tratamiento aplicado |
| `rows_affected` | integer | seed | Filas afectadas |

```sql
CREATE TABLE cleaning_log (
  step_id       integer PRIMARY KEY,
  table_name    text,
  issue         text,
  treatment     text,
  rows_affected integer
);
```

## 10. sentinel_usage

Contador global diario del sentinelo (cap 250/dia, TRD §7). PK `day`; escribe SOLO la RPC `sentinel_hit`.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `day` | date | rpc | PK — un registro por dia (`CURRENT_DATE`) |
| `hits` | integer | rpc | Runs acumulados del dia; se compara contra `max_per_day` |

DDL y funcion escritora, copiados de `supabase/rate_limit.sql`:

```sql
CREATE TABLE IF NOT EXISTS sentinel_usage (
  day  date PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0
);
ALTER TABLE sentinel_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel_usage, sentinel_ip_usage FROM anon, authenticated;
-- No policies on purpose: only the service role (bypasses RLS) touches them.

CREATE OR REPLACE FUNCTION sentinel_hit(client_ip text, max_per_min integer, max_per_day integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ip_ok boolean;
  day_ok boolean;
BEGIN
  INSERT INTO sentinel_ip_usage AS i (ip, minute, hits)
  VALUES (client_ip, date_trunc('minute', now()), 1)
  ON CONFLICT (ip, minute) DO UPDATE SET hits = i.hits + 1
  RETURNING i.hits <= max_per_min INTO ip_ok;

  INSERT INTO sentinel_usage AS u (day, hits)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (day) DO UPDATE SET hits = u.hits + 1
  RETURNING u.hits <= max_per_day INTO day_ok;

  -- Opportunistic cleanup; the table stays tiny.
  DELETE FROM sentinel_ip_usage WHERE minute < now() - interval '1 day';

  RETURN ip_ok AND day_ok;
END;
$$;
REVOKE EXECUTE ON FUNCTION sentinel_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
```

## 11. sentinel_ip_usage

Contador por IP y minuto (limite 8/min/IP, TRD §7). PK compuesta `(ip, minute)`; escribe SOLO la RPC `sentinel_hit`, que ademas borra filas de mas de 1 dia en cada llamada — tabla autolimpiante.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `ip` | text | rpc | IP del cliente (primer valor de `x-forwarded-for`, o `unknown`) |
| `minute` | timestamptz | rpc | Ventana `date_trunc('minute', now())` — parte de la PK |
| `hits` | integer | rpc | Requests de esa IP en ese minuto; se compara contra `max_per_min` |

```sql
CREATE TABLE IF NOT EXISTS sentinel_ip_usage (
  ip     text NOT NULL,
  minute timestamptz NOT NULL,
  hits   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, minute)
);
ALTER TABLE sentinel_ip_usage ENABLE ROW LEVEL SECURITY;
```

## 12. sentinel_audit

Traza por agente por run del pipeline (TRD §8): 5 filas por ejecucion. PK `id` (identity); escribe SOLO la Edge Function `sentinel` (service role) via `persistAudit`.

| Columna | Tipo | Escribe | Descripcion |
|---|---|---|---|
| `id` | bigint identity | sentinel | PK autogenerada |
| `run_id` | uuid | sentinel | Agrupa las 5 filas de un run (`crypto.randomUUID()`); indexado |
| `account_id` | text | sentinel | Cuenta analizada |
| `agent` | text | sentinel | Uno de los 5 agentes (TRD §4) |
| `model_used` | text | sentinel | Modelo que respondio; NULL si fallaron los 3 de la cadena |
| `attempts` | integer | sentinel | Intentos acumulados en el wrapper (retry + fallbacks) |
| `fallback_used` | boolean | sentinel | true si respondio un modelo distinto al preferido (o fallo total) |
| `latency_ms` | integer | sentinel | Latencia total del wrapper para ese agente |
| `ok` | boolean | sentinel | El agente produjo salida valida; el reviewer con ok=false marca un final degradado (TRD §4) |
| `ts` | timestamptz | sentinel | DEFAULT now() |

DDL copiado de `supabase/audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS sentinel_audit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        uuid NOT NULL,
  account_id    text,
  agent         text NOT NULL,
  model_used    text,
  attempts      integer,
  fallback_used boolean,
  latency_ms    integer,
  ok            boolean,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_audit_run_idx ON sentinel_audit (run_id);
ALTER TABLE sentinel_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel_audit FROM anon, authenticated;
```

## 13. Reglas de integridad

Grafo de FKs (todas declaradas en el DDL del seed; verificadas con 0 violaciones tras el seed):

```
customers --1:N--> accounts --1:N--> transactions
    |                 |                  |
    |                 +--1:N--> compliance_alerts (account_id; transaction_id N:1 nullable a transactions)
    |                 +--1:N--> chargebacks       (account_id; transaction_id N:1 a transactions)
    |                 +--1:1--> account_scores    (account_id PK+FK)
    +--1:N--> sanctions_screening (customer_id)
    +--1:N--> account_scores      (customer_id, denormalizado)

cleaning_log: sin FKs — metadato del pipeline de limpieza
sentinel_usage / sentinel_ip_usage / sentinel_audit: sin FKs — operativas, aisladas del dataset
```

Counts esperados tras cada seed (los imprime `apply_seed.py` junto con `relrowsecurity`):

| Tabla | Filas |
|---|---|
| `customers` | 83 |
| `accounts` | 105 |
| `transactions` | 1,600 |
| `compliance_alerts` | 65 |
| `sanctions_screening` | 95 |
| `chargebacks` | 70 |
| `account_scores` | 105 |
| `cleaning_log` | 31 |

Matriz RLS/privilegios:

| Grupo | RLS | Policy | Privilegios anon/authenticated |
|---|---|---|---|
| 8 tablas del seed | ON | `{tabla}_read_only` — SELECT para anon y authenticated | Solo SELECT; INSERT/UPDATE/DELETE/TRUNCATE revocados |
| 3 tablas operativas | ON | NINGUNA (a proposito) | `REVOKE ALL` — nada; solo el service role las toca. `EXECUTE` de `sentinel_hit` tambien revocado de PUBLIC/anon/authenticated |

## 14. Limites y escala

- **Free tier de Supabase**: el dataset completo (~2.2k filas de datos + operativas minusculas) esta ordenes de magnitud por debajo de cualquier limite de almacenamiento o ancho de banda; el unico limite operativo real es la pausa por inactividad del proyecto (TRD §1).
- **Dataset estatico**: en runtime nadie escribe las 8 tablas del seed; solo crecen `sentinel_audit` (5 filas por run, cap efectivo 250 runs/dia por el rate limit) y los contadores (`sentinel_ip_usage` se autolimpia a 1 dia dentro de la propia RPC; `sentinel_usage` es 1 fila por dia).
- **Re-seed idempotente via DROP CASCADE**: `seed.sql` abre con `DROP TABLE IF EXISTS {tabla} CASCADE` en orden inverso de dependencias y recrea todo (DDL + datos + RLS) en una sola pasada; re-ejecutar `generate_seed.py` + `apply_seed.py` deja la base identica sin pasos manuales. Las tablas operativas viven fuera del seed y sobreviven al re-seed.
- **Camino de crecimiento**: si el dataset creciera, los INSERTs ya van en lotes de 200 y la lectura del board ya pagina con Range + tiebreaker (TRD §3); el cambio necesario seria mover los agregados del cliente a vistas o RPCs de solo lectura.

---

## 15. Tablas v3: transaction_scores y customer_scores (2026-07-12)

**`transaction_scores`** (1,600; PK y FK `transaction_id`, FK `account_id`; escribe: seed).
Features contextuales del Nivel 1 (log_amount, rel_amount, band_9k, hr_country, offshore,
cash, nonactive_status, days_since_prev_txn, same_day_txns, counterparty_novelty,
intl_mismatch) + `score`, `anomaly`, `amount`, `flagged_by_rules`. DDL completo en
`supabase/generate_seed.py`.

**`customer_scores`** (59 activos; PK y FK `customer_id`; escribe: seed). Features del
Nivel 3 (n_accounts, n_anomalous_accounts, max_account_score, total_value,
pct_txn_anomalous, max_txn_score, structuring_days, hr_value_share,
nonactive_value_share, risk_ordinal, pep, never_screened, post_match_value) +
`score`, `anomaly`, `full_name`, `nationality`. Los 24 clientes KYC-only (sin cuentas)
NO tienen fila: se excluyen del scoring por diseno.

`account_scores` gana 4 columnas v3: pct_txn_anomalous, max_txn_score, max_day_share,
recent_intensity. RLS SELECT-only para anon en las tres, como el resto del seed.
