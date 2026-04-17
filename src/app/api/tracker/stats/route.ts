import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const [hotels, analyzed, byRole, topDomains, classification, specials] =
      await Promise.all([
        pool.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM tracker_hotels`
        ),
        pool.query<{ analyzed: number }>(
          `SELECT COUNT(DISTINCT hotel_id)::int AS analyzed FROM tracker_hotel_resources`
        ),
        pool.query<{ role: string; hotels_with: number; domains: number }>(
          `SELECT
             role_hint AS role,
             COUNT(DISTINCT hotel_id)::int AS hotels_with,
             COUNT(DISTINCT registrable_domain)::int AS domains
           FROM tracker_hotel_resources
           WHERE role_hint IS NOT NULL
           GROUP BY role_hint
           ORDER BY hotels_with DESC`
        ),
        pool.query<{
          role: string;
          registrable_domain: string;
          hotels: number;
          vendor_name: string | null;
          classified_by: string | null;
        }>(
          `WITH ranked AS (
             SELECT
               r.role_hint AS role,
               r.registrable_domain,
               COUNT(DISTINCT r.hotel_id)::int AS hotels,
               (SELECT vendor_name FROM tracker_resources WHERE registrable_domain = r.registrable_domain) AS vendor_name,
               (SELECT classified_by FROM tracker_resources WHERE registrable_domain = r.registrable_domain) AS classified_by,
               ROW_NUMBER() OVER (
                 PARTITION BY r.role_hint
                 ORDER BY COUNT(DISTINCT r.hotel_id) DESC, r.registrable_domain
               ) AS rn
             FROM tracker_hotel_resources r
             WHERE r.role_hint IS NOT NULL
             GROUP BY r.role_hint, r.registrable_domain
           )
           SELECT role, registrable_domain, hotels, vendor_name, classified_by
           FROM ranked
           WHERE rn <= 10
           ORDER BY role, hotels DESC, registrable_domain`
        ),
        pool.query<{
          total: number;
          classified: number;
          unclassified: number;
        }>(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE classified_by IS NOT NULL)::int AS classified,
             COUNT(*) FILTER (WHERE classified_by IS NULL)::int AS unclassified
           FROM tracker_resources`
        ),
        pool.query<{
          whatsapp: number;
          google_analytics: number;
          meta_pixel: number;
          wordpress: number;
        }>(
          // Penetration signals that often live in inline scripts → use the
          // stack table (populated by rule matches that include `html`
          // signatures) joined with direct domain observations.
          `WITH hotels_whatsapp AS (
             SELECT hotel_id FROM tracker_hotel_stack
             WHERE vendor = 'WhatsApp' AND active = TRUE
             UNION
             SELECT hotel_id FROM tracker_hotel_resources
             WHERE registrable_domain IN ('whatsapp.com','wa.me')
                OR host ~ 'wa\\.me|whatsapp\\.com|api\\.whatsapp'
           ),
           hotels_ga AS (
             SELECT hotel_id FROM tracker_hotel_stack
             WHERE vendor = 'Google' AND category = 'analytics' AND active = TRUE
             UNION
             SELECT hotel_id FROM tracker_hotel_resources
             WHERE registrable_domain IN ('googletagmanager.com','google-analytics.com')
           ),
           hotels_meta AS (
             SELECT hotel_id FROM tracker_hotel_stack
             WHERE vendor = 'Meta' AND active = TRUE
             UNION
             SELECT hotel_id FROM tracker_hotel_resources
             WHERE host ~ 'connect\\.facebook\\.net'
           )
           SELECT
             (SELECT COUNT(*)::int FROM hotels_whatsapp) AS whatsapp,
             (SELECT COUNT(*)::int FROM hotels_ga) AS google_analytics,
             (SELECT COUNT(*)::int FROM hotels_meta) AS meta_pixel,
             0::int AS wordpress`
        ),
      ]);

    const wpRes = await pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT hotel_id)::int AS n
       FROM tracker_hotel_stack
       WHERE vendor = 'WordPress' AND active = TRUE`
    );

    const hotelsTotal = hotels.rows[0].total;
    const hotelsAnalyzed = analyzed.rows[0].analyzed;

    // Incluye sólo agencias sin verificar OR verificadas como "agency".
    // "platform" / "noise" se filtran (noise también se borra).
    const agenciesRes = await pool.query<{
      agency_name: string;
      agency_url: string | null;
      hotels: number;
      verified: number;
    }>(
      `SELECT
         agency_name,
         MIN(agency_url) AS agency_url,
         COUNT(DISTINCT hotel_id)::int AS hotels,
         COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::int AS verified
       FROM tracker_hotel_agency
       WHERE llm_verdict IS NULL OR llm_verdict = 'agency'
       GROUP BY agency_name
       ORDER BY hotels DESC, agency_name
       LIMIT 20`
    );

    const agencyVerifyPending = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM tracker_hotel_agency WHERE verified_at IS NULL`
    );

    const otasRes = await pool.query<{ ota: string; hotels: number }>(
      `SELECT ota, COUNT(DISTINCT hotel_id)::int AS hotels
       FROM tracker_hotel_ota_presence
       GROUP BY ota
       ORDER BY hotels DESC`
    );

    const chainsRes = await pool.query<{
      chains: number;
      independents: number;
      unknown: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_chain = TRUE)::int AS chains,
         COUNT(*) FILTER (WHERE is_chain = FALSE)::int AS independents,
         COUNT(*) FILTER (WHERE is_chain IS NULL)::int AS unknown
       FROM tracker_hotels
       WHERE id IN (SELECT DISTINCT hotel_id FROM tracker_hotel_resources)`
    );

    // Group topDomains by role
    const topByRole = new Map<
      string,
      {
        registrable_domain: string;
        hotels: number;
        pct_of_analyzed: number;
        vendor_name: string | null;
        classified_by: string | null;
      }[]
    >();
    for (const row of topDomains.rows) {
      const arr = topByRole.get(row.role) || [];
      arr.push({
        registrable_domain: row.registrable_domain,
        hotels: row.hotels,
        pct_of_analyzed:
          hotelsAnalyzed > 0 ? row.hotels / hotelsAnalyzed : 0,
        vendor_name: row.vendor_name,
        classified_by: row.classified_by,
      });
      topByRole.set(row.role, arr);
    }

    const roles = byRole.rows.map((r) => ({
      role: r.role,
      hotels_with: r.hotels_with,
      pct_of_analyzed:
        hotelsAnalyzed > 0 ? r.hotels_with / hotelsAnalyzed : 0,
      domains: r.domains,
      top: topByRole.get(r.role) || [],
    }));

    const s = specials.rows[0];
    const penetration = [
      {
        key: "whatsapp",
        label: "WhatsApp click-to-chat",
        hotels: s.whatsapp,
        pct: hotelsAnalyzed > 0 ? s.whatsapp / hotelsAnalyzed : 0,
      },
      {
        key: "google_analytics",
        label: "Google Analytics / GTM",
        hotels: s.google_analytics,
        pct:
          hotelsAnalyzed > 0 ? s.google_analytics / hotelsAnalyzed : 0,
      },
      {
        key: "meta_pixel",
        label: "Meta Pixel",
        hotels: s.meta_pixel,
        pct: hotelsAnalyzed > 0 ? s.meta_pixel / hotelsAnalyzed : 0,
      },
      {
        key: "wordpress",
        label: "WordPress",
        hotels: wpRes.rows[0].n,
        pct:
          hotelsAnalyzed > 0 ? wpRes.rows[0].n / hotelsAnalyzed : 0,
      },
    ];

    const chainStats = chainsRes.rows[0];
    const chainKnown = chainStats.chains + chainStats.independents;
    return NextResponse.json({
      hotels: {
        total: hotelsTotal,
        analyzed: hotelsAnalyzed,
        analyzed_pct: hotelsTotal > 0 ? hotelsAnalyzed / hotelsTotal : 0,
      },
      chains: {
        chains: chainStats.chains,
        independents: chainStats.independents,
        unknown: chainStats.unknown,
        chain_pct: chainKnown > 0 ? chainStats.chains / chainKnown : 0,
      },
      agencies: agenciesRes.rows,
      agencies_pending_verify: agencyVerifyPending.rows[0].n,
      otas: otasRes.rows.map((r) => ({
        ota: r.ota,
        hotels: r.hotels,
        pct_of_analyzed:
          hotelsAnalyzed > 0 ? r.hotels / hotelsAnalyzed : 0,
      })),
      roles,
      classification: classification.rows[0],
      penetration,
    });
  } catch (err) {
    console.error("[Tracker Stats GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
