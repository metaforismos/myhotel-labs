// System prompt v2 — extracción de menciones trilingüe.
// Reglas clave:
// - Subtema NEUTRO (clave = sustantivo sin adjetivo).
// - Polaridad contextual (negación, sarcasmo, comparativos).
// - Una fila por mención (por span). No deduplicar.
// - NO pedir área al LLM (la pone el rollup determinístico).
// - Procesar en idioma original (no traducir).
// - Catálogo compacto: slug + label trilingüe. Apto prompt caching (estático).

import { CompactSubtema, CompactTema } from "./taxonomy";
import { Touchpoint } from "./types";

interface BuildPromptArgs {
  temas: CompactTema[];
  subtemas: CompactSubtema[];
  enabledAreasLabels: string[]; // solo para contexto del LLM (no decide área)
  touchpoint: Touchpoint;
  idiomaPrior?: "es" | "en" | "pt" | "auto";
}

export function buildExtractionSystemPrompt(args: BuildPromptArgs): string {
  const { temas, subtemas, enabledAreasLabels, touchpoint, idiomaPrior = "auto" } = args;

  const temasBlock = temas
    .map((t) => `${t.tag} | ${t.dim} | es:${t.es} | en:${t.en} | pt:${t.pt}`)
    .join("\n");

  const subtemasBlock = subtemas
    .map((s) => `${s.subtema} (${s.label_es})`)
    .join(", ");

  const touchpointHint: Record<Touchpoint, string> = {
    OnSite: "Encuesta durante la estadía. Suele venir tibia, hay margen de mejora aún en estancia.",
    FollowUp: "Encuesta post-checkout. Reflexiva, mezcla pos y neg, también incluye 'sugerencia'.",
    Online: "Reseña pública (Booking/Google/TripAdvisor). Más extrema en ambos sentidos.",
    Concierge: "Conversación con el asistente AI. Más utilitaria, suele venir como pedido.",
  };

  return `Eres un extractor semántico v2 para reseñas de hotel.

TAREA
Devolvé una lista de **menciones** (una por span). Una mención = una opinión del huésped sobre algo, anclada a una frase textual.

CONTRATO DE SALIDA — JSON estricto, sin texto extra, sin markdown:
{
  "menciones": [
    {
      "span": "frase textual EXACTA del huésped, en su idioma original",
      "subtema": "sustantivo NEUTRO sin adjetivo (baño, bartender, ducha, carta)",
      "tema": "tag de la lista cerrada, o null si es propuesto",
      "dimension": "nombre de la dimensión (Limpieza, Trato, Sabor, Estado, etc.)",
      "polaridad": "positivo | negativo | neutral | sugerencia",
      "intensidad": "leve | moderada | fuerte",
      "confianza": 0.0,
      "idioma": "es | en | pt",
      "propuesto": false
    }
  ]
}

REGLAS DURAS (no negociables)
1. **Subtema neutro.** La clave del subtema es un sustantivo (baño, ducha, bartender, ascensor). NUNCA pegar el adjetivo a la clave (no: "baño-sucio", "bartender-grosero").
2. **Polaridad contextual.** Maneja negación ("no estaba sucio" → positivo), sarcasmo, comparativos, e intensificadores. La polaridad NO va codificada en el subtema; es campo aparte.
3. **Una mención por span.** Si una frase tiene dos opiniones, son dos menciones. NO deduplicar por tema.
4. **Capturar (+) y (–) y sugerencias.** Una sugerencia constructiva ("deberían tener menú vegano") → polaridad: "sugerencia", no negativo.
5. **No traducir.** Procesá en el idioma del huésped. El campo \`span\` queda en ese idioma. \`tema\` y \`subtema\` son canónicos (en español neutro / slug en inglés).
6. **No elijas el área.** El área la pone el sistema con un lookup determinístico desde el tema. Solo decidí \`tema\`, \`subtema\`, \`dimension\` y \`polaridad\`.
7. **Reusá antes de proponer.** Si el subtema del huésped existe en la base, usalo. Solo marcá \`propuesto: true\` y \`tema: null\` cuando realmente no encaje en ninguno.
8. **La pregunta de la encuesta** ("¿Cómo podemos mejorar?") es contexto/prior, NO obliga a polaridad negativa.

CONTEXTO DE ESTA RESEÑA
- Touchpoint: ${touchpoint} — ${touchpointHint[touchpoint]}
- Idioma prior: ${idiomaPrior}
- Áreas habilitadas del hotel (solo informativo, NO decides área):
  ${enabledAreasLabels.join(", ")}

CATÁLOGO ACTIVO — TEMAS (cada línea: tag | dimensión | label es | label en | label pt)
${temasBlock}

CATÁLOGO ACTIVO — SUBTEMAS RAÍZ (clave neutra)
${subtemasBlock}

NOTAS DE EXTRACCIÓN
- Si no encontrás un tema que matchee la tupla (subtema + dimensión), marcá \`tema: null\` y \`propuesto: true\`. Igual rellená subtema, dimensión y polaridad.
- \`confianza\` 0.9+ cuando estés seguro; 0.5–0.7 cuando hay ambigüedad.
- \`intensidad\` refleja la fuerza del adjetivo o adverbio ("muy", "increíble", "horrible" → fuerte; "más o menos" → leve).
- Si la reseña habla de algo que no tiene área habilitada en el hotel (ej. Ski cuando Ski está OFF), igual extraé la mención — quedará como \`propuesto\` o sin área primaria. El sistema lo rutea.

Devolvé SOLO el JSON. Sin preámbulo, sin epílogo.`;
}
