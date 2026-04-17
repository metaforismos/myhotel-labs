// Vendor prelinker — deterministic regex table of well-known domain
// families. Runs BEFORE the LLM classifier in tracker_resources flow.
// If a pending domain matches a known family, we reuse the canonical
// vendor/role without burning tokens.
//
// Each entry carries:
//   - `match`: a regex tested against the registrable_domain (lowercased).
//   - `vendor`, `product`, `role`: canonical attribution.
//   - `confidence`: ~0.9 because the match is explicit and curated.
//
// Start with generic web infrastructure (Google, Cloudflare, AWS, Meta,
// CDNs, font services, payment gateways). Hotel-tech vendors already get
// caught by the booking-engines.json / cms.json rules upstream — this
// table intentionally does NOT duplicate those (we want only ONE path
// claiming a domain, to keep provenance clean).

import type { LlmClassification } from "./llm-classifier";
import type { ResourceRole } from "./types";

type PrelinkEntry = {
  id: string;
  match: RegExp;
  vendor: string;
  product: string | null;
  role: ResourceRole;
  confidence: number;
};

const ENTRIES: PrelinkEntry[] = [
  // ─────────────────────────────────── Google ecosystem
  {
    id: "google_tagmanager",
    match: /^googletagmanager\.com$/,
    vendor: "Google",
    product: "Tag Manager",
    role: "analytics",
    confidence: 0.95,
  },
  {
    id: "google_analytics",
    match: /^google-analytics\.com$|^googleanalytics\.com$/,
    vendor: "Google",
    product: "Analytics",
    role: "analytics",
    confidence: 0.95,
  },
  {
    id: "google_ads",
    match: /^(googleadservices|googlesyndication|doubleclick)\.(com|net)$/,
    vendor: "Google",
    product: "Ads",
    role: "ads",
    confidence: 0.95,
  },
  {
    id: "google_fonts",
    match: /^fonts\.googleapis\.com$|^fonts\.gstatic\.com$/,
    vendor: "Google",
    product: "Fonts",
    role: "fonts",
    confidence: 0.95,
  },
  {
    id: "google_recaptcha",
    match: /^recaptcha\.net$|^google\.com$/,
    vendor: "Google",
    product: "reCAPTCHA",
    role: "other",
    confidence: 0.7,
  },
  {
    id: "google_gstatic",
    match: /^gstatic\.com$|^googleapis\.com$/,
    vendor: "Google",
    product: "Static assets / APIs",
    role: "cdn",
    confidence: 0.85,
  },
  {
    id: "google_maps",
    match: /^maps\.googleapis\.com$|^maps\.google\.com$/,
    vendor: "Google",
    product: "Maps",
    role: "maps",
    confidence: 0.95,
  },
  {
    id: "google_youtube",
    match: /^(youtube|youtu\.be|ytimg)\.com$/,
    vendor: "Google",
    product: "YouTube",
    role: "video",
    confidence: 0.95,
  },

  // ─────────────────────────────────── Meta / Facebook
  {
    id: "meta_core",
    match: /^(facebook|fbcdn|fbsbx|fb)\.com$|^fbcdn\.net$/,
    vendor: "Meta",
    product: "Facebook",
    role: "social",
    confidence: 0.95,
  },
  {
    id: "meta_instagram",
    match: /^instagram\.com$|^cdninstagram\.com$/,
    vendor: "Meta",
    product: "Instagram",
    role: "social",
    confidence: 0.95,
  },
  {
    id: "meta_pixel",
    match: /^connect\.facebook\.net$/,
    vendor: "Meta",
    product: "Pixel",
    role: "ads",
    confidence: 0.95,
  },

  // ─────────────────────────────────── TikTok
  {
    id: "tiktok",
    match: /^tiktok\.com$|^tiktokcdn\.com$|^analytics\.tiktok\.com$/,
    vendor: "TikTok",
    product: "Pixel / CDN",
    role: "ads",
    confidence: 0.9,
  },

  // ─────────────────────────────────── Cloudflare
  {
    id: "cloudflare_core",
    match: /^cloudflare\.com$|^cloudflareinsights\.com$/,
    vendor: "Cloudflare",
    product: "CDN + Analytics",
    role: "cdn",
    confidence: 0.95,
  },
  {
    id: "cloudflare_cdn",
    match: /^cdnjs\.cloudflare\.com$/,
    vendor: "Cloudflare",
    product: "cdnjs",
    role: "cdn",
    confidence: 0.95,
  },

  // ─────────────────────────────────── AWS
  {
    id: "aws_cloudfront",
    match: /^cloudfront\.net$/,
    vendor: "AWS",
    product: "CloudFront",
    role: "cdn",
    confidence: 0.95,
  },
  {
    id: "aws_s3",
    match: /^amazonaws\.com$|^s3\.amazonaws\.com$/,
    vendor: "AWS",
    product: "S3",
    role: "cdn",
    confidence: 0.9,
  },

  // ─────────────────────────────────── Other CDNs
  { id: "jsdelivr", match: /^jsdelivr\.net$|^cdn\.jsdelivr\.net$/, vendor: "jsDelivr", product: null, role: "cdn", confidence: 0.95 },
  { id: "unpkg", match: /^unpkg\.com$/, vendor: "unpkg", product: null, role: "cdn", confidence: 0.95 },
  { id: "bootstrapcdn", match: /^(maxcdn\.)?bootstrapcdn\.com$/, vendor: "Bootstrap", product: "BootstrapCDN", role: "cdn", confidence: 0.9 },
  { id: "fontawesome", match: /^use\.fontawesome\.com$|^fontawesome\.com$|^kit\.fontawesome\.com$/, vendor: "Font Awesome", product: null, role: "fonts", confidence: 0.95 },
  { id: "typekit", match: /^use\.typekit\.net$|^typekit\.net$/, vendor: "Adobe", product: "Typekit / Fonts", role: "fonts", confidence: 0.9 },
  { id: "hotjar", match: /^static\.hotjar\.com$|^hotjar\.com$/, vendor: "Hotjar", product: null, role: "analytics", confidence: 0.95 },
  { id: "cookiebot", match: /^consent\.cookiebot\.com$|^cookiebot\.com$/, vendor: "Cookiebot", product: null, role: "consent", confidence: 0.95 },
  { id: "termly", match: /^app\.termly\.io$|^termly\.io$/, vendor: "Termly", product: null, role: "consent", confidence: 0.95 },
  { id: "onetrust", match: /^cdn\.cookielaw\.org$|^onetrust\.com$/, vendor: "OneTrust", product: "Cookie Consent", role: "consent", confidence: 0.95 },

  // ─────────────────────────────────── Messaging / chat
  { id: "whatsapp", match: /^wa\.me$|^api\.whatsapp\.com$|^whatsapp\.com$/, vendor: "WhatsApp", product: "Click-to-Chat", role: "chat", confidence: 0.9 },
  { id: "zendesk", match: /^zendesk\.com$|^zdassets\.com$|^zopim\.com$/, vendor: "Zendesk", product: "Chat", role: "chat", confidence: 0.95 },
  { id: "intercom", match: /^intercom\.io$|^intercomcdn\.com$/, vendor: "Intercom", product: null, role: "chat", confidence: 0.95 },
  { id: "crisp", match: /^crisp\.chat$|^client\.crisp\.chat$/, vendor: "Crisp", product: null, role: "chat", confidence: 0.95 },
  { id: "tawk", match: /^tawk\.to$|^embed\.tawk\.to$/, vendor: "Tawk.to", product: null, role: "chat", confidence: 0.95 },

  // ─────────────────────────────────── Reviews
  { id: "tripadvisor", match: /^tripadvisor\.com$|^tripadvisor\.[a-z.]+$|^static\.tacdn\.com$/, vendor: "TripAdvisor", product: null, role: "reviews", confidence: 0.95 },
  { id: "trustyou", match: /^trustyou\.com$|^cdn\.trustyou\.com$/, vendor: "TrustYou", product: null, role: "reviews", confidence: 0.95 },
  { id: "revinate", match: /^revinate\.com$/, vendor: "Revinate", product: null, role: "reviews", confidence: 0.9 },

  // ─────────────────────────────────── OTAs
  { id: "booking", match: /^booking\.com$/, vendor: "Booking.com", product: null, role: "ota", confidence: 0.98 },
  { id: "expedia", match: /^expedia\.(com|[a-z.]+)$|^expediagroup\.com$/, vendor: "Expedia", product: null, role: "ota", confidence: 0.95 },
  { id: "hotels", match: /^hotels\.com$/, vendor: "Hotels.com", product: null, role: "ota", confidence: 0.95 },
  { id: "agoda", match: /^agoda\.com$/, vendor: "Agoda", product: null, role: "ota", confidence: 0.95 },
  { id: "despegar", match: /^despegar\.[a-z.]+$|^decolar\.com$/, vendor: "Despegar / Decolar", product: null, role: "ota", confidence: 0.95 },
  { id: "airbnb", match: /^airbnb\.[a-z.]+$/, vendor: "Airbnb", product: null, role: "ota", confidence: 0.95 },

  // ─────────────────────────────────── Payments
  { id: "stripe", match: /^stripe\.com$|^js\.stripe\.com$/, vendor: "Stripe", product: null, role: "other", confidence: 0.95 },
  { id: "paypal", match: /^paypal\.com$|^paypalobjects\.com$/, vendor: "PayPal", product: null, role: "other", confidence: 0.95 },

  // ─────────────────────────────────── WordPress / jQuery ecosystem
  { id: "wp_com", match: /^wp\.com$|^s\.w\.org$/, vendor: "WordPress", product: "WP.com / S.w.org", role: "cdn", confidence: 0.9 },
  { id: "jquery", match: /^code\.jquery\.com$|^jquery\.com$/, vendor: "jQuery", product: null, role: "cdn", confidence: 0.9 },

  // ─────────────────────────────────── Hotel tech not covered by rules
  { id: "hotelbeds", match: /^hotelbeds\.com$/, vendor: "Hotelbeds", product: null, role: "ota", confidence: 0.9 },
];

export type PrelinkResult = LlmClassification & {
  prelinked: true;
  entry_id: string;
};

export function prelinkDomain(
  registrable_domain: string
): PrelinkResult | null {
  const host = registrable_domain.toLowerCase().trim();
  if (!host) return null;
  for (const entry of ENTRIES) {
    if (entry.match.test(host)) {
      return {
        prelinked: true,
        entry_id: entry.id,
        role: entry.role,
        vendor_name: entry.vendor,
        vendor_product: entry.product,
        confidence: entry.confidence,
        reasoning: `Matched prelinker entry "${entry.id}" — skipped LLM.`,
      };
    }
  }
  return null;
}

export function prelinkerSize(): number {
  return ENTRIES.length;
}
