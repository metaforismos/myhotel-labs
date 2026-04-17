import fs from "node:fs";
import path from "node:path";
import { detectChain } from "./chain";
import { extractResources } from "./resources";
import type {
  AnalyzeResult,
  Detection,
  Rule,
  Signature,
  SignatureType,
} from "./types";

const RULES_DIR = path.join(process.cwd(), "data", "tracker", "rules");

let cachedRules: { rules: Rule[]; loadedAt: number } | null = null;

function loadRules(): Rule[] {
  if (cachedRules && Date.now() - cachedRules.loadedAt < 60_000) {
    return cachedRules.rules;
  }
  const files = ["booking-engines.json", "cms.json", "widgets.json"];
  const rules: Rule[] = [];
  for (const f of files) {
    const p = path.join(RULES_DIR, f);
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Rule[];
      rules.push(...parsed);
    } catch (err) {
      console.error(`[tracker.detector] failed to parse ${f}:`, err);
    }
  }
  cachedRules = { rules, loadedAt: Date.now() };
  return rules;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITY_MAP[n.toLowerCase()] ?? m);
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const decoded = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return decoded.slice(0, 300) || null;
}

function extractMetaGenerator(html: string): string | null {
  const m = html.match(
    /<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i
  );
  if (m) return m[1];
  const m2 = html.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']generator["']/i
  );
  return m2 ? m2[1] : null;
}

function extractAttrs(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`,
    "gi"
  );
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out.push(match[1]);
    if (out.length > 500) break;
  }
  return out;
}

function extractAnchorHrefs(html: string): string[] {
  return extractAttrs(html, "a", "href");
}

function extractAnchors(html: string): { href: string; text: string }[] {
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: { href: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < 1000) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ href: m[1], text: text.slice(0, 200) });
    count++;
  }
  return out;
}

function extractFormActions(html: string): string[] {
  return extractAttrs(html, "form", "action");
}

function classifyOutbound(href: string, baseHost: string): string | null {
  try {
    const u = new URL(href, `https://${baseHost}`);
    if (!u.hostname || u.hostname === baseHost) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function matchSignature(
  sig: Signature,
  bag: {
    html: string;
    script_srcs: string[];
    iframe_srcs: string[];
    link_hrefs: string[];
    meta_generator: string | null;
  }
): string | null {
  let re: RegExp;
  try {
    re = new RegExp(sig.pattern, "i");
  } catch {
    return null;
  }

  switch (sig.type) {
    case "script_src":
      for (const s of bag.script_srcs) if (re.test(s)) return s;
      return null;
    case "iframe_src":
      for (const s of bag.iframe_srcs) if (re.test(s)) return s;
      return null;
    case "link_href":
      for (const s of bag.link_hrefs) if (re.test(s)) return s;
      return null;
    case "meta_generator":
      return bag.meta_generator && re.test(bag.meta_generator)
        ? bag.meta_generator
        : null;
    case "html": {
      const m = bag.html.match(re);
      return m ? m[0].slice(0, 200) : null;
    }
  }
}

function confidenceFor(rule: Rule, hits: number): number {
  if (hits <= 0) return 0;
  const bonus = Math.min(0.1, (hits - 1) * 0.03);
  return Math.min(0.99, rule.confidence_base + bonus);
}

export function detect(
  html: string,
  finalUrl: string
): Omit<AnalyzeResult, "url" | "fetched_at" | "duration_ms" | "status"> {
  const rules = loadRules();
  const title = extractTitle(html);
  const meta_generator = extractMetaGenerator(html);
  const script_srcs = extractAttrs(html, "script", "src");
  const iframe_srcs = extractAttrs(html, "iframe", "src");
  const link_hrefs = extractAttrs(html, "link", "href");
  const form_actions = extractFormActions(html);
  const anchor_hrefs = extractAnchorHrefs(html);
  const anchors = extractAnchors(html);

  let baseHost = "";
  try {
    baseHost = new URL(finalUrl).hostname;
  } catch {
    /* ignore */
  }

  const outbound_links = Array.from(
    new Set(
      anchor_hrefs
        .map((h) => classifyOutbound(h, baseHost))
        .filter((x): x is string => Boolean(x))
    )
  ).slice(0, 500);

  const detections: Detection[] = [];
  const bag = { html, script_srcs, iframe_srcs, link_hrefs, meta_generator };

  for (const rule of rules) {
    const evidence: Detection["evidence"] = [];
    for (const sig of rule.signatures) {
      const matched = matchSignature(sig, bag);
      if (matched) {
        evidence.push({
          signature_type: sig.type as SignatureType,
          pattern: sig.pattern,
          matched,
        });
      }
    }
    if (evidence.length > 0) {
      detections.push({
        rule_id: rule.id,
        vendor: rule.vendor,
        product: rule.product,
        category: rule.category,
        confidence: confidenceFor(rule, evidence.length),
        detected_via: "rule",
        evidence,
      });
    }
  }

  detections.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return b.confidence - a.confidence;
  });

  const resources = extractResources({
    html,
    finalUrl,
    script_srcs,
    iframe_srcs,
    link_hrefs,
    form_actions,
    anchors,
    detections,
  });

  const chain = detectChain({ html, anchors });

  return {
    final_url: finalUrl,
    title,
    meta_generator,
    script_srcs: script_srcs.slice(0, 100),
    iframe_srcs: iframe_srcs.slice(0, 100),
    link_hrefs: link_hrefs.slice(0, 100),
    outbound_links,
    detections,
    resources,
    chain,
  };
}
