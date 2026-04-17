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

// Hosts de plataformas conocidas. Si el anchor de la frase "created by /
// powered by" apunta a uno de estos dominios (o subdominio), el candidato
// NO es una agencia web — es la plataforma/CMS/booking engine detrás del
// sitio. Ej: "Canvas" con href=siteminder.com/canvas es SiteMinder, no una
// agencia llamada Canvas.
const PLATFORM_HOSTS = new Set([
  "siteminder.com",
  "cloudbeds.com",
  "mews.com",
  "profitroom.com",
  "profitroom.pl",
  "hotetec.com",
  "d-edge.com",
  "availpro.com",
  "synxis.com",
  "ihotelier.com",
  "travelclick.com",
  "amadeus-hospitality.com",
  "sabrehospitality.com",
  "littlehotelier.com",
  "guestline.com",
  "hotelrunner.com",
  "omnibees.com",
  "roomcloud.net",
  "asksuite.com",
  "bookingcore.com",
  "wordpress.com",
  "wordpress.org",
  "wix.com",
  "squarespace.com",
  "webflow.com",
  "shopify.com",
  "blogger.com",
  "blogspot.com",
  "google.com",
  "litespeedtech.com",
  "litespeed.com",
  "godaddy.com",
  "wpengine.com",
]);

// Plataformas / CMS / booking engines / themes. "Powered by X" donde X
// matchea estos NO es una agencia — es un reconocimiento de plataforma.
// Se puede usar como signal extra para la categoría respectiva, pero no
// contamina el catálogo de agencias.
const PLATFORM_BLACKLIST = new Set([
  // CMS / site builders
  "wordpress",
  "wordpress.org",
  "wordpress.com",
  "wix",
  "wix.com",
  "squarespace",
  "webflow",
  "shopify",
  "drupal",
  "joomla",
  "ghost",
  "contentful",
  "strapi",
  // WordPress themes / plugins (aparecen como "powered by" en muchos sitios)
  "elegant themes",
  "divi",
  "elementor",
  "wpbakery",
  "oxygen",
  "astra",
  "ocean wp",
  "oceanwp",
  "generatepress",
  "ultimatelysocial",
  "jetpack",
  "yoast",
  "woocommerce",
  "contact form 7",
  "wp rocket",
  "wpforms",
  // Hotel-specific platforms (booking engines, PMS, channel mgr)
  "cloudbeds",
  "siteminder",
  "mews",
  "asksuite",
  "synxis",
  "sabre",
  "opera",
  "oracle hospitality",
  "little hotelier",
  "guestline",
  "omnibees",
  "hotetec",
  "availpro",
  "d-edge",
  "profitroom",
  "travelclick",
  "ihotelier",
  "roomcloud",
  "vertical booking",
  "pegasus",
  "tambourine",
  "umi",
  "bookingcore",
  "fnsbooking",
  "canvas",
  "siteminder canvas",
  "blogger",
  "blogspot",
  "litespeed",
  "litespeed web server",
  "litespeed technologies",
  "litespeed technologies inc",
  "please be advised that litespeed technologies inc",
  // Generic noise
  "html",
  "html5",
  "css3",
  "bootstrap",
  "jquery",
  "fontawesome",
  "google",
  "facebook",
]);

// Stop words y fragmentos que no son nombres de agencia.
const STOPWORD_NAMES = new Set([
  "por",
  "de",
  "the",
  "a",
  "an",
  "la",
  "el",
  "los",
  "las",
  "and",
  "y",
  "para",
  "with",
  "con",
  "our",
  "we",
  "us",
  "team",
  "staff",
  "services on your own",
  "services",
  "all rights reserved",
  "copyright",
]);

