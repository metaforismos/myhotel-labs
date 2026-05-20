# Refactor de Semántico para entrada a USA — Evaluación crítica y benchmark competitivo

> **Nota de contexto actualizada:** Este informe se construyó originalmente bajo dos supuestos que después clarificamos en la conversación: (a) que las comisiones eran una *feature* de Semántico, y (b) que myHotel competiría standalone en USA. La realidad es distinta: las comisiones son un *uso* que algunos clientes hacen por su cuenta (no hay feature dedicada), y la entrada a USA es vía **Tambourine** post-adquisición. Esta versión en español incorpora esas correcciones; las secciones que se relajan o caen están marcadas explícitamente.

**Nota de autor (cero complacencia):** Donde la evidencia lo sostiene, este informe es directo. El refactor propuesto tiene mérito técnico real, pero el análisis competitivo muestra que el modelo "bottom-up + dimensión + LLM area-attribution" como *concepto* no es novedoso en el mercado US — los incumbentes (TrustYou, Shiji ReviewPro, Medallia) ya operan taxonomías jerárquicas, aspect-level y MECE. El diferenciador, si existe, está en la *ejecución* (granularidad, auditabilidad, bilingüe), no en el diagrama de ontología.

---

## TL;DR

- **Conceptualmente**, el refactor está alineado con el paradigma estándar ABSA (aspect terms + opinion terms + aspect categories + polarity). Buena dirección. Pero la nomenclatura inventada ("Subtema", "Dimensión", "Área") reinventa vocabulario que el campo ya tiene resuelto y mezcla tres capas distintas: léxica, cualitativa y organizacional.
- **El riesgo técnico principal** es usar LLM no-determinístico para mapear Subtema → Área. Aunque las comisiones no sean feature, los hoteles usan los indicadores para tomar decisiones; mover indicadores hacia atrás con cambios de prompt o modelo genera fricción de soporte y desconfianza. La solución es **"LLM propone, tabla determinística dispone"**.
- **"El adjetivo encodea el sentimiento"** es empíricamente falso en hospitalidad. Adjetivos context-dependent ("small portion" / "small wait", "cold beer" / "cold room", "quiet room" / "quiet bar"), negación, intensificadores, sarcasmo y aspectos implícitos rompen el supuesto. La polaridad debe computarse sobre el triple (aspect, opinion, contexto), no sobre el adjetivo aislado.
- **Competitivamente**, el mercado US ya está poblado con taxonomías multi-nivel. TrustYou SentimentAI tiene 700+ categorías en 23 idiomas; Shiji ReviewPro v4 ofrece capacidad similar; Medallia Text Analytics arranca con 15,000+ topics y permite edición de la taxonomía por el cliente, mapeada a la jerarquía organizacional. No hay un "gap de ontología" obvio que explotar.
- **Dado el contexto Tambourine**, el refactor pasa de ser jugada estratégica standalone a ser *gap-closing* dentro del bundle Tambourine. El bar competitivo es "no quedar eliminado en RFP por capability ausente", no "ganarle a TrustYou en hondura". Eso recorta significativamente el alcance y prioriza paridad funcional sobre diferenciación.
- **Recomendación**: ejecutar el refactor en términos ABSA estándar, con arquitectura LLM-propone/tabla-dispone, manteniendo override y audit como capacidades de producto (no como promesa contractual). El alcance se ajusta según el rol que Tambourine defina para Semántico en su stack (ver Sección B.7).

---

## TASK A — Evaluación crítica del diseño conceptual

### A.1 Diseño de taxonomía: bottom-up vs top-down

**Lo que dice la literatura.** El campo académico relevante — Aspect-Based Sentiment Analysis (ABSA) — se construye sobre una combinación *híbrida*: extracción bottom-up de aspectos + categorización top-down dentro de un catálogo curado. El pipeline canónico (Pontiki et al., SemEval-2014/2016) descompone la tarea en cuatro subtareas:

1. **Aspect Term Extraction (ATE)** — el sustantivo del que se opina ("baño", "ducha").
2. **Aspect Category Detection (ACD)** — mapeo a categoría predefinida ("baño" → Limpieza).
3. **Opinion Term Extraction (OTE)** — la palabra evaluativa ("sucio", "amable").
4. **Polarity Classification** — el signo del sentimiento en contexto.

Formulaciones modernas (ASTE, ASQP) extraen la *tupla* (aspect_term, aspect_category, opinion_term, polarity) en conjunto. Tu modelo va exactamente en esa dirección. Bien.

