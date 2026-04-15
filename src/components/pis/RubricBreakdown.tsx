"use client";

import { PIS_AXES } from "@/lib/pis/constants";
import type { RubricBreakdown as RubricBreakdownType } from "@/lib/pis/types";

/**
 * Renders the 5-axis PIS rubric. Each axis shows its label, question,
 * {score}/{max}, a proportional fill bar, and the LLM reasoning.
 * Colors are normalized per-axis (score/max ratio), not absolute.
 */
export function RubricBreakdown({ rubric }: { rubric: RubricBreakdownType }) {
  return (
    <div className="space-y-3">
      {PIS_AXES.map((axis) => {
        // Defensive fallback: a malformed/partial rubric blob should degrade
        // gracefully to a zeroed axis rather than crashing the page.
        const axisScore = rubric[axis.id] ?? { score: 0, reasoning: "" };
        const ratio = Math.max(0, Math.min(1, axisScore.score / axis.max));

        const barColor =
          ratio >= 0.7
            ? "bg-positive"
            : ratio >= 0.4
              ? "bg-neutral-sent"
              : "bg-negative";
        const bgColor =
          ratio >= 0.7
            ? "bg-positive-muted"
            : ratio >= 0.4
              ? "bg-neutral-muted"
              : "bg-negative-muted";
        const textColor =
          ratio >= 0.7
            ? "text-positive"
            : ratio >= 0.4
              ? "text-neutral-sent"
              : "text-negative";

        return (
          <div
            key={axis.id}
            className="bg-surface rounded-lg border border-border p-3"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-text">
                  {axis.label}
                </div>
                <div className="text-[11px] text-text-dim leading-snug mt-0.5">
                  {axis.question}
                </div>
              </div>
              <div
                className={`shrink-0 ${bgColor} ${textColor} px-2 py-1 rounded text-sm font-bold tabular-nums`}
              >
                {axisScore.score}
                <span className="text-[10px] font-normal opacity-60">
                  /{axis.max}
                </span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-2">
              <div
                className={`h-full ${barColor} transition-all`}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
            {axisScore.reasoning && (
              <p className="text-xs text-text-muted leading-relaxed">
                {axisScore.reasoning}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
