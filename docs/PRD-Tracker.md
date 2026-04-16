# PRD: myHotel Tracker

**Producto:** myHotel Labs → Tracker
**Autor:** Andrés (Product Owner)
**Versión:** 0.2
**Fecha:** 2026-04-16
**Estado:** Draft (decisiones de §15 cerradas)

---

## 1. Problema

No existe una base de datos unificada, actualizada y accionable de hoteles en LatAm + USA con su stack tecnológico, presencia en OTAs y contactos de decisores. Esto bloquea:

- Prospección comercial de myHotel (no sabemos qué PMS/CRM usa cada hotel, ni a quién escribirle).
- Inteligencia competitiva (¿qué está tomando Cloudbeds vs SiteMinder vs Opera en LatAm?).
- Priorización de mercados y segmentos (independientes vs cadenas, budget vs luxury).
- Partnerships (integraciones prioritarias según penetración real de cada stack).

Hoy el trabajo se hace manual, con CSVs dispersos (`hotel-scraper/` tiene ~33k hoteles en CSV sin enriquecer) y sin pipeline de actualización.

## 2. Objetivo

Construir **myHotel Tracker**: una base de datos viva de hoteles en LatAm + USA, alimentada por pipelines automatizados de descubrimiento, detección de stack, linkage a OTAs y enriquecimiento de contactos. Accesible como UI interna dentro de myHotel-Labs + API JSON para consumo por otras herramientas (Concierge, Onboarding, CRM).

Entregable final: dado un hotel (por URL, nombre+ciudad, o coordenadas), responder en segundos:

1. Identidad canónica (nombre, ubicación, categoría, tamaño).
2. Stack tecnológico (CMS, booking engine, channel manager, PMS si es inferible, widgets/scripts de terceros, agencia web).
3. Presencia digital (dominio oficial + perfiles en Booking, Expedia, TripAdvisor, Airbnb, VRBO, Hotels.com, Google Hotel).
4. Contactos clave (GM, Revenue, Marketing, IT — nombre, cargo, email, teléfono, LinkedIn).
5. Señales de actividad (último cambio de stack, campañas recientes, reviews volumen).

## 3. Usuario principal

**Interno de myHotel**: Sales, Partnerships, Producto. Secundario: CSM (para calificar cuentas existentes), Marketing (para ABM).

No es self-service para hoteles ni producto de cara a cliente.

## 4. Ubicación en la UI

`myHotel-Labs → Tracker`

Módulos dentro de Tracker:

- `Tracker → Search` — búsqueda individual por URL o nombre.
- `Tracker → Bulk` — carga CSV de URLs/hoteles y corrida batch.
- `Tracker → Discovery` — descubrimiento geográfico (por país/región/ciudad).
- `Tracker → Browse` — explorador de la base (filtros por stack, país, tamaño, OTAs).
- `Tracker → Prospecting` — colas de outreach (voz + email + LinkedIn).

## 5. Scope por versión

### 5.1 v1 — MVP: Tech Stack + OTAs desde URL (confirmado)

**In scope:**

- Input: una URL o CSV de URLs.
- Detección de CMS (WordPress, Wix, Squarespace, Webflow, custom).
- Detección de booking engine (SiteMinder/TheBookingButton, Cloudbeds, Little Hotelier, Mews, Opera, SynXis/Sabre, Vertical Booking, Hotelbeds, Travelclick, Guestline, roomcloud, BookDirect, Profitroom, Hotetec, Availpro, Pegasus, custom).
- Detección de scripts/widgets de terceros con categorización (analytics, chat, reviews, CRM, PMS hooks, retargeting).
- Identificación de agencia web (meta tags, footer, `generator`, links a sitios de agencias).
- Detección de OTAs vinculadas: intentar extraer enlaces desde el sitio + fallback por búsqueda (SerpAPI/Serper) con matching por nombre + geolocalización.
- Almacenar en Postgres con confianza por señal.
- UI para búsqueda individual + bulk upload + export CSV/JSON.

**Out of scope v1:** discovery geográfico, contactos, outbound, voz.

### 5.2 v2 — Discovery geográfico

- Dado un país/región/ciudad, generar lista de hoteles candidatos.
- Fuentes: Google Places, Mapbox POI, Booking (vía SerpAPI), Expedia, scraper de TripAdvisor.
- Normalización y dedupe (fuzzy matching por nombre + coords).
- Cola de enriquecimiento: cada hotel nuevo se manda automáticamente al pipeline v1 para completar stack.

### 5.3 v3 — Contactos y decisores

