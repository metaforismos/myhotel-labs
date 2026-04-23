"use client";

import type { GA4FunnelStepResult } from "@/lib/analytics/ga4-client";

const pct = (v: number) =>
  `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

const num = (v: number) => v.toLocaleString();

export function PLGFunnelChart({
  title,
  steps,
}: {
  title: string;
  steps: GA4FunnelStepResult[];
}) {
  const maxUsers = steps[0]?.users ?? 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-text tracking-tight">{title}</h3>
        {steps.length > 1 && (
          <span className="text-[11px] text-text-dim font-mono tabular-nums">
            end-to-end {pct(steps[steps.length - 1].conversionFromStart)}
          </span>
        )}
      </div>

      <div className="space-y-1">
        {steps.map((step, i) => {
          const widthPct = maxUsers > 0 ? (step.users / maxUsers) * 100 : 0;
          const isFirst = i === 0;

          return (
            <div key={`${step.name}-${i}`}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="text-[13px] font-medium text-text min-w-0 truncate">
                  <span className="text-text-dim font-mono mr-1.5">{i + 1}.</span>
                  {step.name}
                </div>
                <div className="text-[13px] font-mono tabular-nums text-text shrink-0">
                  {num(step.users)}
                </div>
              </div>

              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                {!isFirst && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-positive-muted text-positive font-mono tabular-nums">
                      {pct(step.conversionFromPrev)} conv.
                    </span>
                    {step.dropoffFromPrev > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-negative-muted text-negative font-mono tabular-nums">
                        −{pct(step.dropoffFromPrev)} drop
                      </span>
                    )}
                  </>
                )}
                {isFirst && (
                  <span className="text-text-dim">Entry step</span>
                )}
                <span className="text-text-dim ml-auto font-mono tabular-nums">
                  {pct(step.conversionFromStart)} of start
                </span>
              </div>

              {i < steps.length - 1 && (
                <div className="flex flex-col items-center py-1.5">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    className="text-text-dim"
                  >
                    <path
                      d="M5 1v7m0 0l-3-3m3 3l3-3"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
