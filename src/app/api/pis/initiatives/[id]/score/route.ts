import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { buildSystemPrompt, buildUserMessage } from "@/lib/pis/prompts";
import type { ScoringResult } from "@/lib/pis/types";

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
    });

    const { text, modelUsed } = await callLLM({
      modelId,
      systemPrompt,
      userMessage,
      maxTokens: 4096,
    });

    // Parse JSON from LLM response (strip markdown fences if present)
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let scoring: ScoringResult;
    try {
      scoring = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "llm_parse_error", raw: text },
        { status: 422 }
      );
    }

    // Persist scoring
    await pool.query(
      `UPDATE pis_initiatives
       SET pis_score = $1,
           hypothesis_score = $2,
           scoring_result = $3,
           model_used = $4,
           scored_at = NOW(),
           status = 'scored',
           updated_at = NOW()
       WHERE id = $5`,
      [
        scoring.pis_score,
        scoring.hypothesis_score,
        JSON.stringify(scoring),
        modelUsed,
        initId,
      ]
    );

    return NextResponse.json({ scoring, model_used: modelUsed });
  } catch (err) {
    console.error("[PIS Score]", err);
    return NextResponse.json({ error: "scoring_failed" }, { status: 500 });
  }
}
