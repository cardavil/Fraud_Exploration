# UI — Fraud & Compliance Exploration Board

Sistema visual del board: design tokens, semantica de color de riesgo, componentes por tab,
especificacion de charts, estados y accesibilidad. Todo lo aqui documentado existe en
`app/styles.css`, `app/js/charts.js` y los modulos `app/js/tab-*.js`.
Docs hermanos: [APPFLOW.md](APPFLOW.md) (flujos) · [MOCKUPS.md](MOCKUPS.md) (wireframes) ·
[TRD.md](TRD.md) (diseno tecnico) · [PRD.md](PRD.md) (producto).
Fecha: 2026-07-12.

---

## 1. Design tokens

Tema unico claro, sobrio-fintech. Todos los custom properties de `:root` en `app/styles.css`,
copiados exactos:

### 1.1 Marca

| Token | Valor | Uso |
|---|---|---|
| `--brand-navy` | `#0A1633` | Fondo del topbar, fondo del tooltip de charts, nodo `pipe-io` |
| `--brand-blue` | `#2E5BFF` | Accion primaria: botones, tab activo (borde), borde superior de KPI tile neutral, fill de score track, circulo del stepper EDA, color por defecto de las series |
| `--brand-blue-hover` | `#204AE0` | Hover de `.btn-primary` y `.pill-link` |
| `--brand-blue-ink` | `#1E43C9` | Azul "tinta" para TEXTO sobre superficies claras: links, tab activo, `how-btn`, stage pulsing (contraste AA que el azul de marca no da en texto pequeño) |
| `--brand-blue-disabled` | `#9DB1F2` | `.btn-primary:disabled` |

### 1.2 Superficies y tintas

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#F5F7FB` | Fondo de pagina (body) |
| `--surface` | `#FFFFFF` | Cards, tabbar, modal, selects e inputs |
| `--on-brand` | `#FFFFFF` | Texto sobre azul de marca (botones, nodo heavy, stepper) |
| `--on-navy-muted` | `#B9C4DE` | Subtitulo del topbar (texto secundario sobre navy) |
| `--on-navy-soft` | `#D7DEF0` | Texto de `.pill-neutral` sobre navy |
| `--navy-pill-bg` | `rgba(255, 255, 255, .12)` | Fondo de pill neutral dentro del topbar |
| `--text` | `#0A1633` | Tinta principal de texto (= navy de marca) |
| `--muted` | `#5A6B8C` | Tinta secundaria: labels, notas, ejes de charts, `th` |
| `--line` | `#E3E8F2` | Bordes: filas de tabla, tabbar, inputs, gridlines de charts, `defense-card` |
| `--tint` | `#EEF1F8` | Relleno recesivo: stat-tiles, agent cards, chips, caja de formula, track de score, stage inactivo |
| `--tint-hover` | `#F0F3FA` | Hover de `.btn-ghost` |
| `--row-hover` | `#F4F7FE` | Hover de `tbody tr` |

### 1.3 Semantica de riesgo (rojo / ambar / verde)

Cada color de riesgo viene en tripleta: color de serie (charts/bordes), `-ink` (texto sobre
fondo claro) y `-bg` (fondo de badge/banner).

| Token | Valor | Uso |
|---|---|---|
| `--risk-red` | `#D64545` | Series "critico" en charts; borde superior de `.kpi-risk` |
| `--risk-red-ink` | `#A83232` | Texto de badge sanctioned/flagged/failed, banner de error, "Never alerted" |
| `--risk-red-bg` | `#FBE7E7` | Fondo de badge sanctioned/flagged, `.banner-error`, stage `failed` |
| `--risk-amber` | `#E8A33D` | Serie "warning" en charts (banda de structuring, sweep 300 trees); borde de `.kpi-warn` |
| `--risk-amber-ink` | `#8F6210` | Texto de badge offshore/structuring/fallback, status Closed/Frozen/Dormant, nodo guard |
| `--risk-amber-bg` | `#FBF1DD` | Fondo de badge offshore/structuring, nodo `pipe-guard` |
| `--risk-green` | `#2FA36B` | Serie verde (sweep 500 trees en ML) |
| `--risk-green-ink` | `#1E7A4D` | Texto de badge clear, status Active, stage `done` |
| `--risk-green-bg` | `#E2F3EA` | Fondo de badge clear y stage `done` |

### 1.4 Forma

| Token | Valor | Uso |
|---|---|---|
| `--radius` | `10px` | Radio de cards, KPI tiles, modal, eda-step |
| `--shadow` | `0 1px 2px rgba(10, 22, 51, .06), 0 4px 16px rgba(10, 22, 51, .05)` | Elevacion base de cards, tiles, modal y tooltip |

