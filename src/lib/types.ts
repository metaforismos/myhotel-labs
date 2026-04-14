export interface Subtopic {
  subtopic: string;
  area: string;
  dimension: string;
  default_polarity: "positive" | "negative" | "context-dependent";
  status?: "active" | "proposed" | "rejected";
}

export interface Mention {
  id: string;
  original_text: string;
  subtopic: string | null;
  topic: string | null;
  area: string;
  dimension: string | null;
  polarity: "positive" | "negative" | "neutral";
  intensity: "mild" | "moderate" | "strong";
  confidence: number;
  extraction_tier: "subtopic" | "topic" | "area";
  proposed_subtopic: string | null;
  proposed_area: string | null;
  proposed_dimension: string | null;
}

export interface ReviewAnalysis {
  id: string;
  raw_text: string;
  source_language: string;
  mentions: Mention[];
  overall_sentiment: {
    polarity: "positive" | "negative" | "neutral" | "mixed";
    score: number;
  };
  processing_time_ms: number;
  model_used: string;
}

export interface ProposalValidation {
  is_valid: boolean;
  reason: string;
  recommended_subtopic: string;
  recommended_area: string;
  recommended_dimension: string;
  recommended_default_polarity: "positive" | "negative" | "context-dependent";
  closest_existing: Array<{
    subtopic: string;
    similarity: string;
  }>;
  merge_suggestion: string | null;
}

export interface SampleReview {
  id: string;
  language: string;
  text: string;
}

export const AREAS = [
  "Room", "Bathroom", "Housekeeping", "F&B", "Staff", "Front Desk",
  "Facilities", "Pool & Beach", "Spa & Wellness", "Entertainment",
  "Location", "Value", "General Experience", "Safety & Security",
  "Noise", "Maintenance", "Technology", "Accessibility",
  "Parking & Transport", "Sustainability", "Kids & Family",
  "Pet Policy", "Laundry",
] as const;

export const DIMENSIONS = [
  "Service Quality", "Cleanliness", "Condition", "Availability",
  "Aesthetics", "Size", "Food Quality", "Speed", "Value",
  "Comfort", "Ambiance", "Temperature", "Convenience",
  "Variety", "Noise", "Safety", "Sustainability",
] as const;

export type Area = (typeof AREAS)[number];
export type Dimension = (typeof DIMENSIONS)[number];

// Model configuration
export type ModelProvider = "claude" | "gemini" | "openai";

export interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  modelId: string;
  description: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "claude-haiku",
    label: "Claude Haiku 3.5",
    provider: "claude",
    modelId: "claude-haiku-4-5-20251001",
    description: "Fast extraction — Anthropic",
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4",
    provider: "claude",
    modelId: "claude-sonnet-4-20250514",
    description: "High reasoning — Anthropic",
  },
  {
    id: "gemini-flash",
    label: "Gemini 2.5 Flash",
    provider: "gemini",
    modelId: "gemini-2.5-flash",
    description: "Fast & capable — Google",
  },
  {
    id: "gemini-pro",
    label: "Gemini 2.5 Pro",
    provider: "gemini",
    modelId: "gemini-2.5-pro",
    description: "High reasoning — Google",
  },
  {
    id: "openai-gpt4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    modelId: "gpt-4o-mini",
    description: "Fast & affordable — OpenAI",
  },
];

export function getModelOption(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