**Fortalezas del bottom-up propuesto.**
- Acerca a Semántico al estado del arte académico e industrial.
- Resuelve el caso de uso documentado: hoy "baño sucio" cae bajo Housekeeping sin distinción entre ducha y WC. La literatura es clara: granularidad de aspecto es la palanca que convierte sentimiento en acción operacional.
- Un step de extracción bottom-up es *dataset-agnostic* (el LLM puede descubrir subtopics emergentes), mientras que top-down puro solo ve lo que la taxonomía ya conoce. Útil en US donde el vocabulario del huésped difiere ("valet", "pool deck", "ice machine", "linens").

**Debilidades y riesgos.**
- **Colapso de tres capas**: "Subtema → Dimensión → Área" mezcla una capa *léxica* (sustantivo+adjetivo), una *cualitativa* (tamaño, tiempo, limpieza) y una *organizacional* (Housekeeping, F&B). No son colineales. La literatura las trata como concerns separados.
- **Bottom-up puro es inestable**: sin anclaje top-down, obtienes explosión long-tail (cada par adjetivo × sustantivo es un subtopic) y categorías inestables trimestre a trimestre. Las guías prácticas recomiendan un catálogo bounded (8-15 aspectos típicamente, 15-25 acepable para hotelería).
- **Deuda de ontología**: TrustYou explícitamente promociona su jerarquía como MECE (mutually exclusive and collectively exhaustive). Si tu taxonomía bottom-up no es MECE, la misma queja se clasifica bajo múltiples subtopics, produciendo double counting en el índice semántico.

**Recomendación**: mantén la *taxonomía* top-down (catálogo curado de ~15-25 aspect_categories anchadas en hotelería), pero haz la *extracción* bottom-up (LLM descubre pares aspect+opinion y propone categoría). Así operan TrustYou y Medallia.

### A.2 La estructura sustantivo+adjetivo del "Subtema"

**Alineamiento con ABSA.** El par (sustantivo, adjetivo) mapea casi exactamente al par (aspect_term, opinion_term) que ABSA trata como primitivos. Bien fundamentado.

**Tres precauciones:**

1. **Aspect ≠ sustantivo, opinion ≠ adjetivo.** En reviews reales los aspectos suelen ser multi-palabra ("variedad del desayuno", "presión de la ducha", "personal de recepción"), y las opiniones suelen ser multi-palabra o verbales ("nunca funcionó", "tardaron una eternidad", "olía mal"). Restringir Subtemas a un patrón sintáctico estricto N+Adj falla en:
   - Opiniones verbales: *"el ascensor no funcionaba"* (sin adjetivo).
   - Aspectos implícitos: *"esperé 45 minutos"* (el aspecto "tiempo de check-in" se infiere).
   - Sustantivos compuestos: *"la presión de la ducha"*.
   - Comparativos: *"la cama más incómoda que he tenido"*.

2. **El "mínimo común denominador semántico" es frágil**. Los huéspedes no escriben en gramática canónica. El mínimo común *de significado* es la tupla (aspect, polarity), no la forma superficial (N, Adj). *"Ducha helada"* y *"sin agua caliente en la regadera"* son el mismo Subtema en significado y muy distintos en superficie. Si la canonicalización falla, el long-tail explota.

3. **Drift de granularidad**. Subtemas como *"wc-sucio"*, *"wc-roto"*, *"wc-tapado"*, *"wc-pequeño"* acumulan pocas menciones al mes por hotel. Con N pequeño, el índice semántico por Subtema es ruido. La literatura ABSA marca esto como el problema de sparsity; la respuesta industrial típica es mantener la métrica al nivel de *categoría* y usar el subtopic como evidencia/drill-down (eso hacen TrustYou y ReviewPro).

### A.3 La capa "Dimensión"

**La innovación interesante.** Colapsar adjetivos en dimensiones cualitativas (limpieza, tamaño, tiempo, temperatura, porción) es el elemento más original. Es más cercano a *opinion-term clustering* que a ABSA propiamente:
- En ABSA, agrupar "sucio/limpio/impoluto/asqueroso" bajo un eje "cleanliness" es un pre-procesamiento estándar pero raramente expuesto como capa de primer nivel al usuario.
- En literatura de calidad de servicio (SERVQUAL/HOLSERV/HOLSAT) hay cinco dimensiones canónicas (tangibles, fiabilidad, capacidad de respuesta, seguridad, empatía). Son dimensiones *de servicio*, no *lingüísticas*.

**Riesgo 1: confundir dos conceptos distintos de "dimensión".** Tú propones una dimensión *lingüística* / *de clase de adjetivo* (tamaño, tiempo, temperatura). La industria conoce un framework paralelo de dimensiones *de servicio* (SERVQUAL). No son lo mismo. "Tiempo" como dimensión lingüística mapea a "responsiveness" de SERVQUAL. Compradores enterprise sofisticados en US van a confundirse o, peor, asumir que mides el constructo SERVQUAL cuando no.

