"use client";

import { Mention } from "@/lib/semantic-v2/types";

const polarityColor: Record<Mention["polaridad"], string> = {
  positivo: "bg-positive-muted text-positive border-positive/40",
  negativo: "bg-negative-muted text-negative border-negative/40",
  neutral: "bg-neutral-muted text-neutral-sent border-neutral-sent/40",
  sugerencia: "bg-labs-yellow-bg text-labs-yellow border-labs-yellow/40",
};

interface Props {
  text: string;
  mentions: Mention[];
  activeMentionId?: string | null;
  onHoverMention?: (id: string | null) => void;
}

// Resalta spans dentro del texto sin perder partes no anotadas.
// Si dos spans se solapan, gana el primero que aparezca en `mentions`.
export function HighlightedText({ text, mentions, activeMentionId, onHoverMention }: Props) {
  type Seg = { start: number; end: number; mention?: Mention };
  const segs: Seg[] = [];
  const occupied: Array<{ s: number; e: number }> = [];

  for (const m of mentions) {
    const span = m.span?.trim();
    if (!span) continue;
    const idx = text.indexOf(span);
    if (idx < 0) continue;
    const s = idx, e = idx + span.length;
    // Skip si solapa con uno ya tomado
    if (occupied.some((o) => !(e <= o.s || s >= o.e))) continue;
    occupied.push({ s, e });
    segs.push({ start: s, end: e, mention: m });
  }

  segs.sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.start > cursor) out.push(<span key={`g${i}`}>{text.slice(cursor, seg.start)}</span>);
    const m = seg.mention!;
    const isActive = activeMentionId === m.id;
    out.push(
      <mark
        key={m.id}
        onMouseEnter={() => onHoverMention?.(m.id)}
        onMouseLeave={() => onHoverMention?.(null)}
        className={`px-0.5 rounded border-b-2 transition-colors cursor-default ${polarityColor[m.polaridad]} ${isActive ? "ring-2 ring-accent/40" : ""}`}
        title={`${m.subtema} · ${m.dimension} · ${m.polaridad}`}
      >
        {text.slice(seg.start, seg.end)}
      </mark>,
    );
    cursor = seg.end;
  }
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);

  return <p className="text-sm text-text leading-relaxed">{out}</p>;
}
