// POST /api/semantic-v2/extract
// Body: { text, reviewId, idioma, touchpoint, enabledAreaIds, model? }
// Resp: { mentions: Mention[] } — ya rolleadas (área + dimensión determinísticas)

import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/llm";
import { safeParseJSON } from "@/lib/parse";
import {
  activeTemas,
  compactTemas,
  compactSubtemas,
  PARETO_SUBTEMAS,
  ALL_AREAS,
} from "@/lib/semantic-v2/taxonomy";
import { buildExtractionSystemPrompt } from "@/lib/semantic-v2/prompt";
import { rollup } from "@/lib/semantic-v2/rollup";
import { findSimilar } from "@/lib/semantic-v2/discovery";
import { MentionFromLLM, Touchpoint, Idioma } from "@/lib/semantic-v2/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = body.text;
    const reviewId: string = body.reviewId ?? `rv-${Date.now()}`;
    const touchpoint: Touchpoint = body.touchpoint ?? "FollowUp";
    const idioma: Idioma = body.idioma ?? "es";
    const model: string = body.model ?? "claude-haiku";
    const enabledAreaIds: Set<number> = new Set(body.enabledAreaIds ?? []);

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing review text" }, { status: 400 });
    }
    if (enabledAreaIds.size === 0) {
      return NextResponse.json(
        { error: "Missing enabledAreaIds (set of area_id habilitados)" },
        { status: 400 },
      );
    }

    // Catálogo activo: temas con consolidar≠true y cuyo area_primary esté habilitado
    const temas = activeTemas(enabledAreaIds);
    const compactT = compactTemas(temas);
    const compactS = compactSubtemas(PARETO_SUBTEMAS);
    const enabledLabels = ALL_AREAS.filter((a) => enabledAreaIds.has(a.area_id)).map((a) => a.es);

    const systemPrompt = buildExtractionSystemPrompt({
      temas: compactT,
      subtemas: compactS,
      enabledAreasLabels: enabledLabels,
      touchpoint,
      idiomaPrior: idioma,
    });

    const { text: rawText } = await callLLM({
      modelId: model,
      systemPrompt,
      userMessage: text,
      maxTokens: 4096,
    });

    let parsed: { menciones: MentionFromLLM[] };
    try {
      parsed = safeParseJSON(rawText);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse LLM response", raw: rawText },
        { status: 500 },
      );
    }

    const llmMentions = Array.isArray(parsed?.menciones) ? parsed.menciones : [];

    // Rollup determinístico mención por mención.
    const mentions = llmMentions.map((m, i) => {
      const { mention } = rollup({ m, reviewId, index: i, touchpoint, enabledAreaIds });
      // Adjuntar sugerencia de similitud SOLO para propuestos.
      if (mention.propuesto) {
        const hit = findSimilar(mention.subtema);
        if (hit) {
          mention.similar_to = { subtema: hit.subtema, score: hit.score };
        }
      }
      return mention;
    });

    return NextResponse.json({
      review_id: reviewId,
      idioma,
      touchpoint,
      mentions,
      stats: {
        total: mentions.length,
        propuestos: mentions.filter((m) => m.propuesto).length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
