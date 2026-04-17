"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type JobRow = {
  id: string;
  label: string | null;
  total: number;
  status: "created" | "running" | "done" | "error";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  done: number;
  failed: number;
  pending: number;
};

type StackCell = {
  vendor: string | null;
  product: string | null;
  domain: string | null;
  source: "rule" | "resource" | null;
  needs_classification: boolean;
};

type Item = {
  id: string;
  idx: number;
  url: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error" | "skipped";
  hotel_id: string | null;
  result_summary: {
    final_url?: string;
    status?: number;
    duration_ms?: number;
    title?: string;
    detections_count?: number;
    resources_count?: number;
    insecure_tls?: boolean;
    is_chain?: boolean;
    property_count_estimate?: number | null;
    chain_signals?: string[];
    agency?: {
      name: string;
      url: string | null;
      confidence: number;
    } | null;
    categories?: string[];
    booking_engine?: string | null;
    cms?: string | null;
    pms?: string | null;
    chat?: string | null;
    reviews?: string | null;
    ads?: string | null;
    analytics?: string | null;
    stack?: Partial<Record<string, StackCell>>;
  } | null;
  error: string | null;
};

type JobDetail = {
  job: JobRow;
  items: Item[];
  counts: {
    pending: number;
    running: number;
    done: number;
    error: number;
    skipped: number;
  };
};

function parseCsvLine(line: string, sep: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === sep || ch === "\t") && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

type ParsedItem = {
  url: string;
  name?: string;
  city?: string;
  country?: string;
  region?: string;
  external_id?: string;
  is_customer?: boolean;
};

// Limpia un string y devuelve una URL normalizada absoluta, o null si
// no se puede extraer. Tolerante con: BOM, quotes Excel, whitespace
// invisible, markdown, fragment, puntuación final, scheme faltante.
function cleanUrl(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw);
  // Strip BOM + zero-width
  s = s.replace(/[\uFEFF\u200B-\u200F\u202A-\u202E]/g, "");
  s = s.trim();
  // Strip surrounding quotes/backticks
  s = s.replace(/^["'`«]+|["'`»]+$/g, "").trim();
  // Markdown link [text](url)
  const md = s.match(/\]\((https?:\/\/\S+?)\)/i);
  if (md) s = md[1];
  // Extract first URL-looking substring from free text
  const urlMatch = s.match(/https?:\/\/\S+/i);
  if (urlMatch) s = urlMatch[0];
  // If still no scheme, accept domain-like strings and prepend https://
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9][a-z0-9\-._]*\.[a-z]{2,}(\/|$|\?|#)/i.test(s)) return null;
    s = "https://" + s;
  }
  // Strip trailing punctuation not part of URL
  s = s.replace(/[\s.,;:\)\]>»"'`]+$/g, "");
  // Lowercase the scheme
  s = s.replace(/^HTTPS:\/\//i, "https://").replace(/^HTTP:\/\//i, "http://");
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
    u.hash = ""; // drop fragment
    return u.toString();
  } catch {
    return null;
  }
}

// Clave canónica para dedupe: host sin www. + path sin trailing slash +
// query ordenada. Protocolo ignorado (http vs https son el mismo hotel).
function dedupKey(absUrl: string): string {
  try {
    const u = new URL(absUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|fbclid|gclid|mc_)/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    return `${host}${path}${qs}`;
  } catch {
    return absUrl.toLowerCase();
  }
}