- Pipeline de contacto: LinkedIn (scraping + datos de terceros), Apollo, Hunter, RocketReach, Clearbit.
- Roles target: GM, Owner, Director Comercial, Revenue Manager, Marketing, IT/Digital.
- Enriquecimiento cruzado con sitio web (página "equipo", "contacto").
- Validación de emails (MX + SMTP probe).

### 5.4 v4 — Prospecting automatizado

- Secuencias multicanal: email, LinkedIn InMail, voz.
- Agente de voz (ElevenLabs + Vapi/Retell/Bland) para llamadas frías de calificación.
- Playbooks por segmento (independiente vs cadena, tamaño, stack actual).
- Handoff a humano con transcripción + resumen.
- **Salida de leads (sin CRM en v1-v4):** los leads viven en Tracker. Dos rutas de distribución a definir en esta fase:
  - Notificación a Slack con tarjeta de oportunidad (canal por zona geográfica).
  - Creación de deal en HubSpot asignado al owner de la zona.
  - Integración formal con HubSpot queda fuera de v4; se prototipa y se decide según resultados.

## 6. Postura legal y de riesgo

**Decisión del PO (Andrés):** postura agresiva, se asume riesgo.

Implicancias explícitas que el PRD reconoce:

- **LinkedIn scraping:** viola ToS; jurisprudencia reciente (hiQ v. LinkedIn) deja espacio gris para datos públicos. Se scrapeará con rotación de cuentas, residential proxies y rate limits defensivos. Riesgo: banning de cuentas, eventual acción legal. Mitigación: cuentas burner, no operar desde cuentas corporativas, complementar con fuentes pagadas (Apollo/Hunter) como fallback.
- **Scraping de Booking/TripAdvisor/Expedia:** viola ToS. Se prioriza SerpAPI/Serper/DataForSEO (que ya operan en esa zona gris) para reducir exposición directa.
- **Voz outbound automatizada:**
  - USA: TCPA es jurisdicción de altísimo riesgo. Se aplica `do-not-call` + consentimiento previo + opt-out inmediato. Voz outbound en USA queda condicionada a opt-in explícito (ej. formulario web) antes de salir.
  - Chile: Ley 21.521 + Ley 19.496 — permite B2B pero con límites de horario y registro. Manejable.
  - México: LFPDPPP — aviso de privacidad y opt-out.
  - Brasil: LGPD — base legal requerida; usar "interés legítimo B2B" como fundamento.
- **Datos personales de decisores:** se tratan bajo interés legítimo B2B, no marketing directo a consumidor.

**Acción requerida antes de v3/v4:** revisión con abogado de myHotel (Anthony/quien corresponda) para validar postura y armar aviso de privacidad + proceso de supresión. Sin ese OK, v3/v4 no salen a producción.

## 7. Arquitectura técnica

### 7.1 Stack

- **App:** Next.js 16 (App Router) dentro de `myhotel-labs`, siguiendo convenciones existentes.
- **UI:** React 19 + Tailwind. Tablas densas tipo Bloomberg (consistente con editorial/data-journalism del resto de Labs).
- **API:** `src/app/api/tracker/*` con `route.ts`. JSON in/out.
- **Workers:** separados del app Next. Python (reutilizando base de `hotel-scraper/`) para jobs largos: crawling, discovery, enrichment. Orquestados con cola (Redis + RQ o BullMQ; decidir según ops).
- **DB:** PostgreSQL (mismo cluster que Labs). Migraciones versionadas. Considerar pgvector si se embedean descripciones para match semántico.
- **Detección de stack:** Wappalyzer (open source, MIT) como base + reglas hotel-specific propias mantenidas en JSON versionado. **No reinventar** lo que Wappalyzer ya detecta bien.
- **Search/OTA fallback:** SerpAPI y/o Serper (ya integrado en hotel-scraper).
- **Headless browser:** crawl4ai (ya probado en hotel-scraper) o Playwright según necesidad JS.
- **Geocoding:** Mapbox + OpenCage + LocationIQ con fallback (ya implementado en hotel-scraper, reusar).
- **LLM primario:** Google Gemini vía `GEMINI_API_KEY` (env var). Modelo por tarea (ver §10.1). Claude y OpenAI quedan como fallback opcional, consistente con la convención multi-LLM del resto de Labs.
- **Contactos:** Apollo + Hunter + RocketReach como primaria; scraping LinkedIn como secundaria.
- **Voz:** Vapi o Retell (ElevenLabs para TTS). Twilio para conectividad.

### 7.2 Reutilización desde `hotel-scraper/`

Auditoría del código existente (ver anexo §13):

