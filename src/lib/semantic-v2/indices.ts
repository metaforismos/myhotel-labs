// Agregación e índice semántico. SIN LLM. Reglas:
//   - Índice = positivos / (positivos + negativos). Neutrales y sugerencias NO entran al cálculo.
//     Ejemplo del PO: 90 pos / 10 neg → 90% = 90/(90+10). Con neutrales adentro se distorsiona.
//   - N mínimo (default 5 en el proto; ≥20 en prod): bajo umbral, mostrar conteo + ejemplos, no %.
//   - Sugerencias se muestran aparte (badge "N sugerencias"), nunca castigan el índice.
//   - MECE: cada mención tiene exactamente una área primaria, una dimensión y un subtema.
//     Total del padre = suma de hijos. Hay assert que verifica esto.

import { activeDimensions, getTema, ALL_AREAS } from "./taxonomy";
import {
  AccordionLeafComment,
  AccordionLens,
  AccordionRoot,
  AccordionSubtema,
  AccordionTema,
  AccordionTree,
  Mention,
} from "./types";

export const DEFAULT_N_MINIMO = 5;

export interface Tally {
  positivas: number;
  negativas: number;
  neutrales: number;
  sugerencias: number;
  total: number;
  indice: number | null;
}

export function emptyTally(): Tally {
  return { positivas: 0, negativas: 0, neutrales: 0, sugerencias: 0, total: 0, indice: null };
}

export function addToTally(t: Tally, p: Mention["polaridad"]): void {
  if (p === "positivo") t.positivas++;
  else if (p === "negativo") t.negativas++;
  else if (p === "neutral") t.neutrales++;
  else if (p === "sugerencia") t.sugerencias++;
  t.total = t.positivas + t.negativas + t.neutrales + t.sugerencias;
  t.indice = computeIndice(t.positivas, t.negativas);
}

export function computeIndice(pos: number, neg: number): number | null {
  const denom = pos + neg;
  if (denom === 0) return null;
  return pos / denom;
}

// Aplica la regla de N mínimo: si pos + neg < nMin, el índice se considera "no confiable".
// El llamador decide si mostrar % o conteo+ejemplo. Esta función solo dice "ok mostrar".
export function isIndexConfiable(pos: number, neg: number, nMin: number): boolean {
  return pos + neg >= nMin;
}

// ── Construcción del árbol del acordeón ──────────────────────────────────────
// Por Área: agrupa por area_primary → tema → subtema.
// Por Dimensión: agrupa por dimension (slug o nombre) → tema → subtema.
// En ambos casos: solo menciones NO propuestas (las propuestas no entran al índice;
// van al panel de descubrimiento).

interface BuildArgs {
  mentions: Mention[];
  lens: AccordionLens;
  nMin?: number;
}

export function buildAccordion({ mentions, lens, nMin = DEFAULT_N_MINIMO }: BuildArgs): AccordionTree {
  // Estructura intermedia: rootKey → temaTag → subtemaKey
  const tree = new Map<string, {
    label: string;
    tally: Tally;
    temas: Map<string, {
      label: string;
      dimension: string;
      tally: Tally;
      subtemas: Map<string, {
        label: string;
        tally: Tally;
        comments: AccordionLeafComment[];
        propuesto: boolean;
      }>;
    }>;
  }>();

  for (const m of mentions) {
    // Skip propuestos sin área canónica (van al descubrimiento, no al índice).
    if (m.propuesto || !m.area_primary || !m.tema) continue;
    const tema = getTema(m.tema);
    if (!tema) continue;

    const rootKey =
      lens === "area"
        ? String(m.area_primary.area_id)
        : (tema.dimension_slug ?? tema.dimension.toLowerCase());
    const rootLabel = lens === "area" ? m.area_primary.es : tema.dimension;

    if (!tree.has(rootKey)) {
      tree.set(rootKey, { label: rootLabel, tally: emptyTally(), temas: new Map() });
    }
    const root = tree.get(rootKey)!;
    addToTally(root.tally, m.polaridad);

    if (!root.temas.has(tema.tag)) {
      root.temas.set(tema.tag, {
        label: tema.labels.es,
        dimension: tema.dimension,
        tally: emptyTally(),
        subtemas: new Map(),
      });
    }
    const t = root.temas.get(tema.tag)!;
    addToTally(t.tally, m.polaridad);

    const subKey = m.subtema.toLowerCase();
    if (!t.subtemas.has(subKey)) {
      t.subtemas.set(subKey, {
        label: m.subtema,
        tally: emptyTally(),
        comments: [],
        propuesto: false,
      });
    }
    const sub = t.subtemas.get(subKey)!;
    addToTally(sub.tally, m.polaridad);
    sub.comments.push({
      mention_id: m.id,
      review_id: m.review_id,
      span: m.span,
      polaridad: m.polaridad,
      intensidad: m.intensidad,
      idioma: m.idioma,
    });
  }

  // Serializar a la forma que consume la UI.
  const roots: AccordionRoot[] = Array.from(tree.entries())
    .map(([key, r]) => ({
      key,
      label: r.label,
      ...r.tally,
      temas: Array.from(r.temas.entries())
        .map(([tag, t]) => ({
          tag,
          label: t.label,
          dimension: t.dimension,
          ...t.tally,
          subtemas: Array.from(t.subtemas.entries())
            .map(([, s]) => ({
              subtema: s.label,
              label: s.label,
              ...s.tally,
              propuesto: s.propuesto,
              comments: s.comments,
            } as AccordionSubtema))
            .sort((a, b) => b.total - a.total),
        } as AccordionTema))
        .sort((a, b) => b.total - a.total),
    } as AccordionRoot))
    .sort((a, b) => b.total - a.total);

  const mece_violations = assertMece(roots);

  return { lens, roots, n_minimo: nMin, mece_violations };
}

