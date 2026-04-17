import { callLLM } from "@/lib/llm";
import type { ResourceRole } from "./types";

export type LlmClassification = {
  role: ResourceRole;
  vendor_name: string | null;
  vendor_product: string | null;
  confidence: number;
  reasoning: string;
};

export type DomainEvidence = {
  registrable_domain: string;
  hosts: string[];
  observed_hotels: number;
  observed_contexts: number;
  sample_contexts: {
    host: string;
    type: string;
    url: string;
    snippet?: string;
  }[];
  sample_hotel_names?: string[];
};

const SYSTEM_PROMPT = `Eres un analista de tecnología de hoteles para myHotel Labs. Recibes UN dominio 3rd-party observado en sitios web de hoteles y tienes que clasificar:
(a) el ROL funcional del dominio (una categoría), y
(b) el VENDOR / PRODUCTO si lo reconoces.

Roles válidos (usa exactamente uno de estos valores):
- booking_engine: motor de reservas online (IBE), widget/iframe de reservas, secure checkout de hotel.
- pms: property management system (gestión operativa del hotel).
- channel_mgr: channel manager (distribución a OTAs).
- cms: plataforma web general (WordPress, Wix, etc.) o builder propio.
- ota: OTA pública (Booking, Expedia, Airbnb, etc.).
- reviews: sistema de reputación / meta-reviews (TrustYou, Revinate, myHotel).
- chat: chatbot / livechat / WhatsApp.
- analytics: analytics, tag manager, session replay.
- ads: pixels publicitarios / retargeting.
- maps: mapas, location services.
- video: hosting de video.
- fonts: fuentes web.
- cdn: CDN / infra genérica, librerías JS.
- social: redes sociales.
- consent: cookie consent / CMP (OneTrust, Cookiebot, Didomi, Iubenda).
- other: utilitarios varios (contadores de visitas, widgets genéricos) que no encajan.

Reglas:
- Si NO reconoces el vendor, pon vendor_name: null y vendor_product: null. NO inventes.
- confidence: 0.0–1.0. Si tienes duda alta, <0.6. Si es evidente por el dominio y contexto, >0.85.
- reasoning: 1 oración en español (<160 chars) explicando qué ves.

Respondé SOLO con un objeto JSON válido, sin bloque de código ni texto extra.

Schema esperado:
{
  "role": "booking_engine" | "pms" | "channel_mgr" | "cms" | "ota" | "reviews" | "chat" | "analytics" | "ads" | "maps" | "video" | "fonts" | "cdn" | "social" | "consent" | "other",
  "vendor_name": string | null,
  "vendor_product": string | null,
  "confidence": number,
  "reasoning": string
}`;

function buildUserPrompt(ev: DomainEvidence): string {
  const lines: string[] = [];
  lines.push(`Dominio registrable: ${ev.registrable_domain}`);
  if (ev.hosts.length > 1) {
    lines.push(
      `Subdominios observados (${ev.hosts.length}): ${ev.hosts.slice(0, 10).join(", ")}`
    );
  } else {
    lines.push(`Host: ${ev.hosts[0] || ev.registrable_domain}`);
  }
  lines.push(
    `Observado en ${ev.observed_hotels} hotel(es) · ${ev.observed_contexts} contextos totales`
  );
  if (ev.sample_hotel_names?.length) {
    lines.push(
      `Hoteles de ejemplo: ${ev.sample_hotel_names.slice(0, 5).join(", ")}`
    );
  }
  lines.push("");
  lines.push("Evidencia cruda (tipo de referencia + URL):");
  for (const c of ev.sample_contexts.slice(0, 12)) {
    const snippet = c.snippet ? ` — "${c.snippet.slice(0, 80)}"` : "";
    lines.push(`- [${c.type}] ${c.url}${snippet}`);
  }
  return lines.join("\n");
}

const VALID_ROLES = new Set<ResourceRole>([
  "booking_engine",
  "pms",
  "channel_mgr",
  "cms",
  "ota",
  "reviews",
  "chat",
  "analytics",
  "ads",
  "maps",
  "video",
  "fonts",
  "cdn",
  "social",
  "consent",
  "other",
  "unknown",
]);

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  // Strip code fences anywhere (not just at start/end).
  const cleaned = trimmed.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Greedy: first '{' to last '}'.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    console.error(
      "[tracker.llm-classifier] llm_response_not_json. len=",
      text.length,
      "raw:",
      text.slice(0, 1200)
    );
    throw new Error("llm_response_not_json");
  }
}

export async function classifyDomain(
  ev: DomainEvidence,
  { modelId = "gemini-flash" }: { modelId?: string } = {}
): Promise<LlmClassification> {
  // Timeout duro por llamada LLM: bajo carga (varios batches
  // auto-classify a la vez) Gemini puede colgarse, y si el await no
  // tiene timeout la ruta entera se muere con 502. 25s es margen
  // suficiente para thinking + output.
  const res = await Promise.race([
    callLLM({
      modelId,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildUserPrompt(ev),
      maxTokens: 2000,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("llm_timeout_40s")), 40000)
    ),
  ]);

  const parsed = parseJsonLoose(res.text) as Record<string, unknown>;
  const roleRaw = typeof parsed.role === "string" ? parsed.role : "other";
  const role = (VALID_ROLES.has(roleRaw as ResourceRole)
    ? (roleRaw as ResourceRole)
    : "unknown") as ResourceRole;

  const vendor_name =
    typeof parsed.vendor_name === "string" && parsed.vendor_name.trim()
      ? parsed.vendor_name.trim().slice(0, 100)
      : null;
  const vendor_product =
    typeof parsed.vendor_product === "string" && parsed.vendor_product.trim()
      ? parsed.vendor_product.trim().slice(0, 160)
      : null;
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
  const reasoning =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning.trim().slice(0, 400)
      : "";

  return { role, vendor_name, vendor_product, confidence, reasoning };
}
