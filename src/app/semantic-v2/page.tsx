"use client";

import { useMemo, useState } from "react";
import sampleData from "../../../data/semantic-v2/sample_reviews.json";
import { ALL_AREAS, DEFAULT_ENABLED_AREA_IDS } from "@/lib/semantic-v2/taxonomy";
import { buildAccordion, DEFAULT_N_MINIMO, summarize } from "@/lib/semantic-v2/indices";
import {
  AccordionLens,
  Idioma,
  Mention,
  ReviewBatch,
  Touchpoint,
} from "@/lib/semantic-v2/types";
import { HighlightedText } from "@/components/semantic-v2/HighlightedText";
import { MentionRow } from "@/components/semantic-v2/MentionRow";
import { AccordionView } from "@/components/semantic-v2/AccordionView";
import { DiscoveryView } from "@/components/semantic-v2/DiscoveryView";
import { AreasPanel } from "@/components/semantic-v2/AreasPanel";

interface SampleReview {
  id: string;
  idioma: Idioma;
  touchpoint: Touchpoint;
  text: string;
}
const SAMPLES: SampleReview[] = (sampleData as { reviews: SampleReview[] }).reviews;

type Tab = "analisis" | "resumen" | "descubrimiento";

export default function SemanticV2Page() {
  const [enabledAreaIds, setEnabledAreaIds] = useState<Set<number>>(
    () => new Set(DEFAULT_ENABLED_AREA_IDS),
  );
  const [text, setText] = useState("");
  const [touchpoint, setTouchpoint] = useState<Touchpoint>("FollowUp");
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("analisis");
  const [lens, setLens] = useState<AccordionLens>("area");
  const [nMin, setNMin] = useState(DEFAULT_N_MINIMO);
  const [activeMentionId, setActiveMentionId] = useState<string | null>(null);

  const allMentions = useMemo(() => batches.flatMap((b) => b.mentions), [batches]);
  const summary = useMemo(
    () => summarize(allMentions, batches.length, enabledAreaIds),
    [allMentions, batches.length, enabledAreaIds],
  );
  const accordionTree = useMemo(
    () => buildAccordion({ mentions: allMentions, lens, nMin }),
    [allMentions, lens, nMin],
  );

  const toggleArea = (id: number) => {
    setEnabledAreaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const analyzeOne = async (rv: { id: string; text: string; idioma: Idioma; touchpoint: Touchpoint }) => {
    const res = await fetch("/api/semantic-v2/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: rv.text,
        reviewId: rv.id,
        idioma: rv.idioma,
        touchpoint: rv.touchpoint,
        enabledAreaIds: Array.from(enabledAreaIds),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Extract failed");
    return data as { review_id: string; mentions: Mention[] };
  };

  const handleAnalyzeText = async () => {
    if (!text.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const id = `rv-${Date.now()}`;
      const result = await analyzeOne({ id, text, idioma, touchpoint });
      const batch: ReviewBatch = {
        id,
        text,
        idioma,
        touchpoint,
        mentions: result.mentions,
        analyzed_at: Date.now(),
      };
      setBatches((prev) => [...prev, batch]);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeSamples = async () => {
    setIsLoading(true);
    setError(null);
    setBatches([]);
    setProgress({ done: 0, total: SAMPLES.length, failed: 0 });
    const CONCURRENCY = 2;
    let done = 0, failed = 0;
    const results: ReviewBatch[] = [];

    for (let i = 0; i < SAMPLES.length; i += CONCURRENCY) {
      const chunk = SAMPLES.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((rv) => analyzeOne(rv)));
      settled.forEach((outcome, j) => {
        const rv = chunk[j];
        if (outcome.status === "fulfilled") {
          results.push({
            id: rv.id,
            text: rv.text,
            idioma: rv.idioma,
            touchpoint: rv.touchpoint,
            mentions: outcome.value.mentions,
            analyzed_at: Date.now(),
          });
          done++;
        } else {
          failed++;
          console.warn(`Sample ${rv.id} failed:`, outcome.reason);
        }
        setProgress({ done: done + failed, total: SAMPLES.length, failed });
      });
      setBatches([...results]);
      // pausa adaptativa
      if (i + CONCURRENCY < SAMPLES.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (failed > 0) setError(`${done} reseñas OK, ${failed} fallaron.`);
    setIsLoading(false);
    setProgress(null);
    setTab("resumen");
  };

  const handleClear = () => {
    setBatches([]);
    setError(null);
    setActiveMentionId(null);
  };

  const updateMention = (batchId: string, mention: Mention) => {
    setBatches((prev) =>
      prev.map((b) =>
        b.id === batchId
          ? { ...b, mentions: b.mentions.map((m) => (m.id === mention.id ? mention : m)) }
          : b,
      ),
    );
  };

  return (
    <div className="pt-8 pb-16">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Semántico v2 — Prototipo</h1>
            <p className="text-[13px] text-text-muted max-w-3xl mt-1">
              Banco de pruebas del modelo: una reseña entra y sale partida en menciones concretas
              — cada una trazable a la frase, con área primaria única (sin doble conteo).
              Subtema neutro · polaridad contextual · dimensión transversal · trilingüe ES/EN/PT.
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Sidebar config */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          <div className="bg-surface border border-border rounded-md p-3">
            <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-2">Cargar reseñas</h3>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Pegá una reseña..."
              className="w-full text-[13px] border border-border rounded p-2 bg-surface-2 resize-y"
            />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="flex flex-col text-[11px] text-text-muted">
                Touchpoint
                <select
                  value={touchpoint}
                  onChange={(e) => setTouchpoint(e.target.value as Touchpoint)}
                  className="mt-0.5 border border-border bg-surface px-2 py-1 rounded text-[12px]"
                >
                  <option value="OnSite">OnSite</option>
                  <option value="FollowUp">FollowUp</option>
                  <option value="Online">Online</option>
                  <option value="Concierge">Concierge</option>
                </select>
              </label>
              <label className="flex flex-col text-[11px] text-text-muted">
                Idioma
                <select
                  value={idioma}
                  onChange={(e) => setIdioma(e.target.value as Idioma)}
                  className="mt-0.5 border border-border bg-surface px-2 py-1 rounded text-[12px]"
                >
                  <option value="es">es</option>
                  <option value="en">en</option>
                  <option value="pt">pt</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleAnalyzeText}
                disabled={isLoading || !text.trim()}
                className="flex-1 bg-accent text-white text-[12px] py-1.5 rounded hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Analizando…" : "Analizar"}
              </button>
              <button
                onClick={handleAnalyzeSamples}
                disabled={isLoading}
                className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-surface-2 disabled:opacity-50"
              >
                Set muestra ({SAMPLES.length})
              </button>
            </div>
            {batches.length > 0 && (
              <button
                onClick={handleClear}
                className="mt-2 w-full text-[11px] text-text-dim hover:text-negative py-1"
              >
                Limpiar lote ({batches.length} reseñas)
              </button>
            )}
            {progress && (
              <div className="mt-2 text-[11px] text-text-muted">
                {progress.done}/{progress.total} · {progress.failed} errores
              </div>
            )}
            {error && (
              <div className="mt-2 text-[11px] text-negative bg-negative-muted/30 border border-negative/30 rounded p-1.5">
                {error}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-md p-3">
            <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-2">
              Áreas habilitadas del hotel
            </h3>
            <AreasPanel areas={ALL_AREAS} enabledAreaIds={enabledAreaIds} onToggle={toggleArea} />
          </div>

          {batches.length > 0 && (
            <div className="bg-surface border border-border rounded-md p-3">
              <h3 className="text-[11px] uppercase tracking-wider text-text-dim mb-2">Lote</h3>
              <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
                <dt className="text-text-muted">Reseñas</dt>
                <dd className="font-mono text-right">{summary.reviews}</dd>
                <dt className="text-text-muted">Menciones</dt>
                <dd className="font-mono text-right">{summary.mentions}</dd>
                <dt className="text-text-muted">Positivas</dt>
                <dd className="font-mono text-right text-positive">{summary.positivas}</dd>
                <dt className="text-text-muted">Negativas</dt>
                <dd className="font-mono text-right text-negative">{summary.negativas}</dd>
                <dt className="text-text-muted">Neutrales</dt>
                <dd className="font-mono text-right text-neutral-sent">{summary.neutrales}</dd>
                <dt className="text-text-muted">Sugerencias</dt>
                <dd className="font-mono text-right text-labs-yellow">{summary.sugerencias}</dd>
                <dt className="text-text-muted">Propuestos</dt>
                <dd className="font-mono text-right">{summary.propuestos}</dd>
                <dt className="text-text-muted pt-1 border-t border-border">Índice global</dt>
                <dd className="font-mono text-right pt-1 border-t border-border">
                  {summary.indice_global === null ? "—" : `${(summary.indice_global * 100).toFixed(0)}%`}
                </dd>
              </dl>
              <p className="mt-2 text-[10px] text-text-dim italic">
                Índice = positivas / (positivas + negativas). Neutrales y sugerencias se cuentan aparte.
              </p>
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="min-w-0">
          <div className="flex border-b border-border mb-4">
            {([
              { id: "analisis", label: "Análisis por reseña" },
              { id: "resumen", label: "Resumen (acordeón)" },
              { id: "descubrimiento", label: `Descubrimiento${summary.propuestos > 0 ? ` (${summary.propuestos})` : ""}` },
            ] as { id: Tab; label: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? "border-accent text-accent"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "analisis" && (
            <div className="space-y-6">
              {batches.length === 0 && !isLoading && (
                <div className="bg-surface border border-border rounded-md p-8 text-center text-text-dim text-sm">
                  Pegá una reseña o cargá el set de muestra para empezar.
                </div>
              )}
              {batches.map((b) => (
                <div key={b.id} className="bg-surface border border-border rounded-md p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono text-text-dim">{b.id}</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">{b.touchpoint}</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">{b.idioma}</span>
                      <span className="text-text-dim">· {b.mentions.length} menciones</span>
                    </div>
                  </div>
                  <div className="mb-3 p-3 bg-surface-2 rounded">
                    <HighlightedText
                      text={b.text}
                      mentions={b.mentions}
                      activeMentionId={activeMentionId}
                      onHoverMention={setActiveMentionId}
                    />
                  </div>
                  <div className="space-y-2">
                    {b.mentions.map((m) => (
                      <MentionRow
                        key={m.id}
                        mention={m}
                        enabledAreaIds={enabledAreaIds}
                        active={activeMentionId === m.id}
                        onHover={setActiveMentionId}
                        onChange={(updated) => updateMention(b.id, updated)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "resumen" && (
            <AccordionView
              tree={accordionTree}
              lens={lens}
              onChangeLens={setLens}
              nMin={nMin}
              onChangeNMin={setNMin}
            />
          )}

          {tab === "descubrimiento" && (
            <DiscoveryView mentions={allMentions} enabledAreaIds={enabledAreaIds} />
          )}
        </main>
      </div>
    </div>
  );
}
