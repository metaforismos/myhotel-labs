import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  classifyDomain,
  type DomainEvidence,
  type LlmClassification,
} from "@/lib/tracker/llm-classifier";
import { prelinkDomain } from "@/lib/tracker/vendor-prelinker";

export const maxDuration = 120;

async function gatherEvidence(
  registrable_domain: string
): Promise<DomainEvidence | null> {
  const rows = await pool.query<{
    host: string;
    contexts: { type: string; url: string; snippet?: string }[];
    canonical_name: string;
  }>(
    `SELECT r.host, r.contexts, h.canonical_name
     FROM tracker_hotel_resources r
     JOIN tracker_hotels h ON h.id = r.hotel_id
     WHERE r.registrable_domain = $1
     ORDER BY r.last_seen_at DESC
     LIMIT 10`,
    [registrable_domain]
  );

  if (rows.rowCount === 0) return null;

  const hosts = Array.from(new Set(rows.rows.map((r) => r.host)));
  const sample_hotel_names = Array.from(
    new Set(rows.rows.map((r) => r.canonical_name).filter(Boolean))
  ).slice(0, 5);

  const sample_contexts: DomainEvidence["sample_contexts"] = [];
  for (const r of rows.rows) {
    for (const c of r.contexts || []) {
      sample_contexts.push({
        host: r.host,
        type: c.type,
        url: c.url,
        snippet: c.snippet,
      });
      if (sample_contexts.length >= 15) break;
    }
    if (sample_contexts.length >= 15) break;
  }

  const agg = await pool.query<{
    observed_hotels: number;
    observed_contexts: number;
  }>(
    `SELECT observed_hotels, observed_contexts
     FROM tracker_resources
     WHERE registrable_domain = $1`,
    [registrable_domain]
  );

  return {
    registrable_domain,
    hosts,
    observed_hotels: agg.rows[0]?.observed_hotels ?? rows.rowCount,
    observed_contexts:
      agg.rows[0]?.observed_contexts ?? sample_contexts.length,
    sample_contexts,
    sample_hotel_names,
  };
}

async function persistClassification(
  registrable_domain: string,
  c: LlmClassification,
  source: "llm" | "rule" = "llm"
) {
  await pool.query(
    `UPDATE tracker_resources
     SET primary_role = $2,
         vendor_name = COALESCE($3::text, vendor_name),
         vendor_product = COALESCE($4::text, vendor_product),
         classified_by = $6,
         classified_at = NOW(),
         classification_notes = $5::text,
         last_seen_at = NOW()
     WHERE registrable_domain = $1`,
    [
      registrable_domain,
      c.role,
      c.vendor_name,
      c.vendor_product,
      c.reasoning
        ? `${c.reasoning} (confidence=${c.confidence.toFixed(2)})`
        : `confidence=${c.confidence.toFixed(2)}`,
      source,
    ]
  );

  // Back-propagate role_hint a tracker_hotel_resources. Dos niveles:
  //   - Confianza ≥0.6: sólo sobrescribimos 'unknown' y 'other' (caso base).
  //   - Confianza ≥0.85: sobrescribimos cualquier rol heurístico previo.
  //     Esto corrige casos como tambourine.com (heurística: cdn.*  → cdn)
  //     que en realidad es una plataforma CMS para hoteles; el LLM
  //     con alta confianza vale más que la heurística de subdomain.
  if (c.confidence >= 0.85) {
    await pool.query(
      `UPDATE tracker_hotel_resources
       SET role_hint = $2
       WHERE registrable_domain = $1`,
      [registrable_domain, c.role]
    );
  } else if (c.confidence >= 0.6) {
    await pool.query(
      `UPDATE tracker_hotel_resources
       SET role_hint = $2
       WHERE registrable_domain = $1 AND role_hint IN ('unknown', 'other')`,
      [registrable_domain, c.role]
    );
  }
}

async function classifyOne(registrable_domain: string) {
  // Tier-0 pre-linker: curated regex table of well-known vendor families
  // (Google, Cloudflare, AWS, WhatsApp, OTAs…). If it hits we skip the
  // LLM entirely and persist as classified_by='rule'. Saves tokens and
  // produces consistent canonical names across domain variants.
  const prelinked = prelinkDomain(registrable_domain);
  if (prelinked) {
    await persistClassification(
      registrable_domain,
      {
        role: prelinked.role,
        vendor_name: prelinked.vendor_name,
        vendor_product: prelinked.vendor_product,
        confidence: prelinked.confidence,
        reasoning: prelinked.reasoning,
      },
      "rule"
    );
    return {
      registrable_domain,
      classification: prelinked,
      prelinked: true,
    };
  }

  const evidence = await gatherEvidence(registrable_domain);
  if (!evidence) {
    return { registrable_domain, error: "no_evidence" };
  }
  try {
    const classification = await classifyDomain(evidence);
    await persistClassification(registrable_domain, classification);
    return { registrable_domain, classification };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[tracker.classify] ${registrable_domain} failed: ${msg}`
    );
    return { registrable_domain, error: msg };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

export async function POST(request: NextRequest) {
  let body: {
    registrable_domain?: string;
    batch?: boolean;
    min_hotels?: number;
    limit?: number;
    reclassify?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty body = default batch */
  }

  // Single-domain mode
  if (body.registrable_domain) {
    const result = await classifyOne(body.registrable_domain);
    return NextResponse.json(result);
  }

  // Batch mode — limit conservador para evitar 502 cuando hay varios
  // batches auto-classify corriendo en paralelo + rate-limit de Gemini.
  const minHotels = Math.max(1, body.min_hotels ?? 1);
  const limit = Math.max(1, Math.min(30, body.limit ?? 15));

  const whereClassified = body.reclassify
    ? "TRUE"
    : "classified_by IS NULL";

  const candidates = await pool.query<{ registrable_domain: string }>(
    `SELECT registrable_domain
     FROM tracker_resources
     WHERE observed_hotels >= $1 AND ${whereClassified}
     ORDER BY observed_hotels DESC, registrable_domain
     LIMIT $2`,
    [minHotels, limit]
  );

  const started = Date.now();
  // Concurrencia 2 en vez de 3: Gemini Flash en prod bajo carga
  // (varios batches auto-classify al mismo tiempo) devolvía 502
  // cuando saturábamos con 3.
  const results = await runWithConcurrency(
    candidates.rows.map((r) => r.registrable_domain),
    2,
    (d) => classifyOne(d)
  );
  const duration_ms = Date.now() - started;

  const summary = {
    processed: results.length,
    succeeded: results.filter((r) => "classification" in r).length,
    failed: results.filter((r) => "error" in r).length,
    duration_ms,
    results,
  };

  return NextResponse.json(summary);
}
