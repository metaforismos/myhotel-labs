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

export type InitiativeStatus = "draft" | "scored" | "archived";

export interface KpiImpact {
  kpi_id: number;
  kpi_name: string;
  impact: "alto" | "medio" | "bajo" | "high" | "medium" | "low";
  explanation: string;
}

export interface ScoringResult {
  pis_score: number;
  score_criteria: string;
  hypothesis_score: number;
  hypothesis_feedback: string;
  kpi_impact: KpiImpact[];
  recommendation: string;
}

export interface PisInitiative {
  id: number;
  title: string;
  description: string;
  hypothesis: string;
  products: PisProduct[];
  author: string;
  status: InitiativeStatus;
  pis_score: number | null;
  hypothesis_score: number | null;
  scoring_result: ScoringResult | null;
  model_used: string | null;
  scored_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PisInitiativeSummary = Omit<
  PisInitiative,
  "scoring_result" | "description" | "hypothesis"
>;

export interface CreateInitiativePayload {
  title: string;
  description: string;
  hypothesis: string;
  products: PisProduct[];
  author: string;
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
