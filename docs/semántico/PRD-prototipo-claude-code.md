# PRD para Claude Code — Prototipo Semántico v2 en myHotel-Labs

**Objetivo:** construir en `myhotel-labs` un prototipo ejecutable del modelo Semántico v2, que corra sobre **reseñas reales** y sirva de **referencia ya programada** para los devs antes de intervenir Fidelity Suite (producción).

**No es producción.** Es un banco de pruebas: validar el modelo de datos, el prompt de extracción, el roll-up determinístico y la UI de drill-down/override. Sin DB, sin vista de cadena, sin migración.

> PRD de negocio: `docs/PRD-Semantico-v2.md`. Léelo para el porqué; este doc es el qué construir.

---

## 1. Alcance del prototipo

Una herramienta interna nueva dentro de Labs donde el usuario:

1. Pega una reseña real (o elige de un set de muestra) y elige touchpoint + idioma.
2. Corre la **extracción LLM** → obtiene menciones como JSON (contrato §4).
3. Ve el **roll-up determinístico** aplicado (subtema → tema → dimensión → área primaria).
4. Ve las menciones con **todas sus capas** y el `span` resaltado; puede **editar/override** una mención.
5. Ve los **subtemas propuestos** (`propuesto:true`) que no estaban en la base → demo de la cola de descubrimiento.
6. Ve un **agregado** de un lote de reseñas: índice semántico por área/dimensión con regla de N mínimo, y ranking de subtemas.

Demostrar explícitamente los puntos que cerramos: subtema neutro + polaridad contextual; área determinística con primaria (sin doble conteo); dimensión como lente transversal; trilingüe.

---

## 2. Ubicación y convenciones

Seguir el stack y las convenciones del repo (Next.js 16 App Router, React 19, TS, Tailwind v4, Anthropic SDK, estética editorial Bloomberg). Reusar la integración Anthropic existente.

Módulo aislado y autocontenido:

```
src/app/semantic-v2/page.tsx               UI del prototipo
src/app/api/semantic-v2/extract/route.ts   extracción LLM (1 prompt, por comentario) → JSON
src/lib/semantic-v2/
  taxonomy.ts     carga y consulta areas.json / temas.json / subtemas-seed.json
  prompt.ts       builder del prompt de extracción v2 (catálogo compacto, trilingüe)
  rollup.ts       roll-up determinístico subtema→tema→dimensión→área primaria + alias
  discovery.ts    detección de propuestos + gate de similitud (embeddings o similitud simple)
  indices.ts      agregación: índice semántico por capa + regla N mínimo
  types.ts        tipos de Mención y Taxonomía
data/semantic-v2/  areas.json · temas.json · subtemas-seed.json   (YA GENERADOS)
data/semantic-v2/sample_reviews.json   set de reseñas reales de muestra (crear, ES/EN/PT)
```

Reglas del repo: API en `route.ts` bajo `src/app/api/`; no usar localStorage para estado (usar React state); no pre-traducir reseñas (el LLM procesa en idioma original).

---

## 3. Datos de taxonomía (ya generados, ajustar lo pendiente)

En `data/semantic-v2/` hay tres archivos derivados del Excel "Taxonomía Semántico 3.0":

- **`areas.json`** — 42 áreas de Hotel. Campo `tipo`: `universal` (siempre activa) | `instalacion` (toggle). La clasificación es heurística inicial → **revisar/curar**.
- **`temas.json`** — **201 temas** (197 base + 4 altas de gaps). Cada uno con: `tag`, `dimension` (+ `dimension_slug`), `area_primary` (la única que suma al índice, MECE), `areas_secondary` (filtro/referencia, NO cuenta), `labels`/`descriptions`/`examples` en ES/EN/PT. Bloque `curaduria_v2` al inicio resume los cambios.
  - **Altas** (`nuevo:true`): `experience-dietary_options`, `experience-family_friendly`, `experience-sustainability`, `experience-smoking_policy`. Nueva dimensión `Adecuación`.
  - **Fix de primaria** para poblar áreas de instalación: pool→Piscina, gym→Gimnasio, spa/hot_tub→Spa, sleep_quality→Calidad del Sueño, price-value→Relación Precio/Calidad.
  - **Consolidación staff:** 23 temas con `consolidar:true` → **el catálogo activo que se manda al LLM debe EXCLUIR `consolidar:true`** (y debe incluir `nuevo:true`).
  - Pendiente de curación humana: 20 áreas aún sin tema primario (nicho), 71 temas con `dimension:"General"`, y labels ES crudos (ej. `staff-bellstaff`). El prototipo no depende de esto.
