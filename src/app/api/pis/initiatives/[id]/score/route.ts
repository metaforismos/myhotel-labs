import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { buildSystemPrompt, buildUserMessage } from "@/lib/pis/prompts";
import { PIS_AXES, clampAxisScore } from "@/lib/pis/constants";
import { effortPercent } from "@/lib/pis/types";
import type {
  AxisScore,
  RubricBreakdown,
  ScoringResult,
  KpiImpact,
  HypothesisQuality,
} from "@/lib/pis/types";

function parseAxis(raw: unknown): AxisScore | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = typeof r.score === "number" ? r.score : Number(r.score);
  if (!Number.isFinite(score)) return null;
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : "";
  return { score, reasoning };
}

function parseHypothesisQuality(raw: unknown): HypothesisQuality | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = typeof r.score === "number" ? r.score : Number(r.score);
  if (!Number.isFinite(score)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const feedback = typeof r.feedback === "string" ? r.feedback : "";
  return { score: clamped, feedback };
}

function validateAndClamp(parsed: unknown): ScoringResult | { error: string } {
  if (!parsed || typeof parsed !== "object") return { error: "not_object" };
  const p = parsed as Record<string, unknown>;
  const rawRubric = p.rubric;
  if (!rawRubric || typeof rawRubric !== "object") {
    return { error: "missing_rubric" };
  }
  const rr = rawRubric as Record<string, unknown>;

  const rubric = {} as RubricBreakdown;
  let total = 0;
  for (const axis of PIS_AXES) {
    const axisRaw = parseAxis(rr[axis.id]);
    if (!axisRaw) return { error: `missing_axis_${axis.id}` };
    const clamped = clampAxisScore(axis.id, axisRaw.score);
    rubric[axis.id] = { score: clamped, reasoning: axisRaw.reasoning };
    total += clamped;
  }

  const hypothesis_quality = parseHypothesisQuality(p.hypothesis_quality);
  if (!hypothesis_quality) return { error: "missing_hypothesis_quality" };

  const kpi_impact: KpiImpact[] = Array.isArray(p.kpi_impact)
    ? (p.kpi_impact as KpiImpact[])
    : [];
  const recommendation =
    typeof p.recommendation === "string" ? p.recommendation : "";

  return {
    rubric,
    pis_score: total,
    hypothesis_quality,
    kpi_impact,
    recommendation,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const initId = parseInt(id, 10);
  if (isNaN(initId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    // Fetch initiative
    const initResult = await pool.query(
      "SELECT * FROM pis_initiatives WHERE id = $1",
      [initId]
    );
    if (initResult.rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const initiative = initResult.rows[0];

    // Fetch knowledge base for context
    const kbResult = await pool.query(
      "SELECT category, title, content FROM pis_knowledge ORDER BY category, created_at DESC"
    );

    // Parse model from body (optional)
    let modelId = "gemini-pro";
    try {
      const body = await request.json();
      if (body.modelId) modelId = body.modelId;
    } catch {
      // no body is fine, use default
    }

    const systemPrompt = buildSystemPrompt(kbResult.rows);
    const userMessage = buildUserMessage({
      title: initiative.title,
      description: initiative.description,
      hypothesis: initiative.hypothesis,
      products: initiative.products,
      author: initiative.author,
      celula: initiative.celula,
      jornadas: initiative.jornadas,
      effortPercent: effortPercent(initiative.jornadas),
    });

    const { text, modelUsed } = await callLLM({
      modelId,
      systemPrompt,
      userMessage,
      maxTokens: 4096,
    });

    // Parse JSON from LLM response (strip markdown fences if present)
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "llm_parse_error", reason: "invalid_json", raw: text },
        { status: 422 }
      );
    }

    const validated = validateAndClamp(parsed);
    if ("error" in validated) {
      return NextResponse.json(
        { error: "llm_parse_error", reason: validated.error, raw: text },
        { status: 422 }
      );
    }

    // Persist scoring
    await pool.query(
      `UPDATE pis_initiatives
       SET pis_score = $1,
           scoring_result = $2,
           model_used = $3,
           scored_at = NOW(),
           status = 'scored',
           updated_at = NOW()
       WHERE id = $4`,
      [
        validated.pis_score,
        JSON.stringify(validated),
        modelUsed,
        initId,
      ]
    );

    return NextResponse.json({ scoring: validated, model_used: modelUsed });
  } catch (err) {
    console.error("[PIS Score]", err);
    return NextResponse.json({ error: "scoring_failed" }, { status: 500 });
  }
}