**Riesgo 2: la semántica de dimensión es property-dependent.** "Porciones" puede ser positivo (porciones grandes en steakhouse) o negativo (porciones grandes en wellness resort). "Silencio" es positivo para habitación, negativo para bar. La misma Dimensión cambia de signo según Área. La polaridad de Dimensión hay que calcularla por par (Área, Dimensión), no globalmente.

**Recomendación**: trata Dimensión como **proyección analítica derivada** de la capa Subtema, no como capa primaria. Cómputala on-demand para dashboards. No la expongas como capa del modelo de datos que dirige indicadores, porque su semántica se invierte entre áreas.

### A.4 Mapeo LLM-based Subtema → Área — riesgo principal

Esta es la sección a leer con más cuidado.

**Lo que el mapeo determinístico te da hoy:**
1. **Reproducibilidad**: re-procesar el mes pasado produce los mismos Áreas.
2. **Auditabilidad**: una disputa ("¿por qué Housekeeping?") tiene una respuesta de una línea (la regla).
3. **Control de versiones**: cuando la taxonomía cambia, sabes exactamente qué filas históricas se afectan.
4. **Blast radius acotado**: un bug afecta solo las filas desde el deploy del bug.

**Lo que un mapeo LLM rompe:**
- **No-determinismo**: incluso a temperature 0, prompts idénticos producen outputs distintos entre batches, releases y hardware. Literatura reciente (2025, "Defeating Non-Determinism in LLMs"; kernels batch-invariant de Thinking Machines) es explícita: producción LLM es no-determinística por default a menos que se ingeniería para lo contrario.
- **Drift silencioso en upgrade de modelo**: cambiar de GPT-4o a GPT-5, o Claude 3.5 a 4, re-clasifica una fracción de menciones con el mismo prompt. Si los hoteles usan tus indicadores para decisiones internas (incluyendo bonos), cada upgrade de modelo genera fricción.
- **Alucinación en edge cases**: el LLM rutea a un Área inexistente o inventa un Subtema fuera del schema.
- **Prompt-engineering como gobernanza no documentada**: un cambio de prompt hecho por un ingeniero se vuelve de facto un cambio de regla, sin revisión.

**Aclaración con el nuevo contexto (Tambourine, comisiones no-feature).** La promesa contractual "commission-grade audit" *no aplica* porque las comisiones no son una feature. Pero el principio técnico se mantiene: los hoteles confían en los indicadores. Mover indicadores hacia atrás con cambios de prompt sigue siendo fricción de producto. La arquitectura "LLM propone, tabla determinística dispone" sigue siendo la recomendación correcta, solo que el *messaging* baja de "audit-grade enterprise SLA" a "indicadores estables y trazables".

**Recomendación arquitectónica:**
- Mantén una **tabla versionada determinística Subtema → Área** como sistema de registro.
- Usa el LLM en **modo discovery**: cuando un Subtema no existe en la tabla, el LLM propone Subtema y Área candidata. La propuesta entra a cola de revisión; una vez aprobada por humano, se *congela* en la tabla y se aplica determinísticamente.
- Para reportes históricos, persiste `map_version` por mention. Re-cálculo histórico = recomputo con la versión vigente en el `captured_at` original.
- El LLM puede *resumir* y *destacar* en dashboards (caso donde el no-determinismo es aceptable porque no hay decisiones colgando de la redacción exacta).

Patrón: **"LLM propone, regla dispone"**. Te da la capacidad de descubrimiento sin el dolor de gobernanza.

### A.5 "El adjetivo encodea el sentimiento" — ¿robusto? No.

El supuesto se ve elegante pero es empíricamente falso en hospitalidad. Contraejemplos documentados en literatura ABSA:

| Adjetivo | Contexto que invierte la polaridad |
|---|---|
| *small / pequeño* | "small portion" (–) vs "small wait" (+) vs "small fee" (+) |
| *cold / frío* | "cold beer" (+) vs "cold room" (–) vs "cold reception" (–) |
| *quiet / silencioso* | "quiet room" (+) vs "quiet bar" (–) |
| *long / largo* | "long buffet" (+ usualmente) vs "long check-in" (–) |
| *firm / firme* | "firm mattress" (+ usualmente) vs "firm refusal" (–) |
| *thin / delgado* | "thin walls" (–) vs "thin slice" (–/neutral) |
| *strong / fuerte* | "strong coffee" (+ a desayuno, – a medianoche) |

