# PRD: Semántico v2 — Análisis semántico jerárquico, trazable y multi-idioma

**Producto:** myHotel → Semántico (refactor)
**Autor:** Andrés (Product Owner)
**Versión:** 1.1
**Fecha:** 2026-05-20
**Equipo:** 1 célula (front + back), 6 semanas, asistido por LLM
**Audiencia:** equipo de desarrollo (foco estructural)

> Companions: `docs/semántico/PRD-prototipo-claude-code.md` (prototipo de referencia), `docs/semántico/PRD-prototipo-UI-acordeon.md` (navegación acordeón), `docs/semántico/refactor-semantico-evaluacion-y-benchmark.md` (antecedentes/benchmark).
> Taxonomía curada: `data/semantic-v2/{areas,temas,subtemas-seed}.json` (42 áreas · 201 temas / 178 activos · 236 subtemas neutros).

---

## 1. Problema

El Semántico actual extrae menciones con un LLM, las asocia a una lista de **temas** predefinidos, y cada tema se mapea **determinísticamente a varias áreas**. Fallas estructurales:

1. **Atribución multi-área que ensucia el índice.** Hoy un tema se atribuye a hasta 3 áreas (en la taxonomía actual, **118 de 197 temas, ~60%, mapean a 2-3 áreas**). Cada mención de esos temas se cuenta en todas → doble/triple conteo → el índice semántico del área se distorsiona. Es la queja #1 de los clientes.
2. **Falta de granularidad.** "Limpieza del baño negativo" no dice si es el WC, la ducha o el espejo. La única forma de saberlo hoy es leer comentario por comentario.
3. **Subtemas huérfanos.** La feature "Subtemas" (~900 estructuras sustantivo-adjetivo) vive en un proceso de back paralelo, alimenta un solo widget (visible solo para cadenas) y un reporte mensual. Está desconectada de Semántico.
4. **Sin vista de cadena.** La info se ve hotel por hotel; para cadenas de 5+ (las hay de 150) es inviable.
5. **Brecha con USA.** El refactor es parte del cierre de brechas para entrar a USA (vía Tambourine). Los incumbentes (TrustYou, Shiji ReviewPro, Medallia) ya operan taxonomías jerárquicas aspect-level multi-idioma. Necesitamos paridad funcional para no quedar fuera en RFP. (Apéndice A.)

---

## 2. Objetivo

Reconstruir Semántico sobre una taxonomía de **cuatro capas con trazabilidad punta a punta** —**Área · Tema · Dimensión · Subtema**— donde el **átomo es la mención** (una opinión anclada a una frase). Granularidad accionable, indicadores estables y auditables, soporte trilingüe (ES/EN/PT), subtemas integrados nativamente y expuestos en los cuatro productos, y vista corporativa para cadenas.

Buena noticia de partida: **la taxonomía actual ya cubre ~70% del modelo** (los 197 temas son neutros, trilingües y mapeados a áreas). El trabajo es arreglar/extender, no construir de cero.

---

## 3. Modelo conceptual (núcleo)

### 3.1 El átomo: la mención

Una **mención** es una opinión sobre algo, anclada a una frase (`span`). Una reseña genera N menciones. Cada mención lleva:

```
span          frase textual exacta del huésped (evidencia, en su idioma)
subtema       el elemento concreto, NEUTRO (baño, ducha, bartender)   ← nuevo, granularidad
tema          elemento + dimensión, NEUTRO (limpieza del baño)        ← los 197 tags actuales
dimensión     la cualidad juzgada (limpieza, trato, condición…)       ← columna nueva
área          el responsable (Housekeeping, A&B, Personal…)           ← lookup determinístico
polaridad     positivo | negativo | neutral | sugerencia              ← por mención, contextual
intensidad    leve | moderada | fuerte
confianza     0–1
idioma        es | en | pt
versiones     model_version, prompt_version, map_version
```

### 3.2 Las cuatro capas y cómo se relacionan