| Componente | Reutilización | Acción |
|---|---|---|
| `geopoblar.py` (Nominatim + OpenCage + LocationIQ) | ALTA | Migrar a worker de Tracker como módulo `geocoding`. |
| `mapbox.py` (reverse geocoding) | ALTA | Migrar; parametrizar país (actual hardcoded). |
| `buscar_urls_hoteles.py` (DuckDuckGo search) | ALTA | Reusar como fallback gratis para URL discovery. |
| `crawl_hotel.py` (crawl4ai) | ALTA | Base del crawler v1 para fetch HTML + renderizado JS. |
| `enriquecer_urls_serpapi.py` | MEDIA | Refactor a módulo `search_providers` con interfaz común (SerpAPI/Serper/DDG). |
| `search.py` (orquestación Serper) | MEDIA | Reusar patrón de incremental save + batching. |
| CSV base (33,880 hoteles LatAm) | ALTA | Importar como seed inicial a tabla `hotels`. |
| `hotel-scraper-bot-legacy/` (Scrapy vacío) | NULA | Descartar. |
| Dedupe `drop_duplicates` | BAJA | Insuficiente; implementar fuzzy match + geo match. |

**Decisión:** `hotel-scraper/` se archiva como legacy. El código reutilizable se migra a `myhotel-labs/workers/tracker/`. No se mantienen dos pipelines.

### 7.3 Flujo v1 (URL → stack + OTAs)

```
POST /api/tracker/analyze { url }
   → worker.enqueue(analyze_url, url)
       → fetch HTML (crawl4ai, 2 intentos: con JS y sin JS)
       → parse con wappalyzer-python
       → aplicar reglas hotel-specific (booking engines, channel managers)
       → extraer outbound links → filtrar OTAs
       → si no hay OTAs → fallback search (hotel_name + city → SerpAPI)
       → normalizar y guardar en DB con confianza por señal
       → retornar job_id
GET /api/tracker/analyze/:job_id → status + resultado
```

## 8. Data model (v1 core, extensible)

```
hotels
  id (uuid), canonical_name, slug, country, region, city,
  lat, lng, category, stars, rooms_estimate,
  website_url, brand, chain_id (fk),
  is_customer (bool, default false),
  external_id (nullable),
  created_at, updated_at, last_enriched_at

hotel_urls
  hotel_id, url, kind (official|landing|subdomain),
  verified_at, confidence (0-1)

hotel_stack
  hotel_id, category (cms|booking_engine|pms|channel_mgr|analytics|chat|reviews|ads|other),
  vendor, product, version, detected_via (wappalyzer|rule|llm|manual),
  evidence_url, confidence, first_seen_at, last_seen_at, active (bool)

hotel_ota_presence
  hotel_id, ota (booking|expedia|tripadvisor|airbnb|vrbo|hotels|agoda|google),
  profile_url, external_id, verified_at, confidence,
  review_count, rating, last_scraped_at

hotel_agency
  hotel_id, agency_name, agency_url, evidence, confidence

hotel_contacts  (v3)
  id, hotel_id, full_name, role, role_normalized,
  email, email_status, phone, linkedin_url,
  source (apollo|hunter|linkedin|site|manual), confidence,
  created_at, verified_at

hotel_events  (auditoría v1+)
  id, hotel_id, event_type (stack_change|ota_added|contact_added|...),
  payload (jsonb), observed_at

hotel_sources  (proveniencia)
  id, hotel_id, source (mapbox|serpapi|wappalyzer|apollo|linkedin|manual|csv_bulk),
  raw (jsonb), fetched_at

hotel_discovery_jobs  (v2+)
  id, scope (country|region|city|bbox), params, status, started_at, finished_at,
  discovered_count, new_count
```

**Principios del data model:**

1. **Proveniencia siempre trazable** (`hotel_sources` guarda raw).
2. **Confianza por señal** (0-1), nunca colapsar a booleano prematuramente.
3. **Versionado temporal** (`first_seen_at`/`last_seen_at`): el stack cambia, no se sobrescribe, se registra en `hotel_events`.
4. **Entidad canónica separada de fuentes:** un hotel puede venir de Booking + Mapbox + website, pero es UN registro.
5. **Dedupe por (nombre normalizado + lat/lng con tolerancia 100m) + (dominio).**

## 9. Inputs v1

### 9.0 Flag `is_customer` desde CSV

El CSV de seed y los CSVs de bulk pueden incluir una columna opcional `is_customer` (`true`/`false`). Se persiste en `hotels.is_customer` y se usa para:

- Filtrar en Browse (clientes vs no clientes).
- Evitar gatillar prospecting sobre clientes actuales (guardrail en v4).
- Medir penetración por stack solo sobre no-clientes (inteligencia de mercado).