Adicionales que el atajo (N+Adj)→polaridad no maneja:
- **Negación**: *"no estaba sucio"* — el adjetivo es "sucio" pero la polaridad es positiva.
- **Intensificadores**: *"algo sucio"* vs *"extremadamente sucio"* — pesos distintos.
- **Sarcasmo**: *"la limpieza estaba 'increíble'"* — invierte signo.
- **Comparativos**: *"más limpio que la última vez"* — el Subtema "limpieza-mejorada" no entra en patrón N+Adj.
- **Aspectos implícitos**: *"encontré pelo en la almohada"* — sin adjetivo, pero inequívocamente negativo de limpieza.

**Recomendación**: no encodear polaridad en el literal del Subtema. La polaridad es propiedad *de la mención*, computada del contexto completo (aspect, opinion, sentence, doc). Entrenar/promptear al LLM con ejemplos de hospitalidad para adjetivos context-dependent. Agregar un eval set adversarial de estos casos al CI.

### A.6 Trade-offs de granularidad y long-tail

El diseño bottom-up produce un espacio Subtema de N×M (sustantivos × adjetivos) potencialmente de varios miles de celdas. Tres problemas estructurales:

1. **Sparsity por celda**: un hotel de 100 habitaciones genera 200-500 menciones/mes. Repartir entre 1500 Subtemas deja la mayoría con 0-2 observaciones. Un índice sobre 2 menciones es ruido.
2. **Confiabilidad estadística**: si los indicadores son ruidosos y los hoteles los usan para decisiones (incluso si no es feature explícita), genera percepción de injusticia. Wilson/Beta confidence intervals, smoothing hacia la media del hotel, o umbrales mínimos de N son obligatorios.
3. **Comparabilidad year-over-year**: una taxonomía bottom-up que crece en el tiempo hace que YoY sea técnicamente débil — el denominador cambia.

**Recomendación**:
- **Regla de mínimo N**: no mostrar índice por Subtema hasta ≥20 menciones en el periodo; por debajo solo conteos y ejemplos.
- **Congela el universo de Subtemas trimestralmente** para reportes oficiales. Subtemas nuevos entran al catálogo pero no afectan reportes hasta el próximo trimestre.
- **Shrinkage estimators** (Bayesian, hacia la media del hotel) para que 3 menciones negativas no muevan catastróficamente un índice.

### A.7 Auditabilidad bajo el nuevo modelo

La auditabilidad actual (drill-down a la frase, override, eliminar atribución) es una *fortaleza diferenciadora* y hay que preservarla:

1. **Cada mention persiste**: span original, aspect_term + opinion_term extraídos, Dimensión (si aplica), Área, polaridad, versión de modelo, versión de prompt, timestamp, override (si hay).
2. **Historia inmutable**: las correcciones crean fila nueva, no actualizan in-place.
3. **Path de override a nivel** Subtema, Dimensión, Área y polaridad. El override es la verdad de la fila para reportes.
4. **Explainability snippet**: una frase por mention que explique por qué fue ruteada así. Esto sigue siendo requerido para venta enterprise en US — Medallia y Qualtrics entrenaron al comprador.

### A.8 Migración y compatibilidad hacia atrás

Esto es el asesino silencioso de refactors de taxonomía:

- **Continuidad de trend**: la capa Tema legacy desaparece. Si no precomputas una vista Tema-equivalente determinística desde los nuevos datos, todo hotel con 2+ años de uso pierde sus trend lines el día del switchover. Esta es la causa #1 de churn post-refactor de herramientas CX.
- **Recomendación**: construir una **vista legacy** que mapee los nuevos Subtemas/Categorías a los Temas antiguos vía un bridge determinístico. Run sobre 12 meses de back-fill. Sunset solo después de un ciclo anual completo.
- **Coexistencia**: shadow-run de al menos 60-90 días donde ambos motores corren en paralelo. Sin esto, los hoteles que usan Semántico para decisiones internas (bonos, evaluaciones de área) tienen disputas.
- **Re-baselining de benchmarks**: si myHotel publica un benchmark/índice por grupo, el refactor invalida los pre-refactor. Publica un factor de conversión v1→v2 con metodología explícita.

### A.9 Recomendaciones concretas (consolidadas)

1. **Re-arquitecta el modelo usando primitivos ABSA estándar**: aspect_term, opinion_term, aspect_category, polarity, organizational_area_mapping. No reinventes vocabulario que el campo ya tiene resuelto. Reserva "Subtema/Dimensión/Área" solo para etiquetas en la UI en español.
2. **Acota la taxonomía desde arriba**: catálogo curado de ~15-25 aspect_categories hoteleras. LLM extrae bottom-up pero clasifica en el set bounded.
3. **LLM en modo discovery, no en routing de producción**. Tabla determinística Subtema → Área versionada. LLM propone, humano aprueba, tabla dispone.
4. **Polaridad contextual**, no del adjetivo aislado. Eval set adversarial.
5. **Dimensión como vista derivada**, no como capa primaria del modelo de datos.
6. **Versionado total**: modelo, prompt, mapping. Cada mention persiste las tres versiones.
7. **Plan de migración a 12 meses** con bridge legacy, parallel run y reconciliación.
8. **Cuantifica el uplift antes de comprometerte al messaging**: corre el pipeline nuevo sobre 12 meses de data etiquetada; si el F1 lift en ACD, polaridad y routing no es materialmente mejor que el motor actual, la elegancia conceptual no sobrevive una review de cliente.