- **Subtema ⊂ Tema** (contención): cada subtema cuelga de **un** tema. `marco-de-puerta` → `condición de la habitación`. El subtema hereda el tema (y por tanto su dimensión y su área).
- **Tema → Área** (lookup determinístico): cada tema tiene **una área primaria** que suma al índice (MECE, cuenta una sola vez). Las demás áreas quedan como referencia/filtro, **no** se cuentan.
- **Dimensión** es un **eje transversal ortogonal**, no un nivel del árbol: `limpieza` cruza baño, lobby, piscina y distintas áreas. Es el lente de gestión.
- **Polaridad** es propiedad de la mención, **calculada por contexto**, nunca encodeada en el literal del subtema/tema.

Dos lentes sobre el mismo átomo: **Área** = responsabilidad administrativa (a quién asignar la tarea). **Dimensión** = entendimiento conceptual (qué patrón mejorar). La trazabilidad no es un árbol único: es que **cualquier número agrega menciones que se bajan hasta la frase**, y cada mención carga todas sus etiquetas.

### 3.3 Subtema neutro + polaridad aparte (regla dura)

La **clave canónica del subtema es neutra, sin adjetivo**: `bartender`, no `bartender-grosero`. "grosero", "molestoso", "pesado" son la misma cosa (`bartender` + dimensión `trato` + polaridad negativa); el adjetivo del huésped se guarda como evidencia en el `span`. Esto:

- evita la explosión de la lista (no hay un subtema por adjetivo),
- permite comparar positivo vs negativo del mismo subtema,
- maneja negación/sarcasmo ("no estaba sucio" = positivo).

En UI **sí** se muestra "bartender grosero" (subtema + palabra del huésped + polaridad); lo que se almacena y deduplica es neutro.

### 3.4 "LLM propone, tabla determinística dispone"

- El LLM hace la decisión **contextual y lingüística**: qué subtema/tema es la mención y su polaridad.
- El **área no está en el texto** (es organizacional) → la pone la **tabla versionada**, no el LLM. Determinístico, reproducible, auditable.
- Cuando el área depende de dónde pasó (recepción vs restaurante), eso se resuelve por **granularidad de tema** (`staff-front_desk-attitude` vs `staff-restaurant-...`), no por elección libre de área. Si un tema es sistemáticamente ambiguo → se **parte en dos**.
- **Override** del usuario es la válvula y gana sobre la predicción; los overrides recurrentes son señal para re-mapear la primaria o partir el tema.
- (Futuro v2.x) reasignación *acotada*: el LLM podría mover el área **solo entre las áreas ya declaradas del tema**, congelada por mención. No en v2.

### 3.5 Acotamiento de subtemas (Pareto, con dato real)

La lista de producción tiene **892 subtemas** en formato adjetivo-sustantivo. Al **neutralizar** (quitar el adjetivo → clave = sustantivo, polaridad aparte) colapsa a **236 elementos**, y solo **85 cubren el 90%** del uso. (Sobre la lista con adjetivo el 90% son 259; el ~180 estimado quedaba corto.) Razón del corte: **precisión y mantenibilidad** (cientos de opciones casi-duplicadas confunden al modelo y bajan el F1), no el costo de tokens — con prompt caching el catálogo estático casi no cuesta por llamada. **La neutralización es, de por sí, la mayor palanca de reducción.**

### 3.6 Curaduría de taxonomía (requerimiento)

La taxonomía no es estática: hay que cerrar gaps, podar redundancia y mantener MECE. Para clasificar **cualquier concepto nuevo**, regla en orden:

1. ¿Es un departamento/responsable? → **Área** (raro de agregar).
2. ¿Es un asunto recurrente que el gerente quiere seguir/asignar? → **Tema** (elemento+dimensión).
3. ¿Es la instancia concreta que nombra el huésped? → **Subtema**.
4. ¿Es un eje de calidad transversal? → **Dimensión**.

Regla dura: **un topic nuevo necesita un TEMA (su bucket gestionable); los subtemas son las instancias. Un subtema sin tema padre queda huérfano** (no se cuenta, no se asigna, no hace tendencia). No alcanza con "agregar subtemas".

Aplicado en el seed v2 (`data/semantic-v2/temas.json`, ahora 201 temas):

