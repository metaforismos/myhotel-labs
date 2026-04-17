import psl from "psl";
import type {
  Detection,
  RawResource,
  ResourceContext,
  ResourceRole,
} from "./types";

// Hosts del propio hotel no se consideran 3rd-party. También ignoramos
// hosts internos comunes de frameworks (__next, etc.) que no son recursos.
const IGNORE_HOSTS = new Set<string>([
  "localhost",
  "127.0.0.1",
]);

// Heurísticas de rol basadas exclusivamente en el host + contexto,
// SIN asumir vendor. Estas reglas capturan grandes categorías de
// infraestructura (CDN, fonts, video, maps, social) para que no
// contaminen la vista de "booking engine / analytics / etc.".
const HOST_ROLE_HEURISTICS: { match: RegExp; role: ResourceRole }[] = [
  // CDNs / infra
  { match: /(^|\.)cloudflare\.(com|net)$/, role: "cdn" },
  { match: /(^|\.)cloudfront\.net$/, role: "cdn" },
  { match: /(^|\.)akamaihd\.net$/, role: "cdn" },
  { match: /(^|\.)akamaiedge\.net$/, role: "cdn" },
  { match: /(^|\.)fastly\.net$/, role: "cdn" },
  { match: /(^|\.)jsdelivr\.net$/, role: "cdn" },
  { match: /(^|\.)unpkg\.com$/, role: "cdn" },
  { match: /(^|\.)bootstrapcdn\.com$/, role: "cdn" },
  { match: /(^|\.)cdnjs\.cloudflare\.com$/, role: "cdn" },

  // Fonts
  { match: /(^|\.)fonts\.googleapis\.com$/, role: "fonts" },
  { match: /(^|\.)fonts\.gstatic\.com$/, role: "fonts" },
  { match: /(^|\.)use\.typekit\.net$/, role: "fonts" },
  { match: /(^|\.)use\.fontawesome\.com$/, role: "fonts" },

  // Maps
  { match: /(^|\.)maps\.google/, role: "maps" },
  { match: /(^|\.)maps\.googleapis\.com$/, role: "maps" },
  { match: /(^|\.)mapbox\.com$/, role: "maps" },
  { match: /(^|\.)openstreetmap\.org$/, role: "maps" },

  // Video
  { match: /(^|\.)youtube\.com$/, role: "video" },
  { match: /(^|\.)youtube-nocookie\.com$/, role: "video" },
  { match: /(^|\.)ytimg\.com$/, role: "video" },
  { match: /(^|\.)vimeo\.com$/, role: "video" },
  { match: /(^|\.)vimeocdn\.com$/, role: "video" },

  // Social
  { match: /(^|\.)facebook\.com$/, role: "social" },
  { match: /(^|\.)instagram\.com$/, role: "social" },
  { match: /(^|\.)twitter\.com$/, role: "social" },
  { match: /(^|\.)x\.com$/, role: "social" },
  { match: /(^|\.)linkedin\.com$/, role: "social" },
  { match: /(^|\.)tiktok\.com$/, role: "social" },
  { match: /(^|\.)pinterest\.com$/, role: "social" },

  // Ads (cuando se ve como host de script)
  { match: /(^|\.)doubleclick\.net$/, role: "ads" },
  { match: /(^|\.)googlesyndication\.com$/, role: "ads" },
  { match: /(^|\.)googleadservices\.com$/, role: "ads" },
  { match: /(^|\.)googletagservices\.com$/, role: "ads" },
  { match: /(^|\.)adservice\.google/, role: "ads" },
  { match: /(^|\.)connect\.facebook\.net$/, role: "ads" },
  { match: /(^|\.)analytics\.tiktok\.com$/, role: "ads" },

  // Analytics
  { match: /(^|\.)google-analytics\.com$/, role: "analytics" },
  { match: /(^|\.)googletagmanager\.com$/, role: "analytics" },
  { match: /(^|\.)hotjar\.com$/, role: "analytics" },
  { match: /(^|\.)static\.hotjar\.com$/, role: "analytics" },
  { match: /(^|\.)clarity\.ms$/, role: "analytics" },
  { match: /(^|\.)mixpanel\.com$/, role: "analytics" },
  { match: /(^|\.)segment\.com$/, role: "analytics" },
  { match: /(^|\.)amplitude\.com$/, role: "analytics" },

  // Chat
  { match: /(^|\.)intercom\.io$/, role: "chat" },
  { match: /(^|\.)intercomcdn\.com$/, role: "chat" },
  { match: /(^|\.)zdassets\.com$/, role: "chat" },
  { match: /(^|\.)zopim\.com$/, role: "chat" },
  { match: /(^|\.)crisp\.chat$/, role: "chat" },
  { match: /(^|\.)tawk\.to$/, role: "chat" },
  { match: /(^|\.)drift\.com$/, role: "chat" },
  { match: /(^|\.)hubspot\.com$/, role: "chat" },
  { match: /(^|\.)wa\.me$/, role: "chat" },
  { match: /(^|\.)whatsapp\.com$/, role: "chat" },
  { match: /(^|\.)api\.whatsapp\.com$/, role: "chat" },

  // Reviews
  { match: /(^|\.)trustyou\.com$/, role: "reviews" },
  { match: /(^|\.)revinate\.com$/, role: "reviews" },
  { match: /(^|\.)reviewpro\.com$/, role: "reviews" },
  { match: /(^|\.)shijigroup\.com$/, role: "reviews" },
  { match: /(^|\.)myhotelcx\.com$/, role: "reviews" },
  { match: /(^|\.)myhotel\.cl$/, role: "reviews" },
  { match: /(^|\.)jscache\.com$/, role: "reviews" }, // tripadvisor widget
  { match: /(^|\.)tripadvisor\.com$/, role: "reviews" },

  // OTAs
  { match: /(^|\.)booking\.com$/, role: "ota" },
  { match: /(^|\.)expedia\.com$/, role: "ota" },
  { match: /(^|\.)hotels\.com$/, role: "ota" },
  { match: /(^|\.)agoda\.com$/, role: "ota" },
  { match: /(^|\.)airbnb\.com$/, role: "ota" },
  { match: /(^|\.)vrbo\.com$/, role: "ota" },
  { match: /(^|\.)despegar\.com$/, role: "ota" },
  { match: /(^|\.)decolar\.com$/, role: "ota" },
];

