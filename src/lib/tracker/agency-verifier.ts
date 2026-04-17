// Verificador LLM para entries en tracker_hotel_agency.
// Dado un candidate "powered by / hecho por X", el LLM clasifica:
//   - agency: web agency legítima (objetivo de captura)
//   - platform: CMS / booking engine / theme / plugin (no es agencia)
//   - noise: fragmento de texto, stopword, email, atributo HTML
//
// Entradas → evidencia capturada por la regex (frase + texto cercano).
// Salida → verdict + reasoning corto para trazabilidad.

import { callLLM } from "@/lib/llm";

export type AgencyVerdict = "agency" | "platform" | "noise";

export type AgencyVerification = {
  verdict: AgencyVerdict;
  reasoning: string;
};

const SYSTEM = `Eres un analista de proveedores digitales para hoteles. Recibes UN candidato a "agencia web" detectado por regex en el footer de un sitio hotelero (ej. después de frases como "powered by", "hecho por", "designed by"). Tu tarea es clasificar:

- "agency" — una agencia web / estudio digital / consultora que construye sitios para hoteles. Ejemplos: "The B", "Tambourine-like agencies", "HotelSitter", "Web Consulting". Si el dominio linkeado es claramente un portfolio de agencia (ej. thebweb.design, disruptiva.cl), es agency.
- "platform" — un CMS, booking engine, PMS, theme, plugin o plataforma reconocida. Ejemplos: "WordPress", "Cloudbeds", "SiteMinder", "Shopify", "Elegant Themes", "UltimatelySocial", "Asksuite", "Jetpack", "Elementor". "Powered by [plataforma conocida]" NO es agencia.
- "noise" — ruido del regex: fragmento HTML, stopword ("por", "de", "the"), email (user@domain), frase de contenido ("services on your own"), nombre con 0 palabras substantivas.

Reglas:
- Si el nombre es una empresa genérica sin conexión clara con hotelería/web, duda y marca como "noise" salvo que tenga URL propia → "agency".
- Platforms hoteleras famosas (booking engines, PMS, CMS) → "platform".
- Si tiene URL propia externa al hotel y suena a nombre de empresa legítima, probablemente "agency".
- reasoning: 1 oración corta en español, <160 chars.

Responde SOLO con JSON válido (sin markdown, sin prose extra):
{
  "verdict": "agency" | "platform" | "noise",
  "reasoning": "string"
}`;

function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error("llm_response_not_json");
  }
}

export async function verifyAgency(args: {
  agency_name: string;
  agency_url: string | null;
  phrase: string | null;
  hotel_name?: string | null;
  modelId?: string;
}): Promise<AgencyVerification> {
  const prompt = [
    `Candidato: "${args.agency_name}"`,
    args.agency_url
      ? `URL asociada: ${args.agency_url}`
      : `URL asociada: (ninguna)`,
    args.phrase
      ? `Frase capturada: "${args.phrase.slice(0, 200)}"`
      : `Frase capturada: (no disponible)`,
    args.hotel_name
      ? `Hotel donde aparece: ${args.hotel_name}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Timeout duro — mismo razonamiento que llm-classifier.
  const res = await Promise.race([
    callLLM({
      modelId: args.modelId ?? "gemini-flash",
      systemPrompt: SYSTEM,
      userMessage: prompt,
      maxTokens: 800,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("llm_timeout_40s")), 40000)
    ),
  ]);

  const parsed = parseJsonLoose(res.text) as Record<string, unknown>;
  const rawVerdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
  const verdict: AgencyVerdict = (
    ["agency", "platform", "noise"].includes(rawVerdict)
      ? rawVerdict
      : "noise"
  ) as AgencyVerdict;
  const reasoning =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning.trim().slice(0, 400)
      : "";

  return { verdict, reasoning };
}