- **Altas (gaps, relevantes para USA):** `experience-dietary_options` (vegano/sin gluten/alergias), `experience-family_friendly`, `experience-sustainability`, `experience-smoking_policy`. Nueva **dimensión `Adecuación`** (suitability: familia, mascotas, accesibilidad, sostenibilidad).
- **Fix de primaria (MECE):** las áreas de instalación deben ser primarias de su tema o quedan en cero. `pool→Piscina`, `gym→Gimnasio`, `spa/hot_tub→Spa`, `sleep_quality→Calidad del Sueño`, `price-value→Relación Precio/Calidad`.
- **Consolidación `staff`:** 23 temas marcados `consolidar=true` (dimensiones no-core como apariencia/calidad/disponibilidad). El catálogo activo del LLM los excluye; la dimensión cruza roles, no se necesita un tema por rol×dimensión. La familia `staff` (74) era el 38% del total.
- **Pendiente de curación humana:** 20 áreas aún sin tema primario (varias nicho: ski, banquete, retail), 71 temas con `dimension=General`, completar labels ES.

El catálogo es **versionado**; altas/bajas/merges pasan por revisión (no por cambio de prompt). Mantener **una sola área primaria por tema**.

---

## 4. Pipeline (arquitectura)

Separar lo probabilístico de lo determinístico, y lo hot de lo offline. **~60% del pipeline no es LLM.**

```
0. Ingesta (sin LLM)        normaliza, dedup, detecta idioma, adjunta contexto (touchpoint, pregunta)
        ▼
1. Extracción (LLM, 1 prompt, por comentario)   → menciones JSON {span, subtema, tema, dimensión, polaridad, intensidad, confianza, sugerencia, propuesto}
        ▼
2. Roll-up (sin LLM)        subtema→tema→área primaria, tabla versionada; subtema nuevo → cola de descubrimiento
        ▼
3. Descubrimiento (LLM, prompt SEPARADO, offline, periódico)   clusteriza propuestos, deduplica, valida, canoniza, mapea a tema
        ▼
4. Agregación e índices (sin LLM)   índices por área/tema/dimensión/subtema, hotel y cadena, con N mínimo
        ▼
5. Recomendaciones (LLM, prompt SEPARADO, sobre agregados, offline)   [fast-follow]
```

Reglas de escala (2.000 → +1.000 hoteles en 2026):

- **Extracción = un solo prompt por comentario** (extracción conjunta de tuplas; no separar aspecto/sentimiento/tema → triplicaría llamadas y perdería contexto).
- **Unidad = un comentario por llamada** (atribución limpia de spans, retries simples). No apilar comentarios en un prompt.
- **Throughput vía Batch API** (async, ~50% más barato): miles de extracciones como un job.
- **Procesar cada comentario una vez y persistir la mención.** No re-extraer al abrir el dashboard. Re-procesar solo al subir versión de modelo/prompt/catálogo (selectivo/shadow).
- **Prompt caching** del catálogo + instrucciones (estático entre llamadas).
- **Modelo barato/rápido para extracción** (Haiku); modelo mayor (Sonnet) para descubrimiento/validación.
- **Versionar** modelo/prompt/catálogo en cada mención.

---

## 5. Prompts

Tres prompts, distintas cadencias (ver §4): **5.1 extracción** (hot, por comentario, Haiku), **5.3 descubrimiento** (offline, Sonnet), y recomendaciones (fast-follow, fuera de v2 core).

### 5.1 Prompt de extracción v2 (template)

Cambios clave respecto del prompt actual: subtema **neutro** + polaridad **aparte y contextual** (se elimina la tabla binaria adjetivo→polaridad, que pasa a ser solo lista de dimensiones); **una fila por mención**; salida **JSON**; valor **`sugerencia`**; canal **`propuesto`**; **trilingüe** en idioma original; **área fuera del prompt**. El catálogo va en system prompt (cacheable).

