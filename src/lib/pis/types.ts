import { DEV_CYCLE_DAYS } from "./constants";

export const PIS_PRODUCTS = [
  "PreStay",
  "OnSite",
  "FollowUp",
  "Semantic",
  "Concierge",
  "Desk",
  "Transversal",
] as const;

export type PisProduct = (typeof PIS_PRODUCTS)[number];

export type InitiativeStatus = "pre-evaluacion" | "draft" | "scored" | "archived";

export interface KpiImpact {
  kpi_id: number;
  kpi_name: string;
  impact: "alto" | "medio" | "bajo" | "high" | "medium" | "low";
  explanation: string;
}

// ---------------------------------------------------------------------------
// Rubric scoring (5 axes summing to 100)
// ---------------------------------------------------------------------------

export interface AxisScore {
  score: number; // 0..max (server-clamped)
  reasoning: string; // 1-2 sentences
}

export interface RubricBreakdown {
  directness: AxisScore;
  magnitude: AxisScore;
  evidence: AxisScore;
  strategic: AxisScore;
  delivery: AxisScore;
}

// Hypothesis quality is an educational side metric — it does NOT contribute
// to pis_score. It evaluates the prose of the hypothesis (testability,
// specificity, evidence, causal logic) and gives the user feedback on how
// to write better hypotheses.
export interface HypothesisQuality {
  score: number;    // 0..100
  feedback: string; // 2-4 sentences of educational feedback
}

export interface ScoringResult {
  rubric: RubricBreakdown;
  pis_score: number; // server-computed sum, 0..100
  hypothesis_quality: HypothesisQuality;
  kpi_impact: KpiImpact[];
  recommendation: string;
}

export { DEV_CYCLE_DAYS };

export interface PisInitiative {
  id: number;
  title: string;
  description: string;
  hypothesis: string;
  products: PisProduct[];
  author: string;
  celula: string | null;
  jornadas: number | null;
  status: InitiativeStatus;
  pis_score: number | null;
  scoring_result: ScoringResult | null;
  model_used: string | null;
  scored_at: string | null;
  created_at: string;
  updated_at: string;
}

// Summary shape used by the list & matrix views. Includes scoring_result so
// the matrix view can render per-axis cells without an extra fetch per row.
export type PisInitiativeSummary = Omit<PisInitiative, "description" | "hypothesis">;

export function effortPercent(jornadas: number | null): number | null {
  if (jornadas === null || jornadas === undefined) return null;
  return Math.round((jornadas / DEV_CYCLE_DAYS) * 100);
}

export interface CreateInitiativePayload {
  title: string;
  description: string;
  hypothesis: string;
  products: PisProduct[];
  author: string;
  celula?: string;
  jornadas?: number;
}

// Knowledge base — same dimensions as Learning/Skills radar
export const KNOWLEDGE_CATEGORIES = [
  "Online",
  "OnSite",
  "Desk",
  "FollowUp",
  "Concierge",
  "Semántico",
  "Fidelity",
  "Integraciones",
  "Corporativo",
  "Travel Tech",
  "Hotelería",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  id: number;
  category: KnowledgeCategory;
  title: string;
  content: string;
  author: string;
  created_at: string;
  updated_at: string;
}