Andrés se encarga de marcar `is_customer` al cargar el CSV inicial. No se infiere automáticamente en v1.

### 9.1 URL individual

Formulario simple: URL → submit → spinner → resultado en tabla con:

- Stack detectado (categoría, vendor, confianza, evidencia).
- OTAs encontradas (icono + link al perfil).
- Agencia web si detectada.
- Botón "guardar en base" / "re-analizar".

### 9.2 Bulk CSV

Schema esperado (headers obligatorios):

| Columna | Tipo | Requerido | Uso |
|---|---|---|---|
| `url` | string | sí (o `name`+`city`) | URL del sitio del hotel |
| `name` | string | opcional | Para dedupe + fallback search |
| `city` | string | opcional | Para dedupe + geo |
| `country` | string (ISO 2) | opcional | Para geo |
| `external_id` | string | opcional | ID externo (para mapear a CRM futuro) |
| `is_customer` | bool | opcional | Marca hoteles que ya son clientes de myHotel |

Validación en UI antes de enqueue. Reporte de progreso en vivo. Export del resultado como CSV + JSON.

## 10. Detección de stack: reglas hotel-specific

Base de reglas propia (no hay dataset público bueno para esto) mantenida en `data/tracker/rules/`:

- **Booking engines:** firma por dominios de iframe (`book.siteminder.com`, `hotels.cloudbeds.com`, `reservations.travelclick.com`, `be.synxis.com`, etc.), clases CSS específicas, scripts JS conocidos.
- **Channel managers:** detectables por tráfico de widgets OTAs.
- **PMS:** solo inferible cuando el booking engine lo delata (ej. Opera → Oracle; Mews → Mews; Cloudbeds → Cloudbeds). No se promete 100% de cobertura.
- **Widgets:** Livechat (Intercom, Zendesk, Crisp), Reviews (TrustYou, Revinate, ReviewPro, myHotel), Retargeting (Meta Pixel, Google Ads, TikTok), Analytics (GA4, Hotjar, Clarity).
- **Agencia web:** detectar `<meta name="generator">`, footer con "Powered by / Designed by", enlaces salientes a sitios de agencias conocidas (Meat Agency, etc.).

Mantener como JSON versionado con PRs para agregar reglas. Cada regla tiene `confidence_base` y evidencia requerida.

### 10.1 LLM como verificador (no como primer paso)

LLM **no** se usa para detectar stack en bruto (caro e impreciso a escala). Se usa solo cuando las reglas fallan o para normalización. Estrategia multi-modelo con Gemini como primario (`GEMINI_API_KEY`), seleccionando modelo por tarea según costo/capacidad:

| Tarea | Modelo recomendado | Razón |
|---|---|---|
| Clasificar widget/script desconocido en categoría | `gemini-2.5-flash-lite` | Clasificación corta, alto volumen, latencia baja. |
| Normalizar nombre de vendor (ej. "SiteMinder TBB" → "SiteMinder The Booking Button") | `gemini-2.5-flash-lite` | Prompt pequeño, determinístico. |
| Extraer nombre de agencia web desde footer ambiguo | `gemini-2.5-flash` | Requiere algo de contexto del HTML. |
| Extraer contactos/roles desde páginas "Nosotros/Equipo" (v3) | `gemini-2.5-flash` | Extracción estructurada con schema JSON. |
| Matching de entidad hotel ambigua (nombres parecidos + geo) | `gemini-2.5-pro` | Razonamiento, baja frecuencia, alto impacto en calidad. |
| Generación de guion/reply en prospecting (v4) | `gemini-2.5-pro` | Calidad de output prima sobre costo. |

Reglas operacionales:

- Todas las llamadas pasan por un wrapper `llm.call(task, payload)` que decide modelo + maneja cache por hash de input.
- Cache agresivo (redis o tabla Postgres) con TTL diferenciado: 30 días para clasificación de widgets, 7 días para matching de entidad.
- Presupuesto máximo por URL analizada en v1: 1 llamada flash-lite + 1 flash opcional. Si se excede, se loguea y la URL queda marcada para review manual.
- Fallback a Claude Haiku / OpenAI solo si Gemini falla por error 5xx o rate limit — no por calidad.

## 11. Métricas de éxito

**v1:**

- Tiempo medio por análisis de URL: < 15s (p50), < 45s (p95).
- Cobertura de detección de booking engine: > 70% en sample de 500 hoteles LatAm.
- Precisión de OTA linkage: > 90% (muestreo manual de 100 casos).
- Falsos positivos en CMS: < 5%.

**v2:**

