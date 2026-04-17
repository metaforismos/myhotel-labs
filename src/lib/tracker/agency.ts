// Detección determinística de la agencia web que administra el sitio.
// Busca frases tipo "powered by / hecho por / desarrollado por / designed
// by" y extrae el nombre + URL de la agencia cuando hay un anchor asociado.

import type { AgencyInfo } from "./types";

// Ordenadas por especificidad — la más específica primero gana si hay
// múltiples matches. Cada regex captura el segmento que sigue a la frase.
const AGENCY_PHRASES: RegExp[] = [
  /powered\s+by\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /desarrollad[oa]\s+por\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /hecho\s+por\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /con\s+la\s+tecnolog[ií]a\s+de\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /dise[ñn]ad[oa]\s+por\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /designed\s+by\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /site\s+by\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /creado\s+por\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /desarrollo\s+web\s*[:\-]?\s*([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /web\s+design\s*[:\-]?\s*([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
  /realiza(?:do|zione)\s+d[ae]\s+([\s\S]{0,400}?)(?=<\/(?:p|div|footer|span|li|small|section)>|$)/i,
];

const EXCLUDED_NAMES = new Set([
  "html",
  "wordpress",
  "shopify",
  "wix",
  "squarespace",
  "webflow",
  "drupal",
  "joomla",
]);

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstAnchor(
  html: string,
  baseHost: string
): { name: string | null; url: string | null } {
  const m = html.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/i);
  if (!m) return { name: null, url: null };
  const href = m[1];
  const text = stripTags(m[2]);
  try {
    const u = new URL(href, `https://${baseHost || "example.com"}`);
    // Excluimos anchors del propio hotel (links a secciones internas).
    if (u.hostname === baseHost) return { name: text || null, url: null };
    // Excluimos redes sociales y plataformas genéricas que se cuelan como
    // "powered by" (ej. "powered by Shopify" donde el link va a shopify.com
    // — no es la agencia, es la plataforma).
    if (/facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|pinterest/i.test(
      u.hostname
    )) {
      return { name: text || null, url: null };
    }
    return {
      name: text || null,
      url: u.toString(),
    };
  } catch {
    return { name: text || null, url: null };
  }
}

export function detectAgency(
  html: string,
  baseHost: string
): AgencyInfo | null {
  // Sólo miramos la mitad inferior del HTML — las menciones de agencia
  // suelen estar en el footer. Acota el costo y reduce falsos positivos
  // (ej. "designed by our team" en el body).
  const lowerHalf = html.slice(Math.floor(html.length * 0.5));
  const candidates: {
    phrase: string;
    name: string;
    url: string | null;
    confidence: number;
    source: string;
  }[] = [];

  for (const rx of AGENCY_PHRASES) {
    const match = rx.exec(lowerHalf);
    if (!match) continue;

    const raw = match[1] || "";
    const { name: anchorText, url } = extractFirstAnchor(raw, baseHost);

    const fallbackText = stripTags(raw)
      .replace(/^[\s\-–—:.]+/, "")
      .split(/[\.\|,;]/)[0]
      .trim();
    const name = (anchorText || fallbackText).slice(0, 80);

    if (!name || name.length < 3) continue;
    if (EXCLUDED_NAMES.has(name.toLowerCase())) continue;
    if (/^(the|a|la|el)\s/i.test(name) && !url) continue;

    candidates.push({
      phrase: match[0].slice(0, 120).replace(/\s+/g, " "),
      name,
      url,
      confidence: url ? 0.9 : 0.6,
      source: rx.source.split("\\s+")[0],
    });
  }

  if (!candidates.length) return null;

  // Preferimos candidatos con URL (mejor evidencia y dato más útil).
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  return {
    name: best.name,
    url: best.url,
    phrase: best.phrase,
    confidence: best.confidence,
  };
}