Nota: `app/js/charts.js` replica tres tokens como constantes SVG (`INK #0A1633`,
`MUTED #5A6B8C`, `LINE #E3E8F2`) porque los atributos SVG no leen custom properties.
Si un token cambia en CSS hay que actualizar el espejo en charts.js.

## 2. Reglas de color

1. **Semantica fija en todo el board**: rojo = sanctioned / critico / fallo;
   ambar = offshore / warning / structuring / fallback; verde = clear / done / activo.
   Es la misma convencion en badges, bordes de KPI, series de charts y stages del copilot.
2. **Un color de estado NUNCA aparece sin etiqueta de texto.** El componente canonico es el
   badge: dot de 7px (`.badge::before`, `background: currentColor`) + texto
   ("Sanctioned", "Never alerted", "fallback", "failed"...). El dot es refuerzo, no el mensaje.
3. **El texto siempre viste tokens de tinta, nunca el color de la serie.** Sobre fondo claro
   se usa la variante `-ink` (mas oscura, contraste AA); el color de serie (`--risk-red`,
   `--brand-blue`...) queda reservado a marcas de chart y bordes. Los labels de ejes van en
   `MUTED` y los direct labels en `INK` (charts.js).
4. **Paleta validada para CVD**: azul / rojo / ambar / verde con luminancias separadas, y
   ademas ninguna decision depende solo del hue — cada estado lleva texto (regla 2), los
   charts llevan tooltip por marca y boton "how to read" (UI §4.4), y las marcas enfatizadas
   llevan direct label.
5. Distincion azul: `--brand-blue` para superficies/marcas, `--brand-blue-ink` para texto
   azul (links, tab activo). Nunca `--brand-blue` como color de texto pequeño.

## 3. Componentes por tab

| Componente | Tab | Clave CSS | Fuente JS |
|---|---|---|---|
| Tab bar sticky | todas | `.tabbar`, `.tab-btn` | `core.js` (router) |
| KPI tile + popup | Overview | `.kpi-tile`, `.modal` | `tab-overview.js` |
| Explorador de tablas | Data | `.table-pick`, `.filter-row` | `tab-data.js` |
| Stepper EDA | EDA | `.eda-step`, `.eda-step-n` | `tab-eda.js` |
| Finding cards | Findings | `.findings-grid`, `.finding-card` | `tab-findings.js` |
| Anomaly items | ML Model | `.anom-item`, `.anom-score-track` | `tab-ml.js` |
| Pipeline nodes | AI Engine | `.pipeline`, `.pipe-node` | `tab-engine.js` |
| Agent cards | AI Engine | `.agent-cards`, `.agent-card` | `tab-engine.js` |
| Cop-progress stages | AI Engine | `.cop-progress`, `.cop-stage` | `tab-engine.js` |

### 3.1 Tab bar sticky con hash routing

`position: sticky; top: 0; z-index: 30` sobre `--surface` con borde inferior `--line`.
Seis botones (`Overview | Data | EDA | Findings | ML Model | AI Engine`); el activo lleva
`border-bottom: 3px solid var(--brand-blue)` y texto `--brand-blue-ink`. El router de
`core.js` sincroniza con el hash (`#overview` ... `#engine`), renderiza cada tab de forma
lazy en su primera activacion y hace `history.replaceState` para no ensuciar el historial.
Flujo completo en APPFLOW §1.

### 3.2 KPI tile como button + popup con formula viva

Cada tile es un `<button class="kpi-tile">` real (focusable, activable con teclado):
borde superior de 3px con semantica (`.kpi-risk` rojo, `.kpi-warn` ambar, neutral azul),
label uppercase en `--muted`, valor 1.9rem con `font-variant-numeric: tabular-nums`, nota.
Click abre el modal con cuatro bloques: definicion (`what`), **formula viva** en
`.modal-formula` (fondo `--tint`, calculada con los mismos numeros de `computeKpis()` que
pinta el tile — una sola fuente), "Why it matters" y link `.modal-link` que cierra el modal
y navega al tab de detalle. Wireframe en MOCKUPS §3.

### 3.3 Explorador con filtros derivados del tipo de columna

Selector de tabla (8 tablas servidas con su conteo de filas) + fila de filtros generada
por `columnKind()` inspeccionando los datos reales — nada esta hardcodeado por tabla:

| Tipo detectado | Regla de deteccion | Control generado |
|---|---|---|
| Categorica | ≤ 25 valores distintos | `<select>` con "All" + valores ordenados |
| Numerica | todos los valores son `number` | par de inputs `min` / `max` (`.range-pair`) |
| Fecha | todos matchean `^\d{4}-\d{2}-\d{2}$` | par de `<input type="date">` from / to |
| Texto | resto | `<input type="search">` "contains…" |

