// Detección determinística de cadena vs hotel independiente.
// Señales combinadas; is_chain es true si al menos UNA fuerte (≥2 propiedades
// enumeradas) o DOS débiles (frases + algún otro hint) se confirman.

export type ChainDetection = {
  is_chain: boolean;
  property_count_estimate: number | null;
  signals: string[];
};

const HOTEL_PATH_RE =
  /\/(hotel|hoteles|hoteis|propiedad|propiedades|property|properties|location|locations|resort|resorts|destination|destinations)\/([a-z0-9][a-z0-9\-._]{1,80})(?:\/|$|\?)/i;

const CHAIN_PHRASE_RES: RegExp[] = [
  /nuestros?\s+hoteles/i,
  /nuestras?\s+propiedades/i,
  /nuestros?\s+resorts/i,
  /hoteles\s+de\s+la\s+cadena/i,
  /nossos\s+hoteis/i,
  /our\s+hotels/i,
  /our\s+properties/i,
  /our\s+resorts/i,
  /our\s+destinations/i,
  /conoce\s+(todos\s+)?nuestros\s+hoteles/i,
  /conoce\s+(todas\s+)?nuestras\s+propiedades/i,
  /ver\s+todos\s+los\s+hoteles/i,
  /(\d{1,3})\s+hoteles\s+(en|de|alrededor)/i,
  /(\d{1,3})\s+properties/i,
];

function uniquePropertyPaths(anchors: { href: string }[]): Set<string> {
  const out = new Set<string>();
  for (const a of anchors) {
    if (!a.href) continue;
    const m = a.href.match(HOTEL_PATH_RE);
    if (m) {
      const slug = m[2].toLowerCase();
      // Skip pagination-like slugs ("page-1", "1", etc.)
      if (/^(page|pag|p)[-_]?\d+$/.test(slug)) continue;
      if (/^\d+$/.test(slug) && slug.length < 3) continue;
      // Skip generic marker slugs
      if (["new", "all", "todos", "ver", "list"].includes(slug)) continue;
      out.add(slug);
    }
  }
  return out;
}

function countJsonLdHotels(html: string): number {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "@graph" in parsed
          ? (parsed as { "@graph": unknown[] })["@graph"]
          : [parsed];
      for (const item of items as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const t = (item as Record<string, unknown>)["@type"];
        const types = Array.isArray(t)
          ? (t as string[])
          : typeof t === "string"
            ? [t]
            : [];
        if (types.some((x) => /^(Hotel|LodgingBusiness|Resort|BedAndBreakfast|Campground|Hostel)$/i.test(x))) {
          count++;
        }
      }
    } catch {
      /* malformed JSON-LD — ignore */
    }
  }
  return count;
}

export function detectChain(args: {
  html: string;
  anchors: { href: string; text: string }[];
}): ChainDetection {
  const signals: string[] = [];
  const propertySlugs = uniquePropertyPaths(args.anchors);
  const jsonLdHotels = countJsonLdHotels(args.html);

  let property_count_estimate = 0;
  if (propertySlugs.size >= 2) {
    signals.push(
      `property_paths:${propertySlugs.size}:${Array.from(propertySlugs).slice(0, 3).join(",")}`
    );
    property_count_estimate = propertySlugs.size;
  }
  if (jsonLdHotels >= 2) {
    signals.push(`jsonld_hotels:${jsonLdHotels}`);
    property_count_estimate = Math.max(property_count_estimate, jsonLdHotels);
  }

  const phraseMatches: string[] = [];
  for (const rx of CHAIN_PHRASE_RES) {
    const m = args.html.match(rx);
    if (m) {
      phraseMatches.push(m[0].slice(0, 60));
      const numMatch = m[1] ? parseInt(m[1], 10) : NaN;
      if (Number.isFinite(numMatch) && numMatch >= 2) {
        property_count_estimate = Math.max(property_count_estimate, numMatch);
      }
    }
  }
  if (phraseMatches.length > 0) {
    signals.push(`phrases:${phraseMatches.length}`);
  }

  // Strong signal: ≥2 enumerable properties.
  // Mid signal: phrase match + JSON-LD with 1 hotel and hotel paths ≥1 (corporate site for small chain).
  const strong = property_count_estimate >= 2;
  const mid =
    phraseMatches.length > 0 &&
    (propertySlugs.size >= 1 || jsonLdHotels >= 1);

  return {
    is_chain: strong || mid,
    property_count_estimate: property_count_estimate || null,
    signals: [...signals, ...phraseMatches.map((p) => `phrase:${p}`)],
  };
}
