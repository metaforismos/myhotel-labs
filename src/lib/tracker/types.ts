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
  detected_via: "rule" | "wappalyzer" | "llm" | "manual" | "self_hosted";
  evidence: {
    signature_type: SignatureType | "form_action" | "internal_anchor" | "url_extension";
    pattern: string;
    matched: string;
  }[];
};

export type AgencyInfo = {
  name: string;
  url: string | null;
  phrase: string;
  confidence: number;
};

export type SelfHostedSignal = {
  kind: "form" | "internal_anchor" | "extension";
  evidence: string;
  label: string; // "Custom / self-hosted", "Custom (PHP)", etc.
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
  agency: AgencyInfo | null;
  self_hosted_booking: SelfHostedSignal | null;
  self_hosted_cms: SelfHostedSignal | null;
  // Surfaced structural data
  script_srcs: string[];
  iframe_srcs: string[];
  link_hrefs: string[];
  outbound_links: string[];
};
