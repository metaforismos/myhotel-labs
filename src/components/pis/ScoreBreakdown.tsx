"use client";

import { effortPercent } from "@/lib/pis/types";
import type { PisInitiative } from "@/lib/pis/types";
import { ScoreBadge } from "./ScoreBadge";
import { KpiImpactTable } from "./KpiImpactTable";
import { ProductTags } from "./ProductTags";
import { RubricBreakdown } from "./RubricBreakdown";

export function ScoreBreakdown({ initiative }: { initiative: PisInitiative }) {
  const sr = initiative.scoring_result;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text">{initiative.title}</h1>
        <div className="mt-2 flex items-center gap-3">
          <ProductTags products={initiative.products} />
          {initiative.author && (
            <span className="text-xs text-text-dim">por {initiative.author}</span>
          )}
          {initiative.celula && (
            <span className="text-xs bg-surface-2 px-1.5 py-0.5 rounded text-text-dim">
              {initiative.celula}
            </span>
          )}
          {initiative.jornadas != null && (
            <span className="text-xs text-text-dim">
              {initiative.jornadas}j · {effortPercent(initiative.jornadas)}% del ciclo
            </span>
          )}
        </div>
      </div>

      {/* Total PIS score */}
      <div className="bg-surface rounded-lg border border-border p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1">
            Puntaje PIS Total
          </div>
          <div className="text-xs text-text-dim">
            Suma ponderada de los 5 ejes de la rúbrica
          </div>
        </div>
        <ScoreBadge score={initiative.pis_score} size="lg" />
      </div>

      {/* Rubric breakdown */}
      {sr?.rubric && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">
            Rúbrica — 5 ejes
          </div>
          <RubricBreakdown rubric={sr.rubric} />
        </div>
      )}

      {/* Hypothesis quality (educational, does NOT affect PIS) */}
      {sr?.hypothesis_quality && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-0.5">
                Calidad de la Hipótesis
              </div>
              <div className="text-[11px] text-text-dim leading-snug">
                Métrica educativa · no afecta el PIS score
              </div>
            </div>
            <div className="shrink-0 text-lg font-bold tabular-nums text-text">
              {sr.hypothesis_quality.score}
              <span className="text-xs font-normal text-text-dim">/100</span>
            </div>
          </div>
          {sr.hypothesis_quality.feedback && (
            <p className="text-xs text-text-muted leading-relaxed">
              {sr.hypothesis_quality.feedback}
            </p>
          )}
        </div>
      )}

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
