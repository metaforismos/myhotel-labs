"use client";

import { Mention } from "@/lib/semantic-v2/types";
import { aggregateProposed } from "@/lib/semantic-v2/discovery";
import { unenabledAreasMentioned, UnenabledAreaHit } from "@/lib/semantic-v2/indices";

interface Props {
  mentions: Mention[];
  enabledAreaIds: Set<number>;
}

export function DiscoveryView({ mentions, enabledAreaIds }: Props) {
  const proposed = aggregateProposed(
    mentions.map((m) => ({ subtema: m.subtema, span: m.span, propuesto: m.propuesto })),
  );
  const unenabled: UnenabledAreaHit[] = unenabledAreasMentioned(mentions, enabledAreaIds);

  if (proposed.length === 0 && unenabled.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-md p-6 text-center text-text-dim text-sm">
        Sin propuestos ni áreas no habilitadas en este lote. Cuando el LLM no encuentre un tema canónico o el huésped hable de un área OFF, va a aparecer acá.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unenabled.length > 0 && (
        <div className="bg-surface border border-border rounded-md overflow-hidden">
          <div className="px-3 py-2 bg-surface-2 border-b border-border text-[11px] uppercase tracking-wider text-text-dim">
            Áreas no habilitadas que tus huéspedes mencionan
          </div>
          <div className="divide-y divide-border">
            {unenabled.map((u) => (
              <div key={u.area_id} className="px-3 py-2 flex items-center justify-between">
                <div className="text-[13px]">{u.area_label}</div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-text-muted">{u.count} menciones</span>
                  <span className="px-2 py-0.5 rounded bg-labs-yellow-bg text-labs-yellow">
                    ¿activar?
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {proposed.length > 0 && (
        <div className="bg-surface border border-border rounded-md overflow-hidden">
          <div className="px-3 py-2 bg-surface-2 border-b border-border text-[11px] uppercase tracking-wider text-text-dim flex items-center justify-between">
            <span>Subtemas propuestos en la sesión</span>
            <span className="font-mono">{proposed.length} únicos</span>
          </div>
          <div className="divide-y divide-border">
            {proposed.map((p) => (
              <div key={p.subtema} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[12px] text-labs-yellow">{p.subtema}</span>
                    <span className="text-[11px] text-text-muted">×{p.count}</span>
                  </div>
                  {p.similar_to ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-accent/10 text-accent-light">
                      ≈ {p.similar_to.label} ({(p.similar_to.score * 100).toFixed(0)}%)
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-positive-muted text-positive">
                      nuevo
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {p.examples.map((ex, i) => (
                    <li key={i} className="text-[11px] italic text-text-muted">&ldquo;{ex}&rdquo;</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