```text
[SYSTEM]
Sos un motor de análisis semántico de reseñas de huéspedes de hotel. Extraés MENCIONES:
cada opinión puntual sobre algo, anclada a la frase exacta del huésped.

CÓMO ANALIZAR
- Leé el comentario completo con su contexto (título, pregunta de la encuesta, idioma).
- Procesá en el IDIOMA ORIGINAL. No traduzcas. El `span` va en el idioma del huésped.
- Una reseña puede tener varias menciones. Devolvé UNA por opinión (por span). No deduplifiques por tema.
- Si la pregunta es de mejora ("¿Cómo podemos mejorar?"), tomala como CONTEXTO (tiende a sugerencia/
  negativo), NO como regla: igual decidí la polaridad por el contenido de cada frase.

POR CADA MENCIÓN, DEVOLVÉ
- span: la frase textual exacta (evidencia).
- subtema: el ELEMENTO concreto, en forma NEUTRA y singular, SIN adjetivo
  (ej. "ducha", "bartender", "marco de puerta"). Nunca "ducha-fría".
- tema: el tag del catálogo de TEMAS que mejor calza (elemento+dimensión). Si ninguno calza, null.
- dimension: la cualidad juzgada (de la lista de DIMENSIONES). Para temas conocidos es REFERENCIAL
  (la dimensión canónica la fija la tabla en el roll-up); para propuestos, tu mejor estimación.
- polaridad: positivo | negativo | neutral | sugerencia. Calculala por CONTEXTO, nunca por el adjetivo
  aislado: manejá negación ("no estaba sucio" = positivo), sarcasmo, intensificadores, comparativos, y
  adjetivos que cambian de signo según el elemento (porción chica = negativo; espera chica = positivo;
  cerveza fría = positivo; pieza fría = negativo). "sugerencia" = recomendación constructiva, no queja.
- intensidad: leve | moderada | fuerte.   - confianza: 0–1.   - idioma: es | en | pt.
- propuesto: true si (a) ningún tema del catálogo calza, o (b) la tupla (subtema, dimension) no corresponde
  a ningún tema. En ese caso tema=null. Antes de proponer, REUSÁ un subtema conocido si describe lo mismo.

NO HAGAS
- No inventes temas fuera del catálogo (para eso está `propuesto`).
- No asignes ÁREA (la pone la tabla determinística después).
- No pegues la polaridad al subtema.   - No infieras menciones que no estén en el texto.

CATÁLOGOS (referencia cerrada; van en system prompt, cacheable)
- TEMAS activos: {temas}          # tag · dimension · label es/en/pt   (~178, ya filtrados por área habilitada)
- SUBTEMAS conocidos: {subtemas}  # neutros, ~85 Pareto-90 (reusá si calzan)
- DIMENSIONES: {dimensiones}
- ÁREAS habilitadas: {areas}      # solo contexto; NO las devuelvas

SALIDA: SOLO JSON con el esquema de §5.2. Sin texto adicional.

[USER]
Touchpoint: {touchpoint}   Idioma: {idioma}
Pregunta/título: {pregunta}
Comentario: {texto}
```

### 5.2 Contrato de salida (JSON)

Una llamada por comentario. Ejemplo (reseña de sabores):

```json
{ "menciones": [
  {"span":"sabores muy planos, poco sazón","tema":"food-restaurant-taste","subtema":"comida","dimension":"sabor","polaridad":"negativo","intensidad":"fuerte","confianza":0.95,"idioma":"es","propuesto":false},
  {"span":"deberían ser más autóctonos","tema":"food-restaurant-selection","subtema":"carta","dimension":"variedad","polaridad":"sugerencia","intensidad":"moderada","confianza":0.82,"idioma":"es","propuesto":false},
  {"span":"la carta dice varios fiambres pero llega solo jamón","tema":null,"subtema":"carta-vs-servido","dimension":"exactitud","polaridad":"negativo","intensidad":"moderada","confianza":0.6,"idioma":"es","propuesto":true}
] }
```

> **Dimensión determinística:** cuando `tema` es conocido, la dimensión definitiva sale del **lookup del tema** (roll-up §4 paso 2), no de la que devolvió el LLM. La del LLM solo se usa para los `propuesto:true`.

### 5.3 Prompt de descubrimiento (offline, Sonnet)

Toma el lote de candidatos `propuesto:true` + el universo de subtemas/temas existentes y, por cada candidato: (a) lo compara contra los subtemas neutros existentes y propone **merge** si coincide; (b) si es genuinamente nuevo, propone su **forma canónica neutra** + el **tema padre** + dimensión/área heredadas; (c) marca para **revisión humana**. No corre por comentario. Salida JSON: `{accion: merge|nuevo|descartar, subtema_canonico, tema_padre, similar_a, confianza}`.

---

## 6. Descubrimiento de subtemas y deduplicación

