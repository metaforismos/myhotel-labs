import type { Detection, RawResource } from "./types";

// Categorías que queremos representar SIEMPRE en el stack sintetizado por hotel.
// Un hotel sin ninguna señal para la categoría queda con value=null (fila vacía).
export const STACK_CATEGORIES = [
  "booking_engine",
  "cms",
  "pms",
  "channel_mgr",
  "chat",
  "reviews",
  "ads",
  "analytics",
  "consent",
] as const;

export type StackCategory = (typeof STACK_CATEGORIES)[number];

export type StackCell = {
  vendor: string | null;
  product: string | null;
  // Dominio que mejor representa la categoría (útil cuando no hay vendor aún).
  domain: string | null;
  source: "rule" | "resource" | null; // rule = detection matched; resource = inferred from observation
  confidence: number | null;
  needs_classification: boolean;
};

export type SynthesizedStack = Record<StackCategory, StackCell | null>;

function emptyCell(): StackCell {
  return {
    vendor: null,
    product: null,
    domain: null,
    source: null,
    confidence: null,
    needs_classification: false,
  };
}

function fromDetection(d: Detection): StackCell {
  return {
    vendor: d.vendor,
    product: d.product,
    domain: null,
    source: "rule",
    confidence: d.confidence,
    needs_classification: false,
  };
}

function fromResource(r: RawResource): StackCell {
  return {
    vendor: r.vendor_name || null,
    product: r.vendor_product || null,
    domain: r.registrable_domain,
    source: "resource",
    confidence: r.classified_by === "rule" ? 0.8 : null,
    needs_classification: !r.vendor_name,
  };
}

/**
 * Compone un stack por categoría priorizando:
 *  1. Detection por regla (máxima confianza, rule-matched vendor).
 *  2. Recurso observado con role_hint = categoría (de discovery).
 *     - Si tiene vendor_name (de rule o LLM): lo usa.
 *     - Si no: usa el dominio crudo y marca needs_classification=true.
 *
 * Devuelve null cuando no hay señal de ningún tipo para esa categoría.
 */
export function synthesizeStack(
  detections: Detection[],
  resources: RawResource[]
): SynthesizedStack {
  const out = {} as SynthesizedStack;

  for (const cat of STACK_CATEGORIES) {
    out[cat] = null;
  }

  // Pasada 1: detecciones por regla (preferidas si existen).
  for (const cat of STACK_CATEGORIES) {
    const det = detections
      .filter((d) => d.category === cat)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (det) out[cat] = fromDetection(det);
  }

  // Pasada 2: llenar categorías vacías con el mejor recurso observado.
  // Preferimos recursos con vendor_name (ya clasificados) sobre "sin clasificar".
  for (const cat of STACK_CATEGORIES) {
    if (out[cat]) continue;
    const matching = resources.filter((r) => r.role_hint === cat);
    if (matching.length === 0) continue;
    const classified = matching.find((r) => r.vendor_name);
    out[cat] = fromResource(classified ?? matching[0]);
  }

  // Asegura objeto completo con null explícito para categorías vacías.
  for (const cat of STACK_CATEGORIES) {
    if (!out[cat]) out[cat] = emptyCell();
  }

  return out;
}

/**
 * Resumen compacto del stack, seguro para serializar en bulk result_summary
 * y para mostrar como pills en la tabla del job.
 */
export function compactStackSummary(stack: SynthesizedStack): {
  categories: string[];
  booking_engine: string | null;
  cms: string | null;
  pms: string | null;
  chat: string | null;
  reviews: string | null;
  ads: string | null;
  analytics: string | null;
} {
  const label = (c: StackCell | null) =>
    c && (c.vendor || c.domain) ? c.vendor || c.domain : null;
  const cats = STACK_CATEGORIES.filter((k) => !!(stack[k]?.source ?? null));
  return {
    categories: cats,
    booking_engine: label(stack.booking_engine),
    cms: label(stack.cms),
    pms: label(stack.pms),
    chat: label(stack.chat),
    reviews: label(stack.reviews),
    ads: label(stack.ads),
    analytics: label(stack.analytics),
  };
}
