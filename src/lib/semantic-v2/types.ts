// Semantic v2 — tipos del prototipo (aislado, no comparte con v1).
// El átomo es la Mention: una opinión anclada a un span del huésped.

export type Idioma = "es" | "en" | "pt";
export type Polaridad = "positivo" | "negativo" | "neutral" | "sugerencia";
export type Intensidad = "leve" | "moderada" | "fuerte";
export type Touchpoint = "OnSite" | "FollowUp" | "Online" | "Concierge";
export type TipoArea = "universal" | "instalacion";

export interface AreaRef {
  area_id: number;
  es: string;
}

export interface Area {
  area_id: number;
  es: string;
  en: string;
  pt: string;
  tipo: TipoArea;
}

export interface Tema {
  tag: string;
  dimension: string;
  dimension_slug: string | null;
  area_primary: AreaRef;
  areas_secondary: AreaRef[];
  labels: { es: string; en: string; pt: string };
  // flags opcionales del seed v2:
  consolidar?: boolean;
  nuevo?: boolean;
}

export interface Subtema {
  subtema: string;
  label_es?: string;
  usage_count: number;
  cumulative_percentage: number;
  in_pareto_90: boolean;
  area_sugerida: string | null;
  dimensiones_observadas: string[];
  polaridades_observadas: string[];
  temas_candidatos: string[];
  needs_curation: boolean;
}

// Lo que devuelve el LLM (contrato del prompt). Sin id, sin área (la pone el rollup).
export interface MentionFromLLM {
  span: string;
  subtema: string;
  tema: string | null;
  dimension: string;
  polaridad: Polaridad;
  intensidad: Intensidad;
  confianza: number;
  idioma: Idioma;
  propuesto: boolean;
}

// Mention final, post-rollup. La que vive en el state de la UI.
export interface Mention {
  id: string;
  review_id: string;
  // del LLM (puede ser overrideado):
  span: string;
  subtema: string;
  tema: string | null; // tag canónico
  // determinístico (rollup):
  dimension: string; // determinístico si tema != null; del LLM si propuesto
  area_primary: AreaRef | null; // null si propuesto
  areas_secondary: AreaRef[]; // referencia, NO cuentan al índice
  polaridad: Polaridad;
  intensidad: Intensidad;
  confianza: number;
  idioma: Idioma;
  propuesto: boolean;
  // ux:
  touchpoint: Touchpoint;
  similar_to?: { subtema: string; score: number } | null; // sugerencia de merge si propuesto
  override?: boolean; // si el usuario editó algún campo
}

export interface ReviewBatch {
  id: string;
  text: string;
  idioma: Idioma;
  touchpoint: Touchpoint;
  mentions: Mention[];
  // metadata de tracking:
  analyzed_at: number;
}

// Estructura del acordeón (Resumen). Misma forma para Por-Área y Por-Dimensión.
export interface AccordionLeafComment {
  mention_id: string;
  review_id: string;
  span: string;
  polaridad: Polaridad;
  intensidad: Intensidad;
  idioma: Idioma;
}

export interface AccordionSubtema {
  subtema: string;
  label: string;
  positivas: number;
  negativas: number;
  neutrales: number;
  sugerencias: number;
  total: number; // pos + neg + neutral + sugerencia
  indice: number | null; // pos / (pos + neg); null si denom = 0
  propuesto: boolean;
  comments: AccordionLeafComment[];
}

export interface AccordionTema {
  tag: string;
  label: string;
  dimension: string;
  positivas: number;
  negativas: number;
  neutrales: number;
  sugerencias: number;
  total: number;
  indice: number | null;
  subtemas: AccordionSubtema[];
}

export interface AccordionRoot {
  key: string; // area_id o dimension_slug
  label: string;
  positivas: number;
  negativas: number;
  neutrales: number;
  sugerencias: number;
  total: number;
  indice: number | null;
  temas: AccordionTema[];
}

export type AccordionLens = "area" | "dimension";

export interface AccordionTree {
  lens: AccordionLens;
  roots: AccordionRoot[];
  n_minimo: number;
  // assert helper: si el árbol está MECE bien armado, padre = Σ hijos.
  // Devuelve un array vacío si todo cuadra, o problemas concretos si rompe.
  mece_violations: string[];
}
