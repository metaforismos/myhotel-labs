export type DetectionCategory =
  | "cms"
  | "booking_engine"
  | "pms"
  | "channel_mgr"
  | "analytics"
  | "chat"
  | "reviews"
  | "ads"
  | "other";

export type SignatureType =
  | "script_src"
  | "iframe_src"
  | "link_href"
  | "meta_generator"
  | "html";

export type Signature = {
  type: SignatureType;
  pattern: string;
};

export type Rule = {
  id: string;
  vendor: string;
  product: string;
  category: DetectionCategory;
  confidence_base: number;
  signatures: Signature[];
};

export type Detection = {
  rule_id: string;
  vendor: string;
  product: string;
  category: DetectionCategory;
  confidence: number;
  detected_via: "rule" | "wappalyzer" | "llm" | "manual";
  evidence: {
    signature_type: SignatureType;
    pattern: string;
    matched: string;
  }[];
};

export type ResourceRole =
  | "booking_engine"
  | "cms"
  | "analytics"
  | "chat"
  | "reviews"
  | "ads"
  | "cdn"
  | "fonts"
  | "maps"
  | "video"
  | "social"
  | "pms"
  | "channel_mgr"
  | "ota"
  | "consent"
  | "other"
  | "unknown";

export type ResourceContext = {
  type: SignatureType | "anchor_href" | "form_action";
  url: string;
  snippet?: string;
};

export type RawResource = {
  host: string;
  registrable_domain: string;
  role_hint: ResourceRole;
  vendor_name?: string | null;
  vendor_product?: string | null;
  classified_by?: "rule" | null;
  contexts: ResourceContext[];
};

export type ChainInfo = {
  is_chain: boolean;
  property_count_estimate: number | null;
  signals: string[];
};

export type AnalyzeResult = {
  url: string;
  final_url: string;
  status: number;
  fetched_at: string;
  duration_ms: number;
  title: string | null;
  meta_generator: string | null;
  detections: Detection[];
  resources: RawResource[];
  chain: ChainInfo;
  // Surfaced structural data
  script_srcs: string[];
  iframe_srcs: string[];
  link_hrefs: string[];
  outbound_links: string[];
};