Base dada + creación por recomendación del LLM, con disciplina anti-duplicados:

- **Clave neutra** (sin adjetivo) → colapsa los near-dups de adjetivo de raíz.
- **El LLM propone colgado de un tema existente**, con la lista de subtemas de ese tema a la vista (empuja a reusar).
- **Gate de similitud** contra el **universo neutro completo** (los 236, no solo el catálogo activo, para no re-descubrir algo que ya existe en la cola larga): en producción por embeddings (coseno > umbral); en el prototipo, similitud de strings (Jaccard de tokens + Levenshtein normalizado, ~0.7) → sugiere merge.
- **Tabla de alias** (regadera→ducha, internet→wifi), crece con el tiempo.
- **No entra al índice** hasta acumular N menciones y pasar revisión (humana o pase de consolidación LLM periódico que clusteriza candidatos y propone merges).

---

## 7. Áreas configurables por hotel

- El hotel **define qué áreas tiene**; los temas solo se atribuyen a áreas existentes (no buscar "pista de ski" si no tiene).
- **Áreas universales** (Personal, Recepción, Housekeeping, Habitaciones, A&B, Infraestructura, Experiencia General, Precio/Calidad…) siempre activas; **áreas de instalación/servicio** (Piscina, Spa, Ski, Gimnasio, Eventos…) las prende/apaga el hotel.
- Menciones de un área **no habilitada** no se descartan en silencio: se muestran como **sugerencia de configuración** ("tus huéspedes hablan de piscina, ¿la habilitamos?").
- La taxonomía ya está scopeada por tipo de propiedad (Hotel, Hostel, Restaurant, Retail, Clinic, Airline).

---

## 8. Índice semántico

- **Definición: `positivos / (positivos + negativos)`.** Los **neutrales** y las **sugerencias** quedan FUERA del denominador (se cuentan y muestran aparte, pero no penalizan). Ej.: 90 positivas / 10 negativas → 90% (= 90/(90+10)). Calculable en cualquier nivel (área, tema, dimensión, subtema) y corte (hotel, cadena, touchpoint).
- **MECE**: cada mención cuenta una sola vez por nivel (área primaria, una dimensión, un subtema) → sin doble conteo, y los totales reconcilian (padre = suma de hijos). Esto arregla el problema #1.
- **Regla de N mínimo** (configurable; ~20 en prod, 5 en el prototipo): por debajo del umbral se muestran conteo + ejemplos, no porcentaje.
- Las **sugerencias** no castigan el índice; se cuentan aparte como oportunidades (badge/columna propia).

---

## 9. UI y alcance funcional

Tres secciones. Subtema = héroe legible; dimensión = lente de gestión; área = filtro/responsable; siempre se llega a la frase.

### 9.1 Resumen (hotel)
Widgets de índice + **navegación acordeón** (spec en `docs/semántico/PRD-prototipo-UI-acordeon.md`): toggle **Ver por: Área | Dimensión** que re-rootea el mismo árbol, drill de 4 niveles **Área/Dimensión → Tema → Subtema → comentarios reales** (con `span` resaltado), **números (Positivas/Negativas/Índice) en cada nivel** con la regla de N mínimo, y **sugerencias separadas del índice**. Cada tema bajo una sola área (MECE): total del padre = suma de hijos. El ranking de subtemas (hoy widget huérfano) se integra acá.

### 9.2 Comentarios (hotel)
Lista con **touchpoint** (OnSite / FollowUp / Online / Concierge). Chips de subtema/tema con polaridad; hover muestra el `span`. **Override** de subtema, tema, área o polaridad (corrección inmutable; el override es la verdad de la fila).

### 9.3 Corporativo (cadena)
Visible para cadenas; escala a 150 hoteles. Agregados y comparación hotel×área/dimensión (tabla densa, semaforizada). Tolera áreas heterogéneas ("presente en N de M hoteles"). Drill cadena → hotel → … → comentario.

### 9.4 Subtemas en los 4 productos
Un solo store de menciones con `touchpoint`; la UI filtra por producto (OnSite, FollowUp, Online, Concierge). Sin lógica replicada por canal.

---

## 10. Auditabilidad y override

