"use client";

import { useState } from "react";
import { Mention, Polaridad } from "@/lib/semantic-v2/types";
import { ALL_TEMAS } from "@/lib/semantic-v2/taxonomy";
import { applyOverride } from "@/lib/semantic-v2/rollup";

const polarityChip: Record<Polaridad, string> = {
  positivo: "bg-positive-muted text-positive",
  negativo: "bg-negative-muted text-negative",
  neutral: "bg-neutral-muted text-neutral-sent",
  sugerencia: "bg-labs-yellow-bg text-labs-yellow",
};

const intensityDots: Record<Mention["intensidad"], number> = {
  leve: 1,
  moderada: 2,
  fuerte: 3,
};

interface Props {
  mention: Mention;
  enabledAreaIds: Set<number>;
  onChange: (m: Mention) => void;
  onHover?: (id: string | null) => void;
  active?: boolean;
}

export function MentionRow({ mention, enabledAreaIds, onChange, onHover, active }: Props) {
  const [editing, setEditing] = useState(false);

  const patch = (p: Partial<Mention>) => onChange(applyOverride(mention, p, enabledAreaIds));

  return (
    <div
      onMouseEnter={() => onHover?.(mention.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group rounded-md border bg-surface px-3 py-2.5 transition-shadow ${active ? "border-accent/50 shadow-sm" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-text italic leading-snug">&ldquo;{mention.span}&rdquo;</p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${polarityChip[mention.polaridad]}`}>
              {mention.subtema}
            </span>
            <span className="text-[10px] text-text-dim flex gap-0.5" title={`intensidad: ${mention.intensidad}`}>
              {Array.from({ length: 3 }).map((_, i) => (
                <span key={i} className={`w-1 h-1 rounded-full ${i < intensityDots[mention.intensidad] ? "bg-text-muted" : "bg-border"}`} />
              ))}
            </span>
            {mention.propuesto && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-labs-yellow-bg text-labs-yellow font-medium">
                propuesto
              </span>
            )}
            {mention.override && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent-light">
                override
              </span>
            )}
            {mention.similar_to && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-3 text-text-muted">
                ≈ {mention.similar_to.subtema} ({(mention.similar_to.score * 100).toFixed(0)}%)
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            <span className="font-mono">{mention.tema ?? "—"}</span>
            <span className="text-text-dim">·</span>
            <span>{mention.dimension}</span>
            <span className="text-text-dim">·</span>
            <span className={mention.area_primary ? "text-text" : "text-text-dim italic"}>
              {mention.area_primary?.es ?? "(sin área primaria)"}
            </span>
            {mention.areas_secondary.length > 0 && (
              <span className="text-text-dim line-through" title="secundarias — no cuentan al índice">
                {mention.areas_secondary.map((a) => a.es).join(" · ")}
              </span>
            )}
            <span className="ml-auto text-text-dim font-mono">
              {mention.idioma} · conf {(mention.confianza * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <button
          onClick={() => setEditing((v) => !v)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-text-muted hover:text-accent px-1.5"
        >
          {editing ? "cerrar" : "override"}
        </button>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-text-dim uppercase tracking-wide">Subtema</span>
            <input
              value={mention.subtema}
              onChange={(e) => patch({ subtema: e.target.value })}
              className="border border-border bg-surface px-2 py-1 rounded"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-dim uppercase tracking-wide">Tema (tag)</span>
            <select
              value={mention.tema ?? ""}
              onChange={(e) => patch({ tema: e.target.value || null })}
              className="border border-border bg-surface px-2 py-1 rounded font-mono"
            >
              <option value="">— (propuesto)</option>
              {ALL_TEMAS.map((t) => (
                <option key={t.tag} value={t.tag}>{t.tag}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-dim uppercase tracking-wide">Polaridad</span>
            <select
              value={mention.polaridad}
              onChange={(e) => patch({ polaridad: e.target.value as Polaridad })}
              className="border border-border bg-surface px-2 py-1 rounded"
            >
              <option value="positivo">positivo</option>
              <option value="negativo">negativo</option>
              <option value="neutral">neutral</option>
              <option value="sugerencia">sugerencia</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-dim uppercase tracking-wide">Intensidad</span>
            <select
              value={mention.intensidad}
              onChange={(e) => patch({ intensidad: e.target.value as Mention["intensidad"] })}
              className="border border-border bg-surface px-2 py-1 rounded"
            >
              <option value="leve">leve</option>
              <option value="moderada">moderada</option>
              <option value="fuerte">fuerte</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