- **`subtemas-seed.json`** — **236 subtemas neutros** derivados de la lista real de producción (`subtopics_match_count.csv`, 892 adjetivo-sustantivo). Neutralizados: clave = sustantivo (sin adjetivo); del adjetivo se derivan `dimensiones_observadas` y `polaridades_observadas` (referencia, no autoritativa). `in_pareto_90:true` marca los **85 que cubren el 90%** del uso (set de trabajo). `area_sugerida` = best-effort por elemento (genéricos como stay/experience → "Experiencia General"); `needs_curation:true` = sin área → encolar a descubrimiento. El tema exacto se resuelve por (subtema + dimensión de la mención) en runtime; `temas_candidatos` es solo pista por coincidencia de nodo. El CSV fuente queda en la misma carpeta.

`taxonomy.ts` carga estos tres archivos y expone: lookup tema→área primaria, tema→dimensión, subtema→tema, lista de dimensiones, y filtro por áreas habilitadas del hotel.

---

## 4. Contrato de extracción (salida del LLM)

Una llamada por comentario. Una fila por mención (por `span`), no deduplicar por tema. Salida JSON estricta:

```json
{ "menciones": [
  {
    "span": "string — frase textual del huésped, en su idioma",
    "subtema": "string neutro, sin adjetivo (baño, ducha, bartender)",
    "tema": "tag de la lista cerrada | null si es propuesto",
    "dimension": "string (limpieza, trato, sabor, exactitud…)",
    "polaridad": "positivo | negativo | neutral | sugerencia",
    "intensidad": "leve | moderada | fuerte",
    "confianza": 0.0,
    "idioma": "es | en | pt",
    "propuesto": false
  }
] }
```

Reglas del prompt (ver §5 del PRD de negocio para el detalle):
- Subtema **neutro**; polaridad **contextual** (negación, sarcasmo, comparativos, adjetivos que invierten signo).
- Capturar (+) y (–); `sugerencia` para recomendaciones constructivas.
- La pregunta de la encuesta ("¿Cómo podemos mejorar?") es contexto/prior, **no** fuerza negativo.
- Subtema fuera de la base → `tema:null`, `propuesto:true`, colgado mentalmente de un tema existente; instruir a **reusar antes de proponer**.
- **No** pedir área al LLM (la pone el roll-up determinístico).
- Procesar en idioma original; `tema`/`subtema` canónicos.
- Catálogo (temas + dimensiones + subtemas base) en el system prompt (compacto: slug + label, sin descripciones largas salvo ambiguos) → apto para prompt caching.

Modelo: Haiku para extracción. `rollup.ts` y `indices.ts` son **código puro**, sin LLM.

---

## 5. Flujo en la UI

1. **Input**: textarea para pegar reseña + selector touchpoint (OnSite/FollowUp/Online/Concierge) + idioma + botón "Analizar". Opción "cargar set de muestra".
2. **Resultado por mención** (tarjetas, estética densa): `span` resaltado dentro del texto original, chip de subtema con polaridad e intensidad, y debajo en gris: tema · dimensión · **área primaria** (y secundarias tachadas/atenuadas para mostrar que NO cuentan). Badge si `propuesto:true`.
3. **Override**: por mención, editar subtema/tema/dimensión/área/polaridad (estado local; mostrar que el override "gana").
4. **Panel de descubrimiento**: lista de subtemas propuestos en la sesión, con el tema sugerido y un check de similitud contra la base (si se parece a uno existente, sugerir merge).
5. **Agregado (lote)**: al analizar varias reseñas, mostrar índice semántico por **Área** y por **Dimensión** (switcheable), con la **regla de N mínimo** (bajo el umbral: conteo + ejemplos, no %), y un ranking de subtemas por frecuencia y signo.

La UI debe dejar evidente la diferencia con hoy: una reseña entra y sale partida en menciones concretas, cada una con su capa y trazable a la frase, sin doble conteo de áreas.

---

## 6. Criterios de aceptación

- Analiza reseñas reales en ES, EN y PT y devuelve menciones válidas contra el contrato JSON.
- El área se asigna **solo** por roll-up determinístico desde el tema (no por el LLM); las secundarias no suman al índice.
- Subtemas neutros (no `baño-sucio`); la polaridad es un campo aparte y maneja al menos un caso de negación correctamente.
- Al menos un caso muestra un subtema `propuesto` ruteado a la cola de descubrimiento.
- El agregado de un lote respeta la regla de N mínimo y no doble-cuenta áreas.
- Override editable por mención, reflejado en el agregado.
- Código aislado en `semantic-v2/` (no toca los módulos existentes de Semántico del lab).

---

## 7. Fuera de alcance del prototipo

Persistencia en DB, autenticación, vista de cadena multi-hotel, migración/bridge legacy, generación de recomendaciones, Batch API (en el prototipo basta llamada síncrona por reseña). Todo eso es del PRD de producción.
