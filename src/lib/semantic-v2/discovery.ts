// Descubrimiento de subtemas propuestos.
// El PRD pide "similitud simple" sin embeddings. Implementamos:
//   - Jaccard de tokens (caracteres y palabras) entre el propuesto y los 236 subtemas neutros.
//   - Levenshtein normalizado como tie-breaker.
// Threshold 0.7 sobre el score combinado → sugerir merge.
// Importante: comparamos contra los 236 completos, no solo los 85 del prompt
// (si no, "descubrimos" cosas que ya están en la cola larga del seed).

import { ALL_SUBTEMAS } from "./taxonomy";

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function normalizedLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export interface SimilarityHit {
  subtema: string;
  label: string;
  score: number;
  jaccard_score: number;
  lev_score: number;
}

export const SIMILARITY_THRESHOLD = 0.7;

// Compara un subtema propuesto contra los 236 del seed y devuelve el top match
// si supera el threshold. null si todos están por debajo.
export function findSimilar(proposedSubtema: string): SimilarityHit | null {
  const propNorm = proposedSubtema
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  const propTokens = tokenize(proposedSubtema);

  let best: SimilarityHit | null = null;

  for (const s of ALL_SUBTEMAS) {
    const candKey = s.subtema.toLowerCase();
    const candTokens = tokenize(s.subtema);

    const j = jaccard(propTokens, candTokens);
    const l = normalizedLevenshtein(propNorm, candKey);
    // Combinación: pondera más Jaccard pero Levenshtein agarra typos / variantes morfológicas.
    const score = j * 0.6 + l * 0.4;

    if (!best || score > best.score) {
      best = {
        subtema: s.subtema,
        label: s.label_es ?? s.subtema,
        score,
        jaccard_score: j,
        lev_score: l,
      };
    }
  }

  if (best && best.score >= SIMILARITY_THRESHOLD) return best;
  return null;
}

// Para el panel: agrega todos los propuestos únicos con sus matches.
export interface ProposedAggregate {
  subtema: string;
  count: number;
  examples: string[]; // hasta 3 spans
  similar_to: SimilarityHit | null;
}

export function aggregateProposed(
  mentions: { subtema: string; span: string; propuesto: boolean }[],
): ProposedAggregate[] {
  const map = new Map<string, ProposedAggregate>();
  for (const m of mentions) {
    if (!m.propuesto) continue;
    const key = m.subtema.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        subtema: m.subtema,
        count: 0,
        examples: [],
        similar_to: findSimilar(m.subtema),
      });
    }
    const agg = map.get(key)!;
    agg.count++;
    if (agg.examples.length < 3) agg.examples.push(m.span);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
