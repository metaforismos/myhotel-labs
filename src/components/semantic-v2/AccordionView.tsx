"use client";

import { useState } from "react";
import {
  AccordionLens,
  AccordionRoot,
  AccordionSubtema,
  AccordionTema,
  AccordionTree,
} from "@/lib/semantic-v2/types";
import { isIndexConfiable } from "@/lib/semantic-v2/indices";

interface Props {
  tree: AccordionTree;
  lens: AccordionLens;
  onChangeLens: (l: AccordionLens) => void;
  nMin: number;
  onChangeNMin: (n: number) => void;
}

export function AccordionView({ tree, lens, onChangeLens, nMin, onChangeNMin }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-surface border border-border rounded-md px-3 py-2">
        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-text-muted">Ver por</span>
          <div className="flex bg-surface-2 border border-border rounded">
            <button
              onClick={() => onChangeLens("area")}
              className={`px-3 py-1 text-[12px] ${lens === "area" ? "bg-accent text-white" : "text-text-muted hover:text-text"}`}
            >
              Área
            </button>
            <button
              onClick={() => onChangeLens("dimension")}
              className={`px-3 py-1 text-[12px] border-l border-border ${lens === "dimension" ? "bg-accent text-white" : "text-text-muted hover:text-text"}`}
            >
              Dimensión
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <label>
            N mínimo:
            <input
              type="number"
              min={1}
              max={100}
              value={nMin}
              onChange={(e) => onChangeNMin(parseInt(e.target.value) || 1)}
              className="ml-1 w-14 border border-border rounded px-1 py-0.5 text-[11px]"
            />
          </label>
        </div>
      </div>

      {tree.mece_violations.length > 0 && (
        <div className="rounded-md bg-labs-yellow-bg border border-labs-yellow/40 text-labs-yellow text-[11px] p-2">
          <strong className="block mb-1">MECE check FALLÓ</strong>
          <ul className="list-disc list-inside">
            {tree.mece_violations.slice(0, 5).map((v, i) => <li key={i}>{v}</li>)}
            {tree.mece_violations.length > 5 && (
              <li>… y {tree.mece_violations.length - 5} más</li>
            )}
          </ul>
        </div>
      )}

      <div className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="grid grid-cols-[28px_1fr_70px_70px_120px_70px] gap-2 px-3 py-2 bg-surface-2 border-b border-border text-[10px] uppercase tracking-wider text-text-dim">
          <div></div>
          <div>Etiqueta</div>
          <div className="text-right">Pos</div>
          <div className="text-right">Neg</div>
          <div className="text-right">Índice</div>
          <div className="text-right">Sug</div>
        </div>
        {tree.roots.length === 0 && (
          <div className="px-3 py-6 text-center text-text-dim text-sm">
            Sin menciones en el lote.
          </div>
        )}
        {tree.roots.map((root) => (
          <RootRow key={root.key} root={root} nMin={nMin} />
        ))}
      </div>
    </div>
  );
}

function indiceCell(
  pos: number,
  neg: number,
  indice: number | null,
  total: number,
  nMin: number,
): React.ReactNode {
  if (!isIndexConfiable(pos, neg, nMin)) {
    return <span className="text-text-dim text-[11px]">{total} ej.</span>;
  }
  if (indice === null) return <span className="text-text-dim">—</span>;
  const pct = indice * 100;
  const color =
    pct >= 80 ? "bg-positive" : pct >= 60 ? "bg-neutral-sent" : pct >= 40 ? "bg-labs-yellow" : "bg-negative";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {pct.toFixed(0)}%
    </span>
  );
}

function RootRow({ root, nMin }: { root: AccordionRoot; nMin: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[28px_1fr_70px_70px_120px_70px] gap-2 px-3 py-2 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-text-muted font-mono text-[12px]">{open ? "▾" : "›"}</span>
        <span className="font-medium text-[13px]">{root.label}</span>
        <span className="text-right font-mono text-[12px] text-positive">{root.positivas}</span>
        <span className="text-right font-mono text-[12px] text-negative">{root.negativas}</span>
        <span className="text-right">{indiceCell(root.positivas, root.negativas, root.indice, root.total, nMin)}</span>
        <span className="text-right font-mono text-[11px] text-labs-yellow">{root.sugerencias}</span>
      </button>
      {open && (
        <div>
          {root.temas.map((tema) => (
            <TemaRow key={tema.tag} tema={tema} nMin={nMin} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemaRow({ tema, nMin }: { tema: AccordionTema; nMin: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[28px_1fr_70px_70px_120px_70px] gap-2 px-3 py-1.5 pl-8 hover:bg-surface-2 transition-colors text-left bg-surface-2/30"
      >
        <span className="text-text-muted font-mono text-[12px]">{open ? "▾" : "›"}</span>
        <span className="text-[12px]">
          <span className="text-text">{tema.label}</span>
          <span className="ml-2 text-text-dim text-[10px] font-mono">{tema.dimension}</span>
        </span>
        <span className="text-right font-mono text-[11px] text-positive">{tema.positivas}</span>
        <span className="text-right font-mono text-[11px] text-negative">{tema.negativas}</span>
        <span className="text-right">{indiceCell(tema.positivas, tema.negativas, tema.indice, tema.total, nMin)}</span>
        <span className="text-right font-mono text-[10px] text-labs-yellow">{tema.sugerencias}</span>
      </button>
      {open && (
        <div>
          {tema.subtemas.map((sub) => (
            <SubtemaRow key={sub.subtema} sub={sub} nMin={nMin} />
          ))}
        </div>
      )}
    </div>
  );
}

const polarityDot: Record<string, string> = {
  positivo: "bg-positive",
  negativo: "bg-negative",
  neutral: "bg-neutral-sent",
  sugerencia: "bg-labs-yellow",
};

function SubtemaRow({ sub, nMin }: { sub: AccordionSubtema; nMin: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[28px_1fr_70px_70px_120px_70px] gap-2 px-3 py-1.5 pl-14 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-text-muted font-mono text-[12px]">{open ? "▾" : "›"}</span>
        <span className="text-[12px] text-text-muted font-mono">{sub.subtema}</span>
        <span className="text-right font-mono text-[11px] text-positive">{sub.positivas}</span>
        <span className="text-right font-mono text-[11px] text-negative">{sub.negativas}</span>
        <span className="text-right">{indiceCell(sub.positivas, sub.negativas, sub.indice, sub.total, nMin)}</span>
        <span className="text-right font-mono text-[10px] text-labs-yellow">{sub.sugerencias}</span>
      </button>
      {open && (
        <div className="px-3 pl-20 pb-2 space-y-1">
          {sub.comments.map((c) => (
            <div key={c.mention_id} className="flex items-start gap-2 text-[11px]">
              <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${polarityDot[c.polaridad]}`} />
              <span className="italic text-text-muted">&ldquo;{c.span}&rdquo;</span>
              <span className="text-text-dim font-mono shrink-0">{c.idioma}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