function detectSeparator(firstLine: string): string {
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

const URL_COL_NAMES = /^(url|urls|link|enlace|website|sitio|site|domain|dominio|web)$/i;
const OPTIONAL_COL_NAMES: Record<string, keyof ParsedItem> = {
  name: "name",
  nombre: "name",
  city: "city",
  ciudad: "city",
  country: "country",
  pais: "country",
  region: "region",
  estado: "region",
  external_id: "external_id",
  id_hotel: "external_id",
  is_customer: "is_customer",
  cliente: "is_customer",
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

type ParseSummary = {
  items: ParsedItem[];
  invalid: { raw: string; reason: string }[];
  duplicates: number;
  source: "url_list" | "csv";
};

function parseCsvOrUrlList(raw: string): ParseSummary {
  const clean = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = clean.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    return { items: [], invalid: [], duplicates: 0, source: "url_list" };
  }

  const sep = detectSeparator(lines[0]);
  const firstFields = parseCsvLine(lines[0], sep).map((h) => h.replace(/^["']+|["']+$/g, ""));

  // Detect if first row looks like a header: ALL fields are non-URL-like
  // short strings, AND at least one matches a known column name.
  const firstLooksLikeHeader =
    firstFields.length > 0 &&
    firstFields.every((f) => !/^https?:\/\//i.test(f) && f.length < 40) &&
    firstFields.some((f) => {
      const n = normalizeHeader(f);
      return URL_COL_NAMES.test(n) || n in OPTIONAL_COL_NAMES;
    });

  const items: ParsedItem[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const addItem = (url: string | null, rawStr: string, extra: Partial<ParsedItem> = {}) => {
    if (!url) {
      invalid.push({ raw: rawStr.slice(0, 100), reason: "no_valid_url" });
      return;
    }
    const key = dedupKey(url);
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    items.push({ url, ...extra });
  };

  if (firstLooksLikeHeader) {
    const headers = firstFields.map((h) => normalizeHeader(h));
    const urlIdx = headers.findIndex((h) => URL_COL_NAMES.test(h));
    const colIdx: Partial<Record<keyof ParsedItem, number>> = {};
    headers.forEach((h, i) => {
      const mapped = OPTIONAL_COL_NAMES[h];
      if (mapped) colIdx[mapped] = i;
    });

    // Fallback: if header detected but no URL column, take the first column.
    const effectiveUrlIdx = urlIdx >= 0 ? urlIdx : 0;

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i], sep);
      const rawCell = row[effectiveUrlIdx] ?? "";
      const url = cleanUrl(rawCell);
      const extra: Partial<ParsedItem> = {};
      for (const [k, idx] of Object.entries(colIdx) as [keyof ParsedItem, number][]) {
        const v = row[idx];
        if (!v) continue;
        if (k === "is_customer") {
          const lv = v.toLowerCase().trim();
          if (/^(true|1|si|sí|yes)$/.test(lv)) extra.is_customer = true;
          else if (/^(false|0|no)$/.test(lv)) extra.is_customer = false;
        } else {
          extra[k] = v as never;
        }
      }
      addItem(url, lines[i], extra);
    }
    return { items, invalid, duplicates, source: "csv" };
  }

  // No header: treat every line as potentially holding a URL.
  // If line has separator, take the first field that cleans into a URL.
  for (const line of lines) {
    let found: string | null = null;
    const cells = line.includes(sep) || line.includes("\t")
      ? parseCsvLine(line, sep)
      : [line];
    for (const cell of cells) {
      const u = cleanUrl(cell);
      if (u) {
        found = u;
        break;
      }
    }
    addItem(found, line);
  }
  return { items, invalid, duplicates, source: "url_list" };
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TrackerBulk() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);

  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParseSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [autoClassify, setAutoClassify] = useState(true);
  const [classifyMsg, setClassifyMsg] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const runningRef = useRef(false);
  const classifyFiredRef = useRef<string | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await fetch("/api/tracker/bulk");
    if (r.ok) {
      const d = await r.json();
      setJobs(d.jobs || []);
    }
  }, []);

  const loadJobDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/tracker/bulk/${id}`);
    if (r.ok) setActiveJob(await r.json());
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!activeJobId) {
      setActiveJob(null);
      return;
    }
    loadJobDetail(activeJobId);
  }, [activeJobId, loadJobDetail]);

  const handleParse = () => {
    setParsed(parseCsvOrUrlList(raw));
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setRaw(text);
    setParsed(parseCsvOrUrlList(text));
  };

  const handleCreate = async () => {
    if (!parsed?.items.length) return;
    setCreating(true);
    setRunErr(null);
    try {
      const r = await fetch("/api/tracker/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          items: parsed.items,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `error_${r.status}`);
      setActiveJobId(d.job_id);
      setRaw("");
      setParsed(null);
      setLabel("");
      setFileName(null);
      await loadJobs();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "error");
    } finally {
      setCreating(false);
    }
  };

  const runNextBatch = useCallback(async () => {
    if (!activeJobId || runningRef.current) return false;
    runningRef.current = true;
    try {
      const r = await fetch(`/api/tracker/bulk/${activeJobId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch_size: 5 }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setRunErr(d.error || `run_${r.status}`);
        return false;
      }
      const d = await r.json();
      await loadJobDetail(activeJobId);
      await loadJobs();
      return d.remaining > 0;
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "network");
      return false;
    } finally {
      runningRef.current = false;
    }
  }, [activeJobId, loadJobDetail, loadJobs]);

  // Auto-loop while there are pending items.
  useEffect(() => {
    if (!autoRun || !activeJob) return;
    if (activeJob.counts.pending + activeJob.counts.running === 0) return;
    const t = setTimeout(() => {
      runNextBatch();
    }, 600);
    return () => clearTimeout(t);
  }, [autoRun, activeJob, runNextBatch]);

  // Auto-trigger LLM classification once the batch finishes, so unknown
  // domains discovered during the batch pick up vendor labels.
  useEffect(() => {
    if (!autoClassify || !activeJobId || !activeJob) return;
    if (activeJob.counts.pending + activeJob.counts.running > 0) return;
    if (activeJob.counts.done === 0) return;
    if (classifyFiredRef.current === activeJobId) return;
    classifyFiredRef.current = activeJobId;
    setClassifyMsg("Clasificando unknowns del catálogo con LLM…");
    (async () => {
      try {
        const r = await fetch("/api/tracker/resources/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batch: true, min_hotels: 1, limit: 40 }),
        });
        const d = await r.json();
        if (!r.ok) {
          setClassifyMsg(`Classify error: ${d.error || r.status}`);
        } else {
          setClassifyMsg(
            `LLM: ${d.succeeded} clasificados · ${d.failed} fallas · ${Math.round((d.duration_ms || 0) / 1000)}s`
          );
        }
      } catch (e) {
        setClassifyMsg(e instanceof Error ? e.message : "classify_failed");
      }
    })();
  }, [autoClassify, activeJobId, activeJob]);

  const pctDone = activeJob
    ? Math.min(
        100,
        Math.round(
          ((activeJob.counts.done + activeJob.counts.error) * 100) /
            Math.max(1, activeJob.job.total)
        )
      )
    : 0;

  return (
    <div className="space-y-6">
      {!activeJobId && (
        <div className="border border-border rounded-md bg-surface p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-text">
                Nuevo batch
              </h2>
              <p className="text-xs text-text-dim mt-0.5">
                Pega URLs (una por línea) o subí un CSV. Con CSV basta una
                columna llamada{" "}
                <span className="font-mono text-[11px]">url</span>,{" "}
                <span className="font-mono text-[11px]">link</span>,{" "}
                <span className="font-mono text-[11px]">website</span>,{" "}
                <span className="font-mono text-[11px]">sitio</span> o similar.
                Si no hay header, se toma la primera columna. Limpiamos
                quotes, BOM, markdown, fragments y dedup automáticamente.
                Máximo 2.000 URLs por batch.
              </p>
            </div>
            <label className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-border-light cursor-pointer shrink-0">
              Subir CSV
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setFileName(null);
            }}
            rows={10}
            placeholder={
              "https://www.hotelbidasoa.cl\nhttps://www.mandarinoriental.com/santiago\nhttps://diegodealmagro.cl"
            }
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded bg-surface-2 focus:outline-none focus:border-accent"
          />

          {fileName && (
            <div className="text-[11px] text-text-dim">
              Archivo cargado:{" "}
              <span className="font-mono">{fileName}</span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-text-dim">
                Etiqueta (opcional)
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej. Chile — independientes"
                className="px-2 py-1.5 text-sm border border-border rounded bg-surface-2 focus:outline-none focus:border-accent min-w-[260px]"
              />
            </div>
            <button
              onClick={handleParse}
              disabled={!raw.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-border-light disabled:opacity-50"
            >
              Previsualizar
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !parsed?.items.length}
              className="px-3 py-1.5 text-xs font-medium rounded border border-accent/40 bg-accent/10 text-accent-light hover:bg-accent/20 disabled:opacity-50"
            >
              {creating
                ? "Creando…"
                : parsed
                  ? `Iniciar batch de ${parsed.items.length}`
                  : "Iniciar batch"}
            </button>
            {runErr && <span className="text-xs text-negative">{runErr}</span>}
          </div>

          {parsed && (
            <div className="text-xs text-text-dim border-t border-border pt-2 mt-2">
              <div className="flex flex-wrap gap-3">
                <span>
                  <span className="tabular-nums text-text font-medium">
                    {parsed.items.length}
                  </span>{" "}
                  URLs válidas
                </span>
                <span>
                  <span className="tabular-nums">{parsed.duplicates}</span>{" "}
                  duplicadas descartadas
                </span>
                <span>
                  <span className="tabular-nums">{parsed.invalid.length}</span>{" "}
                  inválidas
                </span>
                <span className="text-text-dim">
                  · {parsed.source === "csv" ? "CSV con header" : "lista simple"}
                </span>
              </div>
              {parsed.invalid.length > 0 && (
                <div className="mt-1 text-[11px] font-mono text-text-dim">
                  Inválidas:{" "}
                  {parsed.invalid
                    .slice(0, 5)
                    .map((x) => x.raw)
                    .join(" · ")}
                  {parsed.invalid.length > 5 && "…"}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeJobId && activeJob && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <button
                onClick={() => setActiveJobId(null)}
                className="text-xs text-text-dim hover:text-text-muted"
              >
                ← Nuevo batch
              </button>
              <h2 className="text-sm font-semibold text-text mt-1">
                {activeJob.job.label || `Batch ${activeJob.job.id.slice(0, 8)}`}
              </h2>
              <div className="text-xs text-text-dim mt-0.5">
                {activeJob.job.total} URLs ·{" "}
                {formatDuration(
                  activeJob.job.started_at,
                  activeJob.job.finished_at
                )}{" "}
                · {new Date(activeJob.job.created_at).toLocaleString("es-CL")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="accent-accent"
                />
                Auto-procesar
              </label>
              <label
                className="flex items-center gap-1.5 text-xs text-text-muted"
                title="Al terminar el batch, clasificar con LLM los dominios unknown del catálogo global."
              >
                <input
                  type="checkbox"
                  checked={autoClassify}
                  onChange={(e) => setAutoClassify(e.target.checked)}
                  className="accent-accent"
                />
                Clasificar unknowns al terminar
              </label>
              <button
                onClick={() => runNextBatch()}
                disabled={activeJob.counts.pending === 0}
                className="px-3 py-1.5 text-xs font-medium rounded border border-accent/40 bg-accent/10 text-accent-light hover:bg-accent/20 disabled:opacity-50"
              >
                Correr 5
              </button>
              <a
                href={`/api/tracker/bulk/${activeJobId}/export?format=csv`}
                className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-border-light"
              >
                Export CSV
              </a>
            </div>
          </div>
          {classifyMsg && (
            <div className="text-xs text-text-muted px-1">{classifyMsg}</div>
          )}

          <div className="border border-border rounded-md bg-surface px-4 py-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <div className="text-text-muted">Progreso</div>
              <div className="tabular-nums text-text">
                {activeJob.counts.done + activeJob.counts.error} /{" "}
                {activeJob.job.total} ({pctDone}%)
              </div>
            </div>
            <div className="h-2 bg-surface-2 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${pctDone}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-dim">
              <span>Pendientes: {activeJob.counts.pending}</span>
              <span>En curso: {activeJob.counts.running}</span>
              <span className="text-positive">
                OK: {activeJob.counts.done}
              </span>
              <span className="text-negative">
                Errores: {activeJob.counts.error}
              </span>
            </div>
          </div>

          <div className="border border-border rounded-md bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Cadena</th>
                  <th className="px-3 py-2">Booking</th>
                  <th className="px-3 py-2">CMS</th>
                  <th className="px-3 py-2">Agencia web</th>
                  <th className="px-3 py-2">Otras capas</th>
                  <th className="px-3 py-2 text-right">Recursos</th>
                  <th className="px-3 py-2">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {activeJob.items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-b border-border last:border-0 align-top"
                  >
                    <td className="px-3 py-1.5 text-[11px] text-text-dim tabular-nums">
                      {it.idx + 1}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-text-muted truncate max-w-[240px]">
                      {it.url}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={it.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      <ChainBadge
                        is_chain={it.result_summary?.is_chain}
                        count={it.result_summary?.property_count_estimate}
                        signals={it.result_summary?.chain_signals}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <StackCellView cell={it.result_summary?.stack?.booking_engine ?? null} />
                    </td>
                    <td className="px-3 py-1.5">
                      <StackCellView cell={it.result_summary?.stack?.cms ?? null} />
                    </td>
                    <td className="px-3 py-1.5">
                      <AgencyCell agency={it.result_summary?.agency ?? null} />
                    </td>
                    <td className="px-3 py-1.5">
                      <CategoryPills stack={it.result_summary?.stack} exclude={["booking_engine", "cms"]} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                      {it.result_summary?.resources_count ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-text-dim">
                      {it.error ? (
                        <span className="text-negative" title={it.error}>
                          {it.error.slice(0, 50)}
                        </span>
                      ) : it.result_summary?.insecure_tls ? (
                        <span
                          className="px-1 py-0 text-[9px] uppercase tracking-wider bg-neutral-muted text-neutral-sent border border-neutral-sent/30 rounded"
                          title="Se reintentó con TLS relajado"
                        >
                          TLS relajado
                        </span>
                      ) : it.result_summary?.duration_ms ? (
                        `${it.result_summary.duration_ms} ms`
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!activeJobId && jobs.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim mb-2">
            Batches recientes
          </h3>
          <div className="border border-border rounded-md bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="px-3 py-2">Etiqueta</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">OK</th>
                  <th className="px-3 py-2 text-right">Errores</th>
                  <th className="px-3 py-2 text-right">Pendientes</th>
                  <th className="px-3 py-2">Creado</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => setActiveJobId(j.id)}
                    className="border-b border-border last:border-0 hover:bg-surface-2/60 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-text">
                      {j.label || (
                        <span className="font-mono text-xs text-text-dim">
                          {j.id.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {j.total}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-positive">
                      {j.done}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-negative">
                      {j.failed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-dim">
                      {j.pending}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-text-dim">
                      {new Date(j.created_at).toLocaleString("es-CL")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  booking_engine: "Booking",
  cms: "CMS",
  pms: "PMS",
  channel_mgr: "Channel",
  chat: "Chat",
  reviews: "Reviews",
  ads: "Ads",
  analytics: "Analytics",
  consent: "Consent",
};

function AgencyCell({
  agency,
}: {
  agency: { name: string; url: string | null; confidence: number } | null;
}) {
  if (!agency) return <span className="text-text-dim text-xs">—</span>;
  return (
    <div>
      {agency.url ? (
        <a
          href={agency.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-text hover:text-accent-light underline decoration-dotted"
        >
          {agency.name}
        </a>
      ) : (
        <span className="text-xs font-medium text-text">{agency.name}</span>
      )}
      <div className="text-[10px] text-text-dim mt-0.5">
        conf {(agency.confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function StackCellView({ cell }: { cell: StackCell | null }) {
  if (!cell || (!cell.vendor && !cell.domain)) {
    return <span className="text-text-dim text-xs">—</span>;
  }
  if (cell.vendor) {
    return (
      <div>
        <div className="text-xs font-medium text-text">{cell.vendor}</div>
        {cell.product && (
          <div className="text-[10px] text-text-dim">{cell.product}</div>
        )}
        <span
          className={`inline-block mt-0.5 px-1 py-0 text-[9px] uppercase tracking-wider rounded border ${
            cell.source === "rule"
              ? "bg-accent/10 text-accent-light border-accent/30"
              : "bg-positive-muted text-positive border-positive/30"
          }`}
        >
          {cell.source === "rule" ? "rule" : "obs"}
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[11px] font-mono text-text-muted">
        {cell.domain}
      </div>
      <span className="inline-block mt-0.5 px-1 py-0 text-[9px] uppercase tracking-wider bg-neutral-muted text-neutral-sent border border-neutral-sent/30 rounded">
        sin clasificar
      </span>
    </div>
  );
}

function CategoryPills({
  stack,
  exclude = [],
}: {
  stack: Partial<Record<string, StackCell>> | undefined;
  exclude?: string[];
}) {
  if (!stack) return <span className="text-text-dim text-xs">—</span>;
  const entries = Object.entries(stack).filter(
    ([k, v]) => !exclude.includes(k) && v && (v.vendor || v.domain)
  );
  if (entries.length === 0) {
    return <span className="text-text-dim text-xs">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => {
        if (!v) return null;
        const label = CATEGORY_LABEL[k] || k;
        const val = v.vendor || v.domain;
        const pending = v.needs_classification;
        return (
          <span
            key={k}
            title={`${label}: ${val}${pending ? " (sin clasificar)" : ""}`}
            className={`px-1.5 py-0 text-[10px] rounded border whitespace-nowrap ${
              pending
                ? "bg-surface-2 text-text-dim border-border"
                : "bg-accent/10 text-accent-light border-accent/30"
            }`}
          >
            <span className="font-semibold">{label}</span>{" "}
            <span className="opacity-80">· {val}</span>
          </span>
        );
      })}
    </div>
  );
}

function ChainBadge({
  is_chain,
  count,
  signals,
}: {
  is_chain?: boolean;
  count?: number | null;
  signals?: string[];
}) {
  if (typeof is_chain !== "boolean") {
    return <span className="text-text-dim text-xs">—</span>;
  }
  const title = signals?.length
    ? `Señales: ${signals.slice(0, 4).join(" · ")}`
    : undefined;
  if (is_chain) {
    return (
      <span
        title={title}
        className="inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-accent/10 text-accent-light border border-accent/30 rounded"
      >
        Cadena{count ? ` · ${count}` : ""}
      </span>
    );
  }
  return (
    <span
      title={title}
      className="inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-surface-2 text-text-dim border border-border rounded"
    >
      Independiente
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style: Record<string, string> = {
    pending: "bg-surface-2 text-text-dim border-border",
    running: "bg-accent/10 text-accent-light border-accent/30",
    done: "bg-positive-muted text-positive border-positive/30",
    error: "bg-negative-muted text-negative border-negative/30",
    skipped: "bg-surface-2 text-text-dim border-border",
    created: "bg-surface-2 text-text-dim border-border",
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border rounded ${
        style[status] || style.pending
      }`}
    >
      {status}
    </span>
  );
}