export function getRegistrableDomain(host: string): string | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (IGNORE_HOSTS.has(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  const parsed = psl.parse(h);
  if ("domain" in parsed && parsed.domain) return parsed.domain;
  return null;
}

export function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Heurísticas por subdominio: el nombre del subdomain delata intención.
// Se aplican sólo a hosts que NO matchearon ningún HOST_ROLE_HEURISTICS,
// así no pisan clasificaciones más específicas.
const SUBDOMAIN_PATTERNS: { prefix: RegExp; role: ResourceRole }[] = [
  {
    // Subdominios típicos de motores de reserva e IBEs embebidos.
    prefix:
      /^(motor|reservas?|reservations?|booking|bookings|book|ibe|checkout|hospedaje|hospedagem|buchen|prenota|reserver)\./,
    role: "booking_engine",
  },
  {
    prefix: /^(cdn|static|assets|media|files|img|imgs|images|img-cdn)\./,
    role: "cdn",
  },
  {
    prefix: /^(maps?|mapa)\./,
    role: "maps",
  },
  {
    prefix: /^(blog|blogs)\./,
    role: "cms",
  },
  {
    prefix: /^(shop|store|tienda)\./,
    role: "other",
  },
];

function matchHostRole(host: string): ResourceRole | null {
  for (const { match, role } of HOST_ROLE_HEURISTICS) {
    if (match.test(host)) return role;
  }
  for (const { prefix, role } of SUBDOMAIN_PATTERNS) {
    if (prefix.test(host)) return role;
  }
  return null;
}

function inferRoleFromContext(
  host: string,
  contexts: ResourceContext[],
  anchorHints: { host: string; looksLikeBooking: boolean }[]
): ResourceRole {
  const byHost = matchHostRole(host);
  if (byHost) return byHost;

  const hasIframe = contexts.some((c) => c.type === "iframe_src");
  const hasScript = contexts.some((c) => c.type === "script_src");
  const hasLink = contexts.some((c) => c.type === "link_href");
  const hasForm = contexts.some((c) => c.type === "form_action");

  // Iframes suelen ser booking engines o motores de widget embebidos.
  if (hasIframe) {
    const url = contexts.find((c) => c.type === "iframe_src")?.url || "";
    if (/\b(book|reserv|ibe|bookings|reservas|reservations|be|checkout)/i.test(url)) {
      return "booking_engine";
    }
    return "booking_engine";
  }

  if (hasForm) {
    return "booking_engine";
  }

  // Anchor hint: si el dominio es target de un CTA "Reservar/Book" y
  // además aparece como iframe o script, es probable booking engine.
  if (anchorHints.some((a) => a.host === host && a.looksLikeBooking)) {
    return "booking_engine";
  }

  if (hasLink && !hasScript) {
    // Link tag (CSS/font/preload). Puede ser fonts, cdn, genérico.
    return "unknown";
  }

  return "unknown";
}

type HostAccumulator = Map<
  string,
  {
    host: string;
    contexts: ResourceContext[];
  }
>;

function pushContext(acc: HostAccumulator, host: string, ctx: ResourceContext) {
  const existing = acc.get(host);
  if (existing) {
    if (existing.contexts.length < 8) existing.contexts.push(ctx);
    return;
  }
  acc.set(host, { host, contexts: [ctx] });
}

const BOOKING_ANCHOR_TEXT =
  /\b(reservar|reserva|reservas|book|booking now|book now|buchen|prenota|r[eé]server)\b/i;

export function extractResources(args: {
  html: string;
  finalUrl: string;
  script_srcs: string[];
  iframe_srcs: string[];
  link_hrefs: string[];
  form_actions: string[];
  anchors: { href: string; text: string }[];
  detections: Detection[];
}): RawResource[] {
  const baseHost = parseHost(args.finalUrl) || "";
  const baseDomain = baseHost ? getRegistrableDomain(baseHost) : null;

  const acc: HostAccumulator = new Map();

  const addFromList = (
    list: string[],
    type: ResourceContext["type"]
  ) => {
    for (const raw of list) {
      try {
        const u = new URL(raw, `https://${baseHost || "example.com"}`);
        const host = u.hostname.toLowerCase();
        if (!host) continue;
        if (host === baseHost) continue;
        const rd = getRegistrableDomain(host);
        if (!rd) continue;
        if (rd === baseDomain) continue; // mismo dominio raíz del hotel
        pushContext(acc, host, {
          type,
          url: u.toString().slice(0, 500),
        });
      } catch {
        /* skip */
      }
    }
  };

  addFromList(args.script_srcs, "script_src");
  addFromList(args.iframe_srcs, "iframe_src");
  addFromList(args.link_hrefs, "link_href");
  addFromList(args.form_actions, "form_action");

  // Anchors: sólo los que parecen booking CTA + outbound.
  const anchorHints: { host: string; looksLikeBooking: boolean }[] = [];
  for (const a of args.anchors) {
    if (!a.href) continue;
    try {
      const u = new URL(a.href, `https://${baseHost || "example.com"}`);
      const host = u.hostname.toLowerCase();
      if (!host || host === baseHost) continue;
      const rd = getRegistrableDomain(host);
      if (!rd || rd === baseDomain) continue;
      const looksLikeBooking =
        BOOKING_ANCHOR_TEXT.test(a.text) ||
        /\b(book|reserv|ibe|checkout)/i.test(u.pathname);
      anchorHints.push({ host, looksLikeBooking });
      if (looksLikeBooking) {
        pushContext(acc, host, {
          type: "anchor_href",
          url: u.toString().slice(0, 500),
          snippet: a.text.slice(0, 100),
        });
      }
    } catch {
      /* skip */
    }
  }

  // Index detections por host para poder "ennoblecer" observaciones.
  const detectionByHost = new Map<string, Detection>();
  for (const d of args.detections) {
    for (const ev of d.evidence) {
      try {
        const u = new URL(ev.matched, `https://${baseHost || "example.com"}`);
        const host = u.hostname.toLowerCase();
        if (host) {
          if (!detectionByHost.has(host)) detectionByHost.set(host, d);
        }
      } catch {
        /* some matched values are plain HTML substrings, skip */
      }
    }
  }

  const out: RawResource[] = [];
  for (const { host, contexts } of acc.values()) {
    const rd = getRegistrableDomain(host);
    if (!rd) continue;
    const role_hint = inferRoleFromContext(host, contexts, anchorHints);

    // Solo atribuimos vendor del detection al recurso cuando la categoría
    // del detection coincide con el role_hint inferido. Evita que una
    // librería Bootstrap/jQuery detectada en un subdomain de motor.*
    // termine apareciendo como "booking engine: Bootstrap".
    const det = detectionByHost.get(host);
    const vendor_compatible = det && det.category === role_hint;
    out.push({
      host,
      registrable_domain: rd,
      role_hint,
      vendor_name: vendor_compatible ? det!.vendor : null,
      vendor_product: vendor_compatible ? det!.product : null,
      classified_by: vendor_compatible ? "rule" : null,
      contexts,
    });
  }

  out.sort((a, b) => {
    if (a.role_hint !== b.role_hint)
      return a.role_hint.localeCompare(b.role_hint);
    return a.host.localeCompare(b.host);
  });
  return out;
}