Filtrado 100% en cliente, paginacion de 25 filas, resumen dinamico
("N of M rows · $X total amount") y estado vacio propio (§5).

### 3.4 Stepper EDA con numeros en circulo

Seis pasos `.eda-step` (card con `border-left: 3px solid var(--brand-blue)`); cabecera con
`.eda-step-n`: circulo de 28px, fondo `--brand-blue`, numero en `--on-brand`, bold 700.
Los cuerpos mezclan tabla del cleaning log en vivo, `check-row` de badges de verificacion
de conteos, `stat-row` de 4 stat-tiles y charts (paso 5).

### 3.5 Finding cards en grid 2 col

`.findings-grid`: `repeat(2, minmax(0, 1fr))` con gap 20px; colapsa a 1 columna ≤ 1180px.
Cada `.finding-card`: titulo h3 + parrafo lead con los numeros clave en `<strong>` +
`.chart-slot` con su chart de evidencia (§4).

### 3.6 Anomaly items con score track

Lista de cuentas anomalas del Isolation Forest: fila superior con id (bold 700), meta
en `--muted`, y a la derecha badge `badge-plain` "Has alert history" o texto
`.anom-alert-gap` "Never alerted" en `--risk-red-ink`. Debajo, `.anom-score-track`: barra
de 6px sobre `--tint`, fill `--brand-blue` con ancho proporcional a `score / maxScore`,
`role="img"` + `aria-label` con el score (§6). Cierra la linea "Why:" con `why-chips`
(desviaciones por feature vs mediana poblacional, calculadas en `tab-ml.js`).

### 3.7 Pipeline nodes fast / heavy / guard / io

Fila flex de nodos con flechas `→` en `--muted`:

| Clase | Relleno | Rol |
|---|---|---|
| `.pipe-io` | navy, texto blanco | entrada `POST {account_id}` y salida `JSON verdict + audit[]` |
| `.pipe-guard` | `--risk-amber-bg` / `-ink` | rate limiter (RPC Postgres) y anonymizer + sanitizer |
| `.pipe-agent.fast` | `--tint` / `--text` | los 3 analistas (tier flash-lite) |
| `.pipe-agent.heavy` | `--brand-blue` / `--on-brand` | synthesizer y reviewer (tier flash-latest) |

Espejo exacto del pipeline del Edge Function (APPFLOW §3, TRD §4).

### 3.8 Agent cards

Grid `auto-fit, minmax(230px, 1fr)`; card sobre `--tint` con nombre del agente + pill de
tier ("fast tier" / "heavy tier"), rol en prosa, y linea muted con `tools:` y `output:`
en `<code>`.

### 3.9 Cop-progress stages

Pills `.cop-stage` (fondo `--tint`, texto `--muted`) unidas por flechas, una por agente.
Estados: `.pulsing` (animacion `pulse` de opacidad 1.2s, texto `--brand-blue-ink`) mientras
corre; al volver la respuesta cada stage pasa a `.done` (verde-bg/ink, latencia en segundos
anexada) o `.failed` (rojo-bg/ink) segun el `audit[]` por agente.

## 4. Charts (`app/js/charts.js`)

SVG hecho a mano, sin librerias (CSP-safe). Tres formas, un solo sistema de interaccion.

### 4.1 Reglas comunes

- **Marcas finas**: rects con `rx=3`; barras verticales max 46px de ancho
  (`min(46, slot*0.66)`); barras horizontales de 18px de alto; lineas `stroke-width 2`.
- **Gridlines recesivas**: solo horizontales, base + 3 divisiones, `stroke #E3E8F2` de 1px,
  con label de valor en `MUTED` (11px) en el eje izquierdo. Nada de ejes dibujados ni ticks.
- **Tooltip hover por marca**: cada marca escucha `mousemove`/`mouseleave` y usa el unico
  `#chart-tooltip` global (`position: fixed`, fondo navy, texto blanco, `role="tooltip"`,
  `pointer-events: none`); se posiciona a +14px del cursor y se voltea si toca los bordes
  del viewport.
- **Boton "how to read" en cada figcaption**: `figure()` monta
  `titulo + boton ⓘ how to read` sobre cada chart; el click muestra la explicacion en el
  mismo tooltip y se cierra con el siguiente click en el documento.
- **Legend solo con ≥ 2 series** (solo aplica a `lineChart`): chips de 10px `rx 3` + nombre.
- **Direct labels selectivos**: solo las marcas con `emphasize: true` llevan el valor
  directo (encima de la barra vertical, bold `INK` 11.5px; al final de la barra horizontal,
  bold `INK` vs normal `MUTED` para el resto).