- Cada mención persiste span, subtema/tema/dimensión/área, polaridad, intensidad, confianza, idioma, versiones, timestamp, override.
- **Historia inmutable**: las correcciones crean fila nueva.
- Override a nivel subtema, tema, área y polaridad; gana sobre la predicción.

---

## 11. Migración y compatibilidad

- **Bridge legacy → v2**: vista determinística que mapea las nuevas capas a los temas/áreas antiguos para preservar trend lines. Back-fill sobre el histórico.
- **Shadow run** v1‖v2 antes del switchover para reconciliar y comunicar diferencias.
- Comunicar como beneficio ("preservamos tu histórico").

---

## 12. Calidad y evals

- **Eval set adversarial trilingüe** (ES/EN/PT, ~200 inicial → 500+): negación, intensificadores, sarcasmo, comparativos, multi-aspecto, implícitos, context-dependent.
- Métricas: F1 de subtema/tema, accuracy de polaridad, correctitud del roll-up.
- **Gates de CI**: un cambio de prompt/modelo no se promueve si baja métricas bajo umbral. Protege la estabilidad del indicador.

---

## 13. Plan de 6 semanas (dos tracks)

| Sem | Back | Front |
|---|---|---|
| 1 | Modelo de datos (mención como átomo, 4 capas, versiones, override). Importar taxonomía (areas/temas) + columna dimensión + área primaria. | UI de drill-down jerárquico; specs Resumen v2. |
| 2 | Subtemas neutralizados (236) + Pareto-90 (85 al prompt) + tabla subtema→tema→área. Prompt de extracción v2 trilingüe (§5.1) + contrato JSON. | Resumen v2 (acordeón Área/Dimensión switcheable) sobre mock. |
| 3 | Pipeline extracción (Batch API + caching) + roll-up + cola de descubrimiento. | Comentarios v2: chips, span en hover, override. |
| 4 | Índices MECE + N mínimo. Conexión de los 4 touchpoints (incl. Concierge). | Override loop end-to-end; subtemas por producto. |
| 5 | Agregados de cadena + escalado 150 hoteles. Bridge legacy + back-fill. | Vista Corporativa. |
| 6 | Eval set trilingüe + gates de CI. Shadow run + reconciliación. | Pulido UI, estados low-N/vacíos, QA trilingüe. |

Prioridad si algo se cae: **núcleo (4 capas + área primaria + override) > subtemas cross-producto > vista corporativa completa > migración fina.**

---

## 14. Riesgos de alcance

- **Vista corporativa a 150 hoteles** (agregación + performance): arrancar con agregados precalculados read-only.
- **Calidad PT-BR**: priorizar en el eval set desde semana 2.
- **Migración/back-fill** sobre histórico grande: bridge + shadow pueden cerrarse post-lanzamiento del core sin bloquear release.

---

## 15. Fuera de alcance (v2)

- Generación automática de respuestas, summaries, agentes (terreno saturado; no diferenciamos ahí).
- Reasignación de área por LLM libre (riesgo de inestabilidad). La acotada queda como v2.x.
- Integraciones CRM/CDP/ads de Tambourine (esperar señal del rol del módulo).
- SKU, pricing y materiales de venta.

---

## 16. Métricas de éxito

- Reducción de disputas de atribución área/tema.
- % de menciones negativas resueltas a nivel subtema (granularidad accionable).
- Estabilidad del indicador entre releases (gates verdes).
- Calidad trilingüe equivalente ES/EN/PT.
- Adopción de la vista corporativa por cadenas.

---

## Apéndice A — Benchmark USA (resumen)

Detalle en `docs/semántico/refactor-semantico-evaluacion-y-benchmark.md`.

- **TrustYou (SentimentAI):** jerárquica MECE, 700+ categorías, 23 idiomas, multi-opinión por frase. Análogo conceptual directo.
- **Shiji ReviewPro:** categorías + sentimiento; menciones diagnósticas, separadas del Global Review Index.
- **Medallia:** taxonomía customizable (15k+ topics), 17+ idiomas, override maduro, mapeo a jerarquía organizacional.
- **Lectura:** el modelo jerárquico no es novedoso; competimos en **ejecución** (granularidad de subtema, auditabilidad/override, calidad trilingüe). Objetivo de v2 = **paridad funcional** para no quedar fuera en RFP del bundle Tambourine.