// Assert MECE: total del padre = suma de hijos (en pos/neg/neutral/sug y total).
// Devuelve array vacío si todo cuadra. Cualquier discrepancia = mis-mapeo en la tabla
// (no es bug de UI, es un descubrimiento que el PRD pide que se vea).
export function assertMece(roots: AccordionRoot[]): string[] {
  const violations: string[] = [];
  const fields = ["positivas", "negativas", "neutrales", "sugerencias", "total"] as const;

  for (const root of roots) {
    for (const f of fields) {
      const childSum = root.temas.reduce((acc, t) => acc + t[f], 0);
      if (childSum !== root[f]) {
        violations.push(`Área ${root.label}.${f}: padre=${root[f]} ≠ Σ temas=${childSum}`);
      }
    }
    for (const tema of root.temas) {
      for (const f of fields) {
        const subSum = tema.subtemas.reduce((acc, s) => acc + s[f], 0);
        if (subSum !== tema[f]) {
          violations.push(`Tema ${tema.label}.${f}: padre=${tema[f]} ≠ Σ subtemas=${subSum}`);
        }
      }
    }
  }
  return violations;
}

// Ranking de subtemas a través del lote (para el header del Resumen / chips top).
export interface SubtemaRankRow {
  subtema: string;
  positivas: number;
  negativas: number;
  total: number;
  indice: number | null;
}
export function rankSubtemas(mentions: Mention[]): SubtemaRankRow[] {
  const map = new Map<string, SubtemaRankRow>();
  for (const m of mentions) {
    if (m.propuesto) continue;
    const key = m.subtema.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { subtema: m.subtema, positivas: 0, negativas: 0, total: 0, indice: null });
    }
    const row = map.get(key)!;
    if (m.polaridad === "positivo") row.positivas++;
    else if (m.polaridad === "negativo") row.negativas++;
    row.total++;
    row.indice = computeIndice(row.positivas, row.negativas);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// KPIs globales del lote para el header.
export interface BatchSummary {
  reviews: number;
  mentions: number;
  positivas: number;
  negativas: number;
  neutrales: number;
  sugerencias: number;
  propuestos: number;
  indice_global: number | null;
  dimensiones_activas: number;
}

export function summarize(mentions: Mention[], reviewCount: number, enabledAreaIds: Set<number>): BatchSummary {
  let positivas = 0, negativas = 0, neutrales = 0, sugerencias = 0, propuestos = 0;
  for (const m of mentions) {
    if (m.propuesto) propuestos++;
    if (m.polaridad === "positivo") positivas++;
    else if (m.polaridad === "negativo") negativas++;
    else if (m.polaridad === "neutral") neutrales++;
    else if (m.polaridad === "sugerencia") sugerencias++;
  }
  return {
    reviews: reviewCount,
    mentions: mentions.length,
    positivas, negativas, neutrales, sugerencias, propuestos,
    indice_global: computeIndice(positivas, negativas),
    dimensiones_activas: activeDimensions(enabledAreaIds).length,
  };
}

// Helper para chequear áreas no habilitadas que reciben menciones (oportunidad de activar).
export interface UnenabledAreaHit {
  area_id: number;
  area_label: string;
  count: number;
}
export function unenabledAreasMentioned(
  mentions: Mention[],
  enabledAreaIds: Set<number>,
): UnenabledAreaHit[] {
  // Las propuestas pueden traer tema canónico cuyo área no está habilitada
  // (rollup las degradó). Las contamos para "tu huésped habla de área X, ¿activamos?".
  const hits = new Map<number, UnenabledAreaHit>();
  for (const m of mentions) {
    if (!m.tema || !m.propuesto) continue;
    const t = getTema(m.tema);
    if (!t) continue;
    if (enabledAreaIds.has(t.area_primary.area_id)) continue;
    const id = t.area_primary.area_id;
    if (!hits.has(id)) {
      const a = ALL_AREAS.find((x) => x.area_id === id);
      hits.set(id, { area_id: id, area_label: a?.es ?? t.area_primary.es, count: 0 });
    }
    hits.get(id)!.count++;
  }
  return Array.from(hits.values()).sort((a, b) => b.count - a.count);
}