---

## TASK B — Benchmark competitivo del mercado US de SaaS CX hotelero

### B.1 Metodología y advertencias

Hallazgos basados en documentación de vendor, product pages públicas, Hotel Tech Report, press releases y cobertura de industria 2024-2026. Donde se dice "el vendor afirma", no fue verificado independientemente — la auto-descripción del vendor suele ser más optimista que el producto desplegado. Precios raramente públicos en esta categoría; notas de precio son direccionales.

### B.2 Perfil vendor por vendor

#### Shiji ReviewPro (ex-ReviewPro, ahora parte de Shiji Group)

- **Taxonomía**: dos niveles explícitos en su Semantic Analysis — conceptos (Limpieza, Staff, Desayuno, Wi-Fi) con sentimiento por concepto. ReviewPro ha enviado cuatro versiones mayores del motor; v4 enfatiza precisión de sentimiento y filtros avanzados. Posicionado alrededor del Global Review Index™ (GRI), que es la métrica *basada en ratings*; las menciones semánticas son señal *separada pero correlacionada*. ReviewPro es explícito: menciones semánticas NO directamente alimentan el GRI — son diagnósticas.
- **Granularidad**: nivel aspect-category. La documentación pública no llega a "ducha vs WC".
- **LLM vs NLP clásico**: mezcla — históricamente NLP clásico con ML, recientes updates agregan respuestas AI.
- **Auditabilidad/override**: workflows de corrección existen; profundidad no documentada públicamente. Reviews en Hotel Tech Report marcan "imprecisiones en análisis semántico" como queja recurrente.
- **Multi-canal**: 140+ sitios de review, encuestas in-stay y post-stay, case management, messaging. Sólido.
- **Updates recientes**: respuestas AI generadas, Benchmark Reports trimestrales, análisis de impacto, benchmarking competitivo.
- **Posicionamiento**: enterprise + mid-market global, 60,000+ propiedades en 150+ países. Incumbente default fuera de US con >10 años de historia.

#### TrustYou (SentimentAI / CXP)

- **Taxonomía**: explícitamente jerárquica y MECE. Según sus propias comunicaciones, SentimentAI corre sobre **700+ categorías y subcategorías semánticas** en **23 idiomas**, estructuradas Categoría → Subcategoría → Departamento. Es la estructura más directamente competitiva al modelo propuesto de myHotel.
- **Granularidad**: nivel subcategoría. Promocionan "drill-down a subcategorías precisas" — no explícitamente "ducha vs WC", pero la arquitectura soporta esa profundidad si el catálogo lo incluye.
- **Sentimiento por opinión**: sí — extraen múltiples opiniones por frase ("la habitación estaba impecable pero el baño se sentía viejo" → dos opiniones, dos subcategorías, dos polaridades). ABSA de manual.
- **Uso de LLM**: SentimentAI es "AI-powered semantic analysis"; SummaryAI (summaries tipo LLM), ResponseAI (replies generadas), InsightsAI (anomalías). Mejora continua con revisión humana.
- **Multi-canal**: reviews + encuestas + benchmarking, CXP unificado.
- **Updates recientes (2024-2026)**: lanzamiento de marca SentimentAI, SummaryAI semanal, ResponseAI, InsightsAI; CDP para Golden Profiles; AI Agents.
- **Posicionamiento**: el competidor más directamente comparable al refactor propuesto. **TrustYou ya construyó la arquitectura que estás proponiendo**, y a mayor escala (23 idiomas, 700+ categorías).

#### Medallia (Text Analytics for Hospitality)