- Cobertura geográfica: 200k+ hoteles en LatAm + USA al final del primer trimestre post-v2.
- Tasa de dedupe correcto: > 95% (muestreo manual).

**v3:**

- ≥ 1 contacto decisor por hotel en el 60% de la base.
- Bounce rate de email: < 10%.

**v4:**

- Response rate cross-channel: benchmark vs baseline manual del equipo Sales.

## 12. Anti-patterns (qué NO hacer)

1. **No reinventar Wappalyzer.** Se usa su base; solo se agregan reglas hotel-specific.
2. **No scrapear directo Booking/TripAdvisor** cuando SerpAPI/Serper sirven. Menos riesgo, menos mantención.
3. **No mezclar el pipeline de ingesta con la UI.** UI lee DB; workers escriben DB. Nunca la UI llama crawlers sincrónicos (timeouts asegurados).
4. **No colapsar señales a booleanos.** Guardar confianza y evidencia siempre.
5. **No sobrescribir stack cuando cambia.** Registrar en `hotel_events` y marcar `active=false` en el viejo.
6. **No usar LLM como primer filtro.** Reglas primero, LLM solo como verificador para casos ambiguos.
7. **No meter LinkedIn automation y voz en v1.** Cada capa legal requiere su ciclo de validación.
8. **No depender de cuentas personales para scraping.** Cuentas burner + proxies desde el día 1.
9. **No duplicar pipeline con `hotel-scraper/`.** Se archiva y se migra lo reutilizable.

## 13. Anexo: auditoría de `hotel-scraper/`

(Ver §7.2 para tabla resumen.)

Estado: último commit real de datos fue 2025-06-23; codebase dormido desde entonces. ~33,880 hoteles LatAm en CSV, sin DB, sin enriquecimiento. Scrapy spider vacío. Sin LLM. Dedupe básico (`drop_duplicates`).

Plan de migración:

1. Crear `myhotel-labs/workers/tracker/` con estructura de workers Python.
2. Portar módulos alta reutilización (geopoblar, mapbox, crawl_hotel, buscar_urls_hoteles).
3. Importar CSV base a tabla `hotels` con `source=csv_seed_2025_06`.
4. Marcar `hotel-scraper/` como `status=archived` en el portfolio CLAUDE.md raíz.

## 14. Roadmap propuesto

| Fase | Duración estimada | Entregable |
|---|---|---|
| 0 — Setup | 1 semana | Estructura workers, schema DB inicial, seed CSV import |
| 1 — MVP URL + OTAs | 3 semanas | Análisis individual + bulk, UI Search/Bulk/Browse |
| 2 — Discovery geográfico | 3 semanas | Discovery por país/región, dedupe fuzzy, cola enrich |
| 3 — Contactos | 4 semanas | Apollo/Hunter/LinkedIn, validación email, UI contactos |
| 4 — Prospecting + voz | 6+ semanas | Secuencias, agente de voz, handoff humano, CRM sync |

Antes de cada fase: revisión de métricas de la anterior + decisión go/no-go.

## 15. Decisiones cerradas (ex-preguntas abiertas)

1. **CRM destino:** sin CRM en v1-v4. Leads viven en Tracker. Para salida de oportunidades se prototipará notificación a Slack (canal por zona geográfica) y/o creación de deals en HubSpot asignados por owner. Decisión final se toma al llegar a v4 según resultados.
2. **Postura legal:** se difiere la revisión formal. Operativamente se arranca con la postura agresiva descrita en §6, asumiendo el riesgo. Revisitar antes de v3/v4 en producción.
3. **Presupuesto / LLMs:** Gemini vía `GEMINI_API_KEY` como LLM primario para todas las tareas (ver §10.1 para modelos por tarea). Claude/OpenAI como fallback. Presupuesto de APIs externas (Apollo, Hunter, SerpAPI, Vapi) se define caso a caso al activar cada módulo, con tope mensual definido por Andrés.
4. **Clientes actuales:** se marcan vía columna `is_customer` en el CSV que Andrés suba. Ver §9.0.
5. **Ownership:** Andrés es PO + Tech Lead. Claude Code ejecuta implementación.

## 16. Preguntas que permanecen abiertas

Ninguna bloqueante para iniciar v1. Se listan para revisión continua:

- Cola de trabajos: Redis+RQ (Python) vs BullMQ (Node). Decidir en kickoff de v1.
- Estrategia de proxies / rotación de IPs para crawling masivo (ScrapingBee, Bright Data, self-hosted). Evaluar al primer bloqueo.
- Dónde corren los workers Python (mismo host que Next app vs VM separada). Decidir al deployar.
