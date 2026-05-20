"use client";

import { Area } from "@/lib/semantic-v2/types";

interface Props {
  areas: Area[];
  enabledAreaIds: Set<number>;
  onToggle: (areaId: number) => void;
}

export function AreasPanel({ areas, enabledAreaIds, onToggle }: Props) {
  const universal = areas.filter((a) => a.tipo === "universal");
  const instalacion = areas.filter((a) => a.tipo === "instalacion");

  return (
    <div className="space-y-3 text-[12px]">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1">
          Universales <span className="text-text-dim/60">(siempre activas)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {universal.map((a) => (
            <span
              key={a.area_id}
              className="px-2 py-0.5 rounded bg-accent/10 text-accent-light text-[11px]"
            >
              {a.es}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1">
          Instalación <span className="text-text-dim/60">(toggle por hotel)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {instalacion.map((a) => {
            const on = enabledAreaIds.has(a.area_id);
            return (
              <button
                key={a.area_id}
                onClick={() => onToggle(a.area_id)}
                className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                  on
                    ? "bg-accent/10 text-accent-light border-accent/30"
                    : "bg-surface-2 text-text-dim border-border hover:text-text"
                }`}
              >
                {on ? "● " : "○ "}{a.es}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