### 4.2 barChart — barras verticales

| Spec | Valor |
|---|---|
| ViewBox | 640 × 260; margenes t14 r10 b40 l54 |
| Escala Y | 0 → max(valores) × 1.08 |
| Barra | ancho `min(46, slot × 0.66)`, `rx 3`, altura minima 1px, fill `d.color \|\| #2E5BFF` |
| Label X | bajo cada barra, `MUTED` 11px |
| Uso | banda de structuring (EDA paso 5, finding structuring) con la banda $9k en `--risk-amber` + emphasize |

### 4.3 hBarChart — barras horizontales

| Spec | Valor |
|---|---|
| Geometria | 640 de ancho, 34px por fila; margenes l150 (labels) r70 (valores) |
| Barra | alto 18, `rx 3`, ancho proporcional al max, minimo 2px |
| Labels | categoria a la izquierda en `INK` 12px; valor a la derecha de la barra |
| Uso | funnel de escalacion, valor post-match por cliente, valor por status de cuenta |

### 4.4 lineChart — multi-serie con UN solo eje

| Spec | Valor |
|---|---|
| ViewBox | 640 × 260; margenes t14 r12 b40 l54 |
| Escala Y | **un solo eje** para todas las series: max global × 1.1 (nunca doble eje) |
| Labels X | muestreados cada `ceil(n/8)` puntos, `MUTED` 10.5px |
| Puntos | dot visible r2.5 del color de la serie + circulo hit invisible r8 para hover comodo |
| Legend | solo si `series.length >= 2` |
| Uso | transacciones vs alertas (azul/rojo), valor mensual, chargebacks, sweep del modelo (3 series azul/ambar/verde) |

## 5. Estados

| Estado | Disparador | Presentacion |
|---|---|---|
| Loading global | `boot()` cargando JSON + 8 tablas | `#global-loading` "Loading the serving layer…" centrado en `--muted`; los tab-panels siguen ocultos |
| Error global con retry | cualquier fallo de `boot()` | `#global-error` `.banner-error` (`role="alert"`, rojo-bg/ink) con el mensaje escapado y link "retry" que recarga la pagina |
| Skeleton | utilidad disponible | `.skeleton::after` shimmer 1.4s (gradiente translucido); definido en styles.css para superficies en carga |
| Tabla vacia | filtros sin resultados | fila unica `.loading-cell` colspan total: "No rows match the current filters." |
| Copilot corriendo | click en Analyze | boton `disabled` (azul `--brand-blue-disabled`), stages en `.pulsing` (§3.9); clase `.spinner` disponible para cargas inline |
| Copilot fallo | respuesta no-ok o excepcion | `#cop-error` `.banner-error` con status y detalle truncado a 200 chars; stages dejan de pulsar |
| Paginacion en extremos | pagina 1 / ultima | `#dx-prev` / `#dx-next` `disabled` (ghost gris) |

## 6. Accesibilidad

- **Focus visible**: `:focus-visible` con `outline: 2px solid var(--brand-blue)` +
  offset en KPI tiles; selects e inputs con outline azul en `:focus`.
- **Modal**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-title"`;
  al abrir el foco salta al boton de cierre (`aria-label="Close"`); cierra con **Esc**
  (listener global) y con **click fuera** (solo si el target es el backdrop).
- **Score tracks**: `role="img"` + `aria-label="Anomaly score N.NN"` — la barra visual
  tiene equivalente textual para lector de pantalla.
- **Labels ARIA**: `nav aria-label="Sections"`, cada `section` de tab con `aria-label`,
  boton how-to-read con `aria-label="How to read this chart"`, select del copilot con
  `aria-label="Account to analyze"`; `#chart-tooltip` con `role="tooltip"`; banners de
  error con `role="alert"`. Utilidad `.visually-hidden` disponible.
- **Semantica nativa**: tiles y tabs son `<button>` reales; tablas con `thead/th`.
- **Uso del ancho completo**: `max-width: 1560px` en topbar, tabbar, main y footer —
  el contenido aprovecha pantallas anchas; los grids colapsan por breakpoints
  (1180px findings/ml → 1 col; 1080px KPIs → 2 col, two-col/charts → 1 col;
  900px stat-row → 2 col; 560px KPIs → 1 col). Tablas anchas scrollean dentro de
  `.table-wrap` (`overflow-x: auto`), nunca la pagina.
- **Numeros comparables**: `tabular-nums` en valores de KPI, stat-tiles, celdas numericas
  y caja de formula.