- **Taxonomía**: top-down y customizable por el cliente. Medallia envía **15,000+ topics starter** en **17+ idiomas** en **15+ industrias**; el analista del cliente construye/refina su propia jerarquía en low-code. Parsea verbatims a nivel *frase* (múltiples topics por sentencia) con sentimiento por topic. La jerarquía de topics se mapea a la jerarquía organizacional — case studies (Marriott guestVoice, IHG HeartBeat con Ipsos+Medallia, Hilton 54,000+ usuarios activos) destacan ese mapeo "comment → quién es responsable" como core feature.
- **Granularidad**: tan profunda como el cliente configure. Cobertura ~80% con alta precisión como baseline.
- **Uso de LLM**: combina stack NLU clásico entrenado con features generativas tipo LLM nuevas, marketeado como "smarter, safer Gen AI" — la posición es *determinístico estable* sobre *LLM puro* (menos alucinación, más auditable para enterprise).
- **Auditabilidad/override**: **fuerte y maduro**. Los clientes ajustan topic models, reentrenan, overridean clasificaciones, trazan a frase.
- **Multi-canal**: surveys, reviews, contact center, speech analytics — la cobertura de canales más amplia del campo.
- **Updates recientes (2024-2026)**: "Smarter, safer Gen AI"; event analytics y compound topics; modelos pre-built por industria.
- **Posicionamiento**: enterprise (Marriott, Hilton, Wynn, Hyatt, Four Seasons, IHG). Caro y lento de deployar. El complemento estructural de TrustYou para el top del mercado.

#### Revinate

- **Taxonomía**: catálogo de topics hotelera, "cientos de topics más importantes para hoteles, categorizados según operaciones tradicionales". Dos niveles (topics bajo categorías operacionales: rooms, cleanliness, F&B, service, location, value).
- **Granularidad**: nivel aspect-category con sub-breakdowns ("amenities en más de diez categorías detalladas").
- **Uso de LLM**: mezcla; blog 2024-2025 enfatiza features AI nuevas. Porter API expone sentimiento por topic.
- **Auditabilidad/override**: workflows de ticketing y review-level; override de sentimiento no profundamente documentado.
- **Multi-canal**: 45+/100+ sitios de review, encuestas post-stay e in-stay, integración PMS, "Rich Guest Profile" CDP. Fuerte en marketing/CRM tanto como en feedback.
- **Posicionamiento**: dominante en independent y mid-market US; diferenciador es la integración CRM/CDP, no la profundidad del análisis. Round-up 2026 de MARA lo describe como amplio-pero-superficial en response.

#### GuestRevu

- **Taxonomía**: más ligera — word-cloud / theme detection más que ontología profundamente estructurada. Reports sobre "areas of service" con tagging simple positive/neutral/negative a nivel campo de comentario.
- **Granularidad**: nivel theme / keyword; no jerárquica profunda.
- **Uso de LLM (2024-2026)**: GuestRevu AI (response generation) y GuestRevu AI Analytics (2025) — emotion detection, themes & keywords, action items, trend tracking.
- **Auditabilidad/override**: per su Help Centre, los usuarios pueden manualmente borrar o recalcular sentiment en reviews — capacidad de override explícita y bien documentada.
- **Posicionamiento**: SMB/mid-market, fuerte en UK / EMEA / South Africa, precio menor. El segmento "lo suficientemente smart, lo suficientemente simple".

#### MARA AI / MARA Solutions

- **Taxonomía**: detección ligera de topics como input al *generador de respuestas* (el producto core). Profundidad de topics es funcional, no estructural.
- **Granularidad**: superficial — usado para informar generación de respuesta, no para conducir ontología operacional.
- **Uso de LLM**: pesado. Esencialmente un producto LLM-native de response. Posicionado como líder de *response* más que de *analytics*.
- **Posicionamiento**: desde 60€/mes entry, el AI-native emergente de crecimiento más rápido. Amenaza fuerte a incumbentes en el eje *response*, más débil en analytics profundo.

#### Canary Technologies

- **Foco no es VOC** — son plataforma guest-management (check-in contactless, autorización digital, AI Voice/Webchat/Messaging, upsell). Sentiment es downstream.
- **Posicionamiento**: fuerte en US mid-market y luxury (Four Seasons, Ace Hotel, propiedades Hilton). Competidor *de canal*, no de analytics semántico — captura data in-stay que myHotel no posee nativamente.

#### HiJiffy

- **Taxonomía**: feature "sentiment analysis" en el AI engine Aplysia, clasifica conversaciones como Happy/Unhappy a nivel conversación. No aspect-level.
- **Posicionamiento**: líder europeo de chatbot (2,500+ hoteles, 60+ países, 130+ idiomas). Competidor *de canal*, no de analytics.

#### Akia, Asksuite, Loopon, Customer Alliance, Quicktext

- En general competidores de canal (messaging) o players regionales con analytics más superficial. Loopon explícitamente promueve filosofía opuesta a la tuya: *"obtener feedback de mil huéspedes en pocos parámetros clave es más importante que obtenerlo de pocos huéspedes en mil parámetros"*.

#### Otros relevantes para el push USA

