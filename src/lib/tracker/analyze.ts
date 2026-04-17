import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { detect } from "./detector";
import { canonicalizeUrl, fetchHtml, normalizeUrl } from "./fetcher";
import { extractOtaPresence } from "./ota";
import type { AnalyzeResult, RawResource, ResourceRole } from "./types";

export type AnalyzePrefill = {
  external_id?: string;
  canonical_name?: string;
  country?: string;
  region?: string;
  city?: string;
  is_customer?: boolean;
};

export type AnalyzeOptions = {
  url: string;
  save?: boolean;
  hotel_id?: string | null;
  prefill?: AnalyzePrefill;
  timeoutMs?: number;
};

export type AnalyzeOk = AnalyzeResult & {
  ok: true;
  insecure_tls?: boolean;
  rendered_via_browser?: boolean;
  persisted?: { hotel_id: string; created: boolean } | null;
};

export type AnalyzeErr = {
  ok: false;
  url: string;
  error: string;
  error_code?: string | null;
  status?: number | null;
  duration_ms: number;
};

async function resolveHotel(
  client: PoolClient,
  args: {
    final_url: string;
    title: string | null;
    explicit_hotel_id?: string | null;
    prefill?: AnalyzePrefill;
  }
): Promise<{ hotel_id: string; created: boolean }> {
  const { final_url, title, explicit_hotel_id, prefill } = args;
  if (explicit_hotel_id) {
    return { hotel_id: explicit_hotel_id, created: false };
  }

  // Cascade de identificación (ver PRD §8 + identifier scheme 1D.9):
  //   1. external_id (si viene del prefill)
  //   2. website_url_canonical (dedup por sitio oficial)
  //   3. tracker_hotel_urls.url exacta (re-análisis del mismo link)
  //   4. crear nuevo
  if (prefill?.external_id) {
    const byExt = await client.query<{ id: string }>(
      `SELECT id FROM tracker_hotels WHERE external_id = $1 LIMIT 1`,
      [prefill.external_id]
    );
    if (byExt.rowCount) {
      return { hotel_id: byExt.rows[0].id, created: false };
    }
  }

  const canonicalUrl = canonicalizeUrl(final_url);
  if (canonicalUrl) {
    const byCanonical = await client.query<{ id: string }>(
      `SELECT id FROM tracker_hotels WHERE website_url_canonical = $1 LIMIT 1`,
      [canonicalUrl]
    );
    if (byCanonical.rowCount) {
      return { hotel_id: byCanonical.rows[0].id, created: false };
    }
  }

  const byUrl = await client.query<{ hotel_id: string }>(
    `SELECT hotel_id FROM tracker_hotel_urls WHERE url = $1 LIMIT 1`,
    [final_url]
  );
  if (byUrl.rowCount) {
    return { hotel_id: byUrl.rows[0].hotel_id, created: false };
  }

  const hostHint = (() => {
    try {
      return new URL(final_url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  const canonical = (
    prefill?.canonical_name ||
    title ||
    hostHint ||
    final_url
  ).slice(0, 300);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO tracker_hotels (canonical_name, website_url, website_url_canonical, country, region, city, is_customer, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      canonical,
      final_url,
      canonicalUrl,
      prefill?.country ?? null,
      prefill?.region ?? null,
      prefill?.city ?? null,
      prefill?.is_customer ?? false,
      prefill?.external_id ?? null,
    ]
  );
  return { hotel_id: ins.rows[0].id, created: true };
}

async function persistAnalysis(
  result: AnalyzeOk,
  options: {
    explicit_hotel_id?: string | null;
    prefill?: AnalyzePrefill;
  }
): Promise<{ hotel_id: string; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { hotel_id, created } = await resolveHotel(client, {
      final_url: result.final_url,
      title: result.title,
      explicit_hotel_id: options.explicit_hotel_id ?? null,
      prefill: options.prefill,
    });

    await client.query(
      `INSERT INTO tracker_hotel_urls (hotel_id, url, kind, verified_at, confidence)
       VALUES ($1, $2, 'official', NOW(), 0.8)
       ON CONFLICT (hotel_id, url) DO UPDATE SET verified_at = NOW()`,
      [hotel_id, result.final_url]
    );

    // Apply prefill updates (is_customer, canonical_name if new, etc.)
    const chainPayload = JSON.stringify({
      signals: result.chain.signals,
      detected_at: new Date().toISOString(),
    });

    const canonicalForUpdate = canonicalizeUrl(result.final_url);

    if (created) {
      await client.query(
        `UPDATE tracker_hotels
         SET website_url = COALESCE(website_url, $2),
             website_url_canonical = COALESCE(website_url_canonical, $6),
             is_chain = $3,
             property_count_estimate = $4,
             chain_signals = $5::jsonb,
             last_enriched_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [
          hotel_id,
          result.final_url,
          result.chain.is_chain,
          result.chain.property_count_estimate,
          chainPayload,
          canonicalForUpdate,
        ]
      );
    } else {
      await client.query(
        `UPDATE tracker_hotels
         SET is_chain = $2,
             property_count_estimate = $3,
             chain_signals = $4::jsonb,
             website_url = COALESCE(website_url, $5),
             website_url_canonical = COALESCE(website_url_canonical, $6),
             last_enriched_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [
          hotel_id,
          result.chain.is_chain,
          result.chain.property_count_estimate,
          chainPayload,
          result.final_url,
          canonicalForUpdate,
        ]
      );
      if (typeof options.prefill?.is_customer === "boolean") {
        await client.query(
          `UPDATE tracker_hotels SET is_customer = $2 WHERE id = $1 AND is_customer <> $2`,
          [hotel_id, options.prefill.is_customer]
        );
      }
    }

    for (const d of result.detections) {
      const prev = await client.query<{ id: string }>(
        `SELECT id FROM tracker_hotel_stack
         WHERE hotel_id = $1 AND category = $2 AND vendor = $3 AND active = TRUE`,
        [hotel_id, d.category, d.vendor]
      );
      if (prev.rowCount) {
        await client.query(
          `UPDATE tracker_hotel_stack
           SET product = $2, confidence = $3, evidence_url = $4,
               evidence = $5::jsonb, detected_via = $6, last_seen_at = NOW()
           WHERE id = $1`,
          [
            prev.rows[0].id,
            d.product,
            d.confidence,
            result.final_url,
            JSON.stringify(d.evidence),
            d.detected_via,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO tracker_hotel_stack
             (hotel_id, category, vendor, product, detected_via, evidence_url, evidence, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            hotel_id,
            d.category,
            d.vendor,
            d.product,
            d.detected_via,
            result.final_url,
            JSON.stringify(d.evidence),
            d.confidence,
          ]
        );
      }
    }

    // Persist OTA presence derived from outbound links.
    const otaPresence = extractOtaPresence(result.outbound_links || []);
    for (const ota of otaPresence) {
      await client.query(
        `INSERT INTO tracker_hotel_ota_presence
           (hotel_id, ota, profile_url, confidence, verified_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (hotel_id, ota) DO UPDATE SET
           profile_url = EXCLUDED.profile_url,
           confidence = GREATEST(tracker_hotel_ota_presence.confidence, EXCLUDED.confidence),
           verified_at = NOW()`,
        [hotel_id, ota.ota, ota.profile_url, ota.confidence]
      );
    }

    if (result.agency) {
      await client.query(
        `INSERT INTO tracker_hotel_agency
           (hotel_id, agency_name, agency_url, evidence, confidence)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (hotel_id, agency_name) DO UPDATE SET
           agency_url = COALESCE(EXCLUDED.agency_url, tracker_hotel_agency.agency_url),
           evidence = EXCLUDED.evidence,
           confidence = GREATEST(EXCLUDED.confidence, tracker_hotel_agency.confidence)`,
        [
          hotel_id,
          result.agency.name.slice(0, 160),
          result.agency.url,
          JSON.stringify({
            phrase: result.agency.phrase,
            source_url: result.final_url,
            detected_at: new Date().toISOString(),
          }),
          result.agency.confidence,
        ]
      );
    }

    await client.query(
      `INSERT INTO tracker_hotel_events (hotel_id, event_type, payload)
       VALUES ($1, 'analyze', $2::jsonb)`,
      [
        hotel_id,
        JSON.stringify({
          url: result.final_url,
          detections_count: result.detections.length,
          resources_count: result.resources.length,
          duration_ms: result.duration_ms,
          insecure_tls: result.insecure_tls ?? false,
        }),
      ]
    );

    await client.query(
      `INSERT INTO tracker_hotel_sources (hotel_id, source, raw)
       VALUES ($1, 'rule_analyzer_v1', $2::jsonb)`,
      [
        hotel_id,
        JSON.stringify({
          url: result.url,
          final_url: result.final_url,
          status: result.status,
          title: result.title,
          meta_generator: result.meta_generator,
          detections: result.detections,
          resources: result.resources.map((r) => ({
            host: r.host,
            registrable_domain: r.registrable_domain,
            role_hint: r.role_hint,
          })),
        }),
      ]
    );

    const touchedDomains = new Set<string>();
    for (const r of result.resources) {
      touchedDomains.add(r.registrable_domain);
      await client.query(
        `INSERT INTO tracker_hotel_resources
           (hotel_id, host, registrable_domain, contexts, role_hint, analysis_url)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (hotel_id, host) DO UPDATE SET
           contexts = EXCLUDED.contexts,
           registrable_domain = EXCLUDED.registrable_domain,
           role_hint = EXCLUDED.role_hint,
           analysis_url = EXCLUDED.analysis_url,
           last_seen_at = NOW()`,
        [
          hotel_id,
          r.host,
          r.registrable_domain,
          JSON.stringify(r.contexts),
          r.role_hint,
          result.final_url,
        ]
      );
    }

    for (const domain of touchedDomains) {
      await client.query(
        `WITH agg AS (
           SELECT
             COUNT(DISTINCT hotel_id)::int AS observed_hotels,
             COUNT(*)::int AS observed_contexts,
             mode() WITHIN GROUP (ORDER BY role_hint) AS primary_role
           FROM tracker_hotel_resources
           WHERE registrable_domain = $1
         )
         INSERT INTO tracker_resources
           (registrable_domain, primary_role, observed_hotels, observed_contexts,
            vendor_name, vendor_product, classified_by, classified_at, last_seen_at)
         SELECT
           $1, agg.primary_role, agg.observed_hotels, agg.observed_contexts,
           $2::text, $3::text,
           CASE WHEN $2::text IS NOT NULL THEN 'rule' END,
           CASE WHEN $2::text IS NOT NULL THEN NOW() END,
           NOW()
         FROM agg
         ON CONFLICT (registrable_domain) DO UPDATE SET
           primary_role = EXCLUDED.primary_role,
           observed_hotels = EXCLUDED.observed_hotels,
           observed_contexts = EXCLUDED.observed_contexts,
           vendor_name = COALESCE(tracker_resources.vendor_name, EXCLUDED.vendor_name),
           vendor_product = COALESCE(tracker_resources.vendor_product, EXCLUDED.vendor_product),
           classified_by = COALESCE(tracker_resources.classified_by, EXCLUDED.classified_by),
           classified_at = COALESCE(tracker_resources.classified_at, EXCLUDED.classified_at),
           last_seen_at = NOW()`,
        [
          domain,
          result.resources.find(
            (r) => r.registrable_domain === domain && r.vendor_name
          )?.vendor_name || null,
          result.resources.find(
            (r) => r.registrable_domain === domain && r.vendor_product
          )?.vendor_product || null,
        ]
      );
    }

    await client.query("COMMIT");
    return { hotel_id, created };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Enriquece los recursos extraídos del HTML con vendor_name / vendor_product /
 * role (override) desde el catálogo global (tracker_resources). Esto permite
 * que una clasificación LLM previa se refleje automáticamente en nuevos
 * análisis sin requerir re-match de reglas.
 */
async function enrichResourcesWithCatalog(
  resources: RawResource[]
): Promise<RawResource[]> {
  if (resources.length === 0) return resources;
  const domains = Array.from(
    new Set(resources.map((r) => r.registrable_domain))
  );
  const res = await pool.query<{
    registrable_domain: string;
    vendor_name: string | null;
    vendor_product: string | null;
    primary_role: string | null;
    classified_by: string | null;
  }>(
    `SELECT registrable_domain, vendor_name, vendor_product, primary_role, classified_by
     FROM tracker_resources
     WHERE registrable_domain = ANY($1::text[])`,
    [domains]
  );
  const byDomain = new Map(res.rows.map((r) => [r.registrable_domain, r]));
  return resources.map((r) => {
    const cat = byDomain.get(r.registrable_domain);
    if (!cat) return r;
    // Si el LLM ya clasificó con rol distinto, confiamos en el catálogo.
    const role_hint =
      cat.primary_role && cat.classified_by === "llm"
        ? (cat.primary_role as ResourceRole)
        : r.role_hint;
    return {
      ...r,
      role_hint,
      vendor_name: r.vendor_name || cat.vendor_name || null,
      vendor_product: r.vendor_product || cat.vendor_product || null,
      classified_by:
        r.classified_by ||
        (cat.classified_by === "rule"
          ? "rule"
          : cat.classified_by === null
            ? null
            : null),
    };
  });
}

export async function analyzeUrl(
  options: AnalyzeOptions
): Promise<AnalyzeOk | AnalyzeErr> {
  const url = normalizeUrl(options.url);
  if (!url) {
    return {
      ok: false,
      url: options.url,
      error: "invalid_url",
      duration_ms: 0,
    };
  }

  const fetched = await fetchHtml(url, {
    timeoutMs: options.timeoutMs ?? 15000,
  });
  if (!fetched.ok) {
    return {
      ok: false,
      url,
      error: fetched.error,
      error_code: fetched.error_code ?? null,
      status: fetched.status ?? null,
      duration_ms: fetched.duration_ms,
    };
  }

  const parsed = detect(fetched.html, fetched.final_url);
  parsed.resources = await enrichResourcesWithCatalog(parsed.resources);
  const result: AnalyzeOk = {
    ok: true,
    url,
    fetched_at: new Date().toISOString(),
    duration_ms: fetched.duration_ms,
    status: fetched.status,
    insecure_tls: fetched.insecure_tls,
    rendered_via_browser: fetched.rendered_via_browser,
    ...parsed,
  };

  if (options.save) {
    try {
      result.persisted = await persistAnalysis(result, {
        explicit_hotel_id: options.hotel_id ?? null,
        prefill: options.prefill,
      });
    } catch (err) {
      console.error("[tracker.analyze]", err);
      return {
        ok: false,
        url,
        error:
          err instanceof Error ? `persist: ${err.message}` : "persist_error",
        status: fetched.status,
        duration_ms: fetched.duration_ms,
      };
    }
  }

  return result;
}
