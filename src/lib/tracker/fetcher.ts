import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 myHotelTracker/0.1";

// TLS_ERRORS: causas típicas cuando el cert del hotel tiene cadena
// intermedia rota o CA no estándar. Autorizan un reintento con TLS
// relajado (insecure). Lo registramos en insecure_tls=true.
const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

export type FetchOk = {
  ok: true;
  status: number;
  final_url: string;
  html: string;
  content_type: string | null;
  duration_ms: number;
  insecure_tls?: boolean;
  rendered_via_browser?: boolean;
};

export type FetchErr = {
  ok: false;
  error: string;
  error_code?: string;
  status?: number;
  final_url?: string;
  duration_ms: number;
};

function extractCause(e: unknown): { code?: string; message: string } {
  if (!(e instanceof Error)) return { message: String(e) };
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  const msg =
    cause?.message ||
    (typeof code === "string" ? code : null) ||
    e.message ||
    "unknown";
  return { code, message: msg };
}

type MinimalResponse = {
  status: number;
  url: string;
  headers: { get: (key: string) => string | null };
  text: () => Promise<string>;
};

async function doFetch(
  url: string,
  timeoutMs: number,
  insecure: boolean
): Promise<MinimalResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "user-agent": DEFAULT_UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-CL,es;q=0.9,en;q=0.8",
    };
    if (insecure) {
      const r = await undiciFetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers,
        dispatcher: insecureAgent,
      });
      return {
        status: r.status,
        url: r.url,
        headers: { get: (k: string) => r.headers.get(k) },
        text: () => r.text(),
      };
    }
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Heurística: ¿el HTML fetcheado sin JS tiene tan poca señal que
// conviene reintentar con Browserless? Casos típicos:
//   - SPA sin hidratar (Next.js/React/Vue con <div id="root"></div> vacío).
//   - "Please enable JavaScript" banners.
//   - HTML <10kb (shells vacíos).
function needsJsRendering(html: string): boolean {
  if (!html) return true;
  if (html.length < 10_000) return true;
  if (/please\s+enable\s+javascript|you\s+need\s+javascript/i.test(html))
    return true;
  // Next.js SSG shell sin contenido
  if (/<div[^>]*id=["']__next["'][^>]*>\s*<\/div>/i.test(html)) return true;
  // React CRA shell
  if (/<div[^>]*id=["']root["'][^>]*>\s*<\/div>/i.test(html)) return true;
  // Vue/Nuxt shell
  if (/<div[^>]*id=["']app["'][^>]*>\s*<\/div>/i.test(html)) return true;
  return false;
}

async function fetchViaBrowserless(
  url: string,
  timeoutMs: number
): Promise<FetchOk | null> {
  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) return null;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 30000));
  try {
    // Usamos el endpoint /content de Browserless, que renderiza con JS
    // y devuelve el HTML hidratado.
    const endpoint = `https://production-sfo.browserless.io/content?token=${encodeURIComponent(
      key
    )}`;
    const res = await fetch(endpoint, {
      signal: controller.signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        waitForTimeout: 3000, // espera 3s después del load event
        userAgent: DEFAULT_UA,
        gotoOptions: { waitUntil: "networkidle2", timeout: 20_000 },
      }),
    });
    if (!res.ok) {
      console.warn(
        `[tracker.browserless] ${res.status} ${res.statusText} for ${url}`
      );
      return null;
    }
    const html = await res.text();
    return {
      ok: true,
      status: 200,
      final_url: url,
      html: html.slice(0, 2_000_000),
      content_type: "text/html",
      duration_ms: Date.now() - started,
      rendered_via_browser: true,
    };
  } catch (e) {
    console.warn(
      `[tracker.browserless] fetch failed: ${e instanceof Error ? e.message : e}`
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHtml(
  url: string,
  { timeoutMs = 15000 }: { timeoutMs?: number } = {}
): Promise<FetchOk | FetchErr> {
  const started = Date.now();
  let insecureUsed = false;

  try {
    let res: MinimalResponse;
    let browserlessFirstTry: FetchOk | null = null;
    try {
      res = await doFetch(url, timeoutMs, false);
    } catch (firstErr) {
      const info = extractCause(firstErr);
      if (info.code && TLS_ERROR_CODES.has(info.code)) {
        // Reintentamos con TLS relajado (cadena de cert rota es común en
        // hoteles independientes LatAm).
        res = await doFetch(url, timeoutMs, true);
        insecureUsed = true;
      } else {
        // Primer intento falló por algo distinto a TLS (ej. 403
        // Cloudflare). Probamos Browserless antes de rendirnos.
        browserlessFirstTry = await fetchViaBrowserless(url, timeoutMs);
        if (browserlessFirstTry) return browserlessFirstTry;
        throw firstErr;
      }
    }

    const ct = res.headers.get("content-type");
    if (ct && !/text\/html|application\/xhtml|application\/xml/i.test(ct)) {
      return {
        ok: false,
        error: `content_type_not_html: ${ct}`,
        status: res.status,
        final_url: res.url,
        duration_ms: Date.now() - started,
      };
    }

    // WAF/bot-protection: 403 con HTML mínimo → probar Browserless.
    if (res.status === 403) {
      const browserless = await fetchViaBrowserless(url, timeoutMs);
      if (browserless) return browserless;
    }

    const text = await res.text();

    // Sitio SPA sin hidratar → reintentar con Browserless para JS.
    if (needsJsRendering(text)) {
      const browserless = await fetchViaBrowserless(url, timeoutMs);
      if (browserless) return browserless;
    }

    return {
      ok: true,
      status: res.status,
      final_url: res.url,
      html: text.slice(0, 2_000_000),
      content_type: ct,
      duration_ms: Date.now() - started,
      insecure_tls: insecureUsed || undefined,
    };
  } catch (e) {
    const info = extractCause(e);
    const aborted =
      e instanceof Error && (e.name === "AbortError" || info.code === "ABORT_ERR");
    return {
      ok: false,
      error: aborted ? `timeout_${timeoutMs}ms` : info.message,
      error_code: info.code,
      duration_ms: Date.now() - started,
    };
  }
}

export function normalizeUrl(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Canonicaliza una URL a una clave estable para dedup:
 *   - host en minúsculas, sin "www."
 *   - path sin trailing slash (root "/" queda vacío)
 *   - query strings ordenados, sin trackers (utm_*, fbclid, gclid, mc_*)
 *   - fragment removido
 *   - protocolo ignorado (http y https se dedup como el mismo hotel)
 *
 * Devuelve null si el input no es una URL parseable.
 */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref|ref_source)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    return `${host}${path}${qs}`;
  } catch {
    return null;
  }
}