- **Qualtrics XM for Hospitality** — competidor enterprise directo a Medallia, motor Clarabridge / XM Discover.
- **Forsta / Confirmit / Verint (Voci)** — vendors enterprise VOC; menos hotelería-específicos pero aparecen en RFPs.
- **Luminoso, Stratifyd** — ISVs de text analytics que grupos hoteleros agregan sobre Medallia/Qualtrics cuando no es suficiente.
- **Olery, Reputize, Reputation.com, Birdeye** — agregadores de reviews; sentimiento superficial.

### B.3 Matriz comparativa

| Vendor | Profundidad taxonomía | Sentimiento aspect-level | LLM-native | Override/audit | Multi-canal | Roadmap AI reciente |
|---|---|---|---|---|---|---|
| **TrustYou** | 3 niveles, 700+ categorías, MECE | Sí, multi-opinion por frase | Sí (SentimentAI, SummaryAI, ResponseAI) | Implícito, loop revisión humana | Surveys, reviews, benchmarking | Fuerte |
| **Shiji ReviewPro** | Categorías + departmental | Sí (con polaridad) | Híbrido; respuestas AI agregadas | Corrección estándar | 140+ sitios, surveys, case mgmt | Moderado |
| **Medallia** | Custom, 15k+ topics starter | Sí, nivel frase | Híbrido; "safer Gen AI" | **Fuerte, maduro** | Reviews, surveys, voz, contact ctr | Fuerte enterprise |
| **Revinate** | "Cientos de topics" | Sí, nivel topic | Híbrido | Ticketing-focused | 100+ sitios, surveys, CRM/CDP | Moderado |
| **GuestRevu** | Themes + keywords más ligero | Comment-level + theme | AI Analytics + AI Responses nuevos | **Override explícito** | Reviews + surveys | Fuerte SMB |
| **MARA AI** | Topic frequency | Superficial (para response gen) | LLM-native | Human-in-the-loop responses | Reviews + AI surveys | Muy fuerte |
| **Canary** | No es core | No (competidor canal) | LLM-native (Voice/Chat) | n/a VOC | In-stay messaging + portal | Fuerte non-VOC |
| **HiJiffy** | Conversación Happy/Unhappy | No | LLM-native (Aplysia) | Conversation level | Messaging | Fuerte non-VOC |
| **Loopon** | Más ligero | Sentiment trends | AI-assisted responses | Estándar | Surveys + reviews + benchmark | Moderado |

### B.4 Dónde quedaría el modelo propuesto de myHotel

**No es novedoso conceptualmente.** Extracción bottom-up + taxonomía jerárquica + asignación de categoría con LLM es la arquitectura *actual* dominante de los players serios. TrustYou explícitamente; Medallia y ReviewPro con otro vocabulario. La capa Subtema (N+Adj) es *más granular* que lo que TrustYou y ReviewPro promocionan, pero competidores fuertes podrían igualarla mañana si un buyer la pide — su arquitectura lo soporta.

**Novedoso a nivel Dimensión — espada de doble filo.** Exponer Dimensión (clase de adjetivo) como capa user-facing es genuinamente poco común. Ningún competidor lo promociona explícitamente. Pero por las razones de Sección A.3 — la semántica de dimensión se invierte entre áreas, y SERVQUAL ya entrenó al mercado a esperar "dimensión" significando algo distinto.

**Atrás en gobernanza enterprise.** Medallia y TrustYou llevan 5+ años invirtiendo en explainability y audit. La fortaleza actual de myHotel en override/audit hay que preservarla, no debilitarla con un LLM mal acotado.

**Empate en multi-canal.** OTAs + onsite + post-stay es table stakes; todo serio lo hace.

### B.5 Gaps que el nuevo modelo *podría* explotar (con Tambourine en mente)

Dado que el push a US es vía Tambourine y no standalone, el cálculo cambia:

1. **Paridad funcional para no quedar eliminado en RFP** dentro del bundle Tambourine. ABSA estándar, multi-aspecto por frase, drill-down a aspectos específicos, override visible. Estos son table stakes que Semántico necesita para no ser un drag en deals donde Tambourine compite.
2. **Calidad bilingüe nativa EN/ES**. US tiene huéspedes hispanos significativos en California, Texas, Florida, Nevada. TrustYou tiene 23 idiomas pero Spanish-quality varía; Medallia tiene 17+. Native quality + customer success hispanoparlante es diferencia real, no absoluta.
3. **Integración con stack Tambourine**: si Tambourine tiene marketing, ads, distribución, integrar la data semántica como input a esas herramientas (no solo como dashboard hotelero standalone) es donde Semántico se vuelve estratégico al bundle.
4. **Granularidad operacional ticketing-ready**: shower vs WC vs amenities, integrado a workflows operacionales. Útil para limited-service y select-service brands US.

### B.6 Riesgos de quedar fuera de posición