function stripTags(s: string): string {
  // Strip tags completos (incluyendo multilínea con atributos tipo
  // onerror="handleImageLoadError(this)" height="32").
  return s
    .replace(/<\/?[a-z][\s\S]*?>/gi, " ") // cualquier tag abierto/cerrado/self-closed
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function hostIsPlatform(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (PLATFORM_HOSTS.has(host)) return true;
  for (const p of PLATFORM_HOSTS) {
    if (host.endsWith("." + p)) return true;
  }
  return false;
}

function extractFirstAnchor(
  html: string,
  baseHost: string
): { name: string | null; url: string | null; isPlatform: boolean } {
  const m = html.match(
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/i
  );
  if (!m) return { name: null, url: null, isPlatform: false };
  const href = m[1];
  const text = stripTags(m[2]);
  // Mailto links: el target no es una agencia web, es un email del
  // contacto/staff del propio hotel. Descartar.
  if (/^mailto:/i.test(href)) return { name: null, url: null, isPlatform: false };
  if (/^tel:|^javascript:/i.test(href))
    return { name: null, url: null, isPlatform: false };
  try {
    const u = new URL(href, `https://${baseHost || "example.com"}`);
    // Excluimos anchors del propio hotel (links a secciones internas).
    if (u.hostname === baseHost)
      return { name: text || null, url: null, isPlatform: false };
    // Excluimos redes sociales — "powered by" que linkea a FB o IG es ruido.
    if (
      /facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|pinterest/i.test(
        u.hostname
      )
    ) {
      return { name: text || null, url: null, isPlatform: false };
    }
    // Si el link apunta a un host de plataforma/CMS/BE conocido, el
    // "powered by X" es reconocimiento de producto, no agencia.
    if (hostIsPlatform(u.hostname)) {
      return { name: text || null, url: null, isPlatform: true };
    }
    return {
      name: text || null,
      url: u.toString(),
      isPlatform: false,
    };
  } catch {
    return { name: text || null, url: null, isPlatform: false };
  }
}

function cleanCandidateName(raw: string): string | null {
  let name = stripTags(raw)
    .replace(/^[\s\-–—:.·•|]+/, "")
    .replace(/[\s\-–—:.·•|]+$/, "")
    .split(/[\.\|·•]/)[0]
    .trim();

  // Cortar en coma si queda texto accesorio después.
  if (name.includes(",")) name = name.split(",")[0].trim();

  if (!name) return null;
  // Rechazar emails, URLs crudas, y fragmentos de atributos HTML.
  if (EMAIL_RE.test(name)) return null;
  if (/^https?:\/\//i.test(name)) return null;
  if (/["'=<>]/.test(name)) return null;
  if (/\bonerror=|onclick=|onload=/i.test(name)) return null;

  // Longitud + estructura: al menos una palabra de ≥3 chars.
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const hasSubstantiveWord = words.some((w) => w.length >= 3);
  if (!hasSubstantiveWord) return null;

  // Rechazar stop words y frases genéricas.
  if (STOPWORD_NAMES.has(name.toLowerCase())) return null;
  const firstWord = words[0].toLowerCase();
  if (words.length === 1 && STOPWORD_NAMES.has(firstWord)) return null;

  return name.slice(0, 80);
}

function isPlatform(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (PLATFORM_BLACKLIST.has(n)) return true;
  // Match por prefijo cuando el nombre trae sufijos tipo "WordPress.com"
  for (const p of PLATFORM_BLACKLIST) {
    if (n === p) return true;
    if (n.startsWith(p + " ") || n.startsWith(p + ".")) return true;
  }
  return false;
}

export function detectAgency(
  html: string,
  baseHost: string
): AgencyInfo | null {
  // Sólo miramos el tercio inferior del HTML — las menciones de agencia
  // viven en el footer. Acota el costo y reduce falsos positivos
  // (ej. "designed by our team" en el body, "services on your own" que
  // aparecía al capturar frases de contenido).
  const lowerSlice = html.slice(Math.floor(html.length * 0.66));
  const candidates: {
    phrase: string;
    name: string;
    url: string | null;
    confidence: number;
  }[] = [];

  for (const rx of AGENCY_PHRASES) {
    const match = rx.exec(lowerSlice);
    if (!match) continue;

    const raw = match[1] || "";
    const { name: anchorText, url, isPlatform: anchorIsPlatform } =
      extractFirstAnchor(raw, baseHost);

    // Si el anchor apunta a un host de plataforma conocido, tirar el
    // candidato entero — no importa cómo se llame el texto ("Canvas",
    // "Powered by ...") ni lo limpio que esté. Es reconocimiento de
    // plataforma, no agencia.
    if (anchorIsPlatform) continue;

    // Candidato "desde anchor" siempre que el texto limpie OK. Si no hay
    // anchor, intentamos con el texto plano (pero con confianza menor).
    const anchorCleaned = anchorText ? cleanCandidateName(anchorText) : null;
    const rawCleaned = cleanCandidateName(raw);
    const name = anchorCleaned || rawCleaned;

    if (!name) continue;
    // Filtro clave: "powered by [Platform]" es reconocimiento de plataforma,
    // no agencia. Descartar.
    if (isPlatform(name)) continue;
    // Sin URL + nombre de una sola palabra corta → muy probable ruido.
    if (!url && name.split(/\s+/).length === 1 && name.length < 5) continue;

    candidates.push({
      phrase: match[0].slice(0, 120).replace(/\s+/g, " "),
      name,
      url,
      confidence: url ? 0.9 : 0.6,
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
