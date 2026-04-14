"use client";

import type { PisInitiative } from "@/lib/pis/types";
import { ScoreBadge } from "./ScoreBadge";
import { KpiImpactTable } from "./KpiImpactTable";
import { ProductTags } from "./ProductTags";

export function ScoreBreakdown({ initiative }: { initiative: PisInitiative }) {
  const sr = initiative.scoring_result;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text">{initiative.title}</h1>
        <div className="mt-2 flex items-center gap-3">
          <ProductTags products={initiative.products} />
          <span className="text-xs text-text-dim">por {initiative.author}</span>
        </div>
      </div>

      {/* Scores row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Puntaje PIS
          </div>
          <ScoreBadge score={initiative.pis_score} size="lg" />
          {sr?.score_criteria && (
            <p className="mt-3 text-sm text-text-muted leading-relaxed">
              {sr.score_criteria}
            </p>
          )}
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Puntaje Hipótesis
          </div>
          <ScoreBadge score={initiative.hypothesis_score} size="lg" />
          {sr?.hypothesis_feedback && (
            <p className="mt-3 text-sm text-text-muted leading-relaxed">
              {sr.hypothesis_feedback}
            </p>
          )}
        </div>
      </div>

      {/* Description & Hypothesis */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
            Descripción
          </div>
          <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">
            {initiative.description}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
            Hipótesis
          </div>
          <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">
            {initiative.hypothesis}
          </p>
        </div>
      </div>

      {/* KPI Impact */}
      {sr?.kpi_impact && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Impacto en KPIs 2026
          </div>
          <KpiImpactTable impacts={sr.kpi_impact} />
        </div>
      )}

      {/* Recommendation */}
      {sr?.recommendation && (
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-1.5">
            Recomendación para el Comité
          </div>
          <p className="text-sm text-text leading-relaxed">
            {sr.recommendation}
          </p>
        </div>
      )}

      {/* Meta */}
      {initiative.model_used && (
        <div className="text-xs text-text-dim">
          Evaluado con {initiative.model_used} el{" "}
          {initiative.scored_at
            ? new Date(initiative.scored_at).toLocaleDateString("es-CL")
            : "—"}
        </div>
      )}
    </div>
  );
}