1. **TrustYou SentimentAI es el análogo conceptual directo**. Si lanzan SKU enterprise-audit en 2026, la ventana cierra.
2. **Medallia es dueño del comprador enterprise hospitality**. Toda cadena >50 propiedades en US probablemente ya tiene Medallia. Net-new acá requiere o complemento (difícil) o reemplazo (muy difícil). Tambourine bundle ataca *por debajo* de Medallia, no en su segmento.
3. **MARA, Canary, HiJiffy, Akia se están comiendo el canal in-stay** (WhatsApp, app chat). Si Semántico no tiene acceso first-party a esos canales (Concierge ayuda), su corpus VOC se reduce vs competidores.
4. **Líderes de response embebidos (MARA, ReviewPro, Revinate) atan analytics a workflow**. Analytics pura sin loop de response/ticketing se ve cada vez más como table stakes que no justifica renovación.
5. **Dimensión CDP/CRM**: Revinate y TrustYou agrupan feedback con CDP. Producto analytics standalone sin CDP se ve obsoleto en RFP enterprise.

### B.7 Recomendación honesta dado contexto Tambourine

El refactor es **higiene de producto necesaria**, no jugada estratégica standalone. El nivel de inversión y messaging depende de qué decida Tambourine sobre el rol de Semántico:

**Escenario A — Semántico como diferenciador del bundle Tambourine.** Inviertes fuerte, lo posicionan como "included sin costo extra" vs Revinate/ReviewPro standalone. El refactor completo se justifica. Foco: profundidad + integración bundle.

**Escenario B — Semántico como must-have-but-not-hero.** Cierras gaps básicos para paridad funcional en RFPs, no inviertes en profundidad. El alcance se recorta a ~40-50% de la guía de implementación. Foco: ABSA estándar + override + bilingüe.

**Escenario C — Semántico como data feeder de otras herramientas Tambourine** (marketing, ads, CRM, distribución). Re-orientas hacia API-friendly outputs, no UI/dashboards de Semántico standalone. Foco: schema limpio + exports + integración.

Sin señal de Tambourine sobre cuál escenario aplica, optimizar el refactor en todos los ejes es disparar a ciegas.

**Trabajo de bajo riesgo independiente del escenario** (sí o sí útil):
- Modelo de datos ABSA (esquema, mentions, override log inmutable, discovery queue).
- Catálogo curado de aspect_categories y eval set bilingüe.
- Pipeline de extracción + canonicalización + routing determinístico.
- Plan de migración con bridge legacy.

**Trabajo que esperaría hasta tener señal**:
- Investment en feature de auditoría enterprise-grade (Sección 5.3 de la guía técnica).
- Integraciones específicas con CRM/CDP/ads de Tambourine.
- Posicionamiento de marketing y materiales sales.
- SKU pricing y bundling.

---

## Síntesis — qué hacer el lunes

1. **Reframear el refactor en vocabulario ABSA estándar** (aspect term, opinion term, aspect category, polarity, organizational mapping). Reservar "Subtema/Dimensión/Área" solo para la UI en español.
2. **Arquitectar "LLM propone, tabla determinística dispone"** para el routing Subtema → Área. Persistir versión de modelo + prompt + mapping por cada mention. Override gana sobre predicción.
3. **Tratar Dimensión como vista derivada**, no capa primaria del modelo de datos.
4. **Construir eval set adversarial bilingüe** (~200 inicial, crecer a 500-1000) con context-dependent, negación, comparativos, sarcasmo, multi-aspecto, implícitos. Gates de CI bloquean release.
5. **Plan de migración a 12 meses** con bridge legacy → v2 para preservar trend lines. Comunicar como beneficio ("preservamos tu histórico"), no como restricción.
6. **Conversación con Tambourine** sobre el rol de Semántico en el bundle US. Sin esto, dimensionar la inversión es adivinar. Las tres preguntas: ¿diferenciador, paridad o data feeder?
7. **Resistir competir en flash AI** (response generators, summaries, agents). MARA, GuestRevu, TrustYou, ReviewPro y Revinate ya juegan ahí. El terreno de Semántico es la profundidad y la auditabilidad.
8. **Trabajo no-bloqueable**: empezar el modelo de datos ABSA, el catálogo curado, y el eval set. Sirve en cualquier escenario Tambourine.

El refactor tiene mérito técnico y es overdue. Pero su valor estratégico en US depende de la jugada de Tambourine, no de la elegancia de la ontología. Las dos cosas que sí controlas son: (a) hacer el refactor con higiene ABSA estándar para no quedar fuera técnicamente; (b) preservar auditabilidad como fortaleza diferenciadora real. Lo demás se define cuando Tambourine baje el mensaje.

— *Sin complacencia, con detalle.*
