"use client";

import Link from "next/link";
import { PIS_AXES, axisRatio } from "@/lib/pis/constants";
import type { PisInitiativeSummary } from "@/lib/pis/types";

/**
 * Slide-style matrix view: one row per initiative, one column per rubric axis,
 * cells color-scaled blue by score/max (normalized per-axis so Delivery's max-10
 * column doesn't look perpetually faint vs. Directness's max-30).
 */
export function InitiativeMatrix({
  initiatives,
}: {
  initiatives: PisInitiativeSummary[];
}) {
  // Sort by total PIS score descending, NULLs last. Coerce to Number so the
  // sort works whether the pg driver returns pis_score as a number (integer
  // column) or a string (numeric/decimal column).
  const sorted = [...initiatives].sort((a, b) => {
    if (a.pis_score == null && b.pis_score == null) return 0;
    if (a.pis_score == null) return 1;
    if (b.pis_score == null) return -1;
    return Number(b.pis_score) - Number(a.pis_score);
  });

  if (sorted.length === 0) {
    return (
      <div className="text-center py-12 text-text-dim text-sm">
        No hay iniciativas para mostrar en la matriz.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2">
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              Iniciativa
            </th>
            {PIS_AXES.map((axis) => (
              <th
                key={axis.id}
                className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-text-dim w-20"
                title={axis.question}
              >
                {axis.label}
                <div className="text-[9px] font-normal opacity-60">
                  /{axis.max}
                </div>
              </th>
            ))}
            <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-text-dim w-20">
              PIS
              <div className="text-[9px] font-normal opacity-60">/100</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((init, i) => {
            const rubric = init.scoring_result?.rubric;
            return (
              <tr
                key={init.id}
                className={`${i % 2 === 0 ? "bg-surface" : "bg-surface-2/50"} hover:bg-accent/5 transition-colors`}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/pis/${init.id}`}
                    className="font-medium text-text hover:text-accent-light transition-colors line-clamp-1"
                  >
                    {init.title}
                  </Link>
                </td>
                {PIS_AXES.map((axis) => {
                  const axisScore = rubric?.[axis.id]?.score ?? null;
                  const ratio = axisRatio(axis.id, axisScore);
                  const bgOpacity = axisScore == null ? 0 : ratio * 0.85 + 0.1;
                  const textColor =
                    axisScore == null
                      ? "text-text-dim"
                      : ratio > 0.55
                        ? "text-white"
                        : "text-text";
                  return (
                    <td
                      key={axis.id}
                      className={`px-2 py-2 text-center font-semibold tabular-nums ${textColor}`}
                      style={{
                        backgroundColor:
                          axisScore == null
                            ? undefined
                            : `rgba(59, 130, 246, ${bgOpacity})`,
                      }}
                    >
                      {axisScore ?? "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-bold tabular-nums text-text">
                  {init.pis_score ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
