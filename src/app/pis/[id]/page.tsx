"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScoreBreakdown } from "@/components/pis/ScoreBreakdown";
import { ScoreBadge } from "@/components/pis/ScoreBadge";
import { ProductTags } from "@/components/pis/ProductTags";
import type { PisInitiative } from "@/lib/pis/types";
import Link from "next/link";

export default function InitiativeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [initiative, setInitiative] = useState<PisInitiative | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    fetchInitiative();
  }, [params.id]);

  async function fetchInitiative() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pis/initiatives/${params.id}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      setInitiative(data.initiative);
    } catch {
      setInitiative(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleScore() {
    if (!initiative) return;
    setScoring(true);
    try {
      const res = await fetch(`/api/pis/initiatives/${initiative.id}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: "gemini-pro" }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Error: ${data.error || "scoring failed"}`);
        return;
      }
      fetchInitiative();
    } catch {
      alert("Error al evaluar la iniciativa");
    } finally {
      setScoring(false);
    }
  }

  async function handleArchive() {
    if (!initiative || !confirm("¿Archivar esta iniciativa?")) return;
    setArchiving(true);
    try {
      await fetch(`/api/pis/initiatives/${initiative.id}`, {
        method: "DELETE",
      });
      router.push("/pis");
    } catch {
      alert("Error al archivar");
    } finally {
      setArchiving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="space-y-4">
          <div className="skeleton h-8 w-64 rounded" />
          <div className="skeleton h-32 rounded-lg" />
          <div className="skeleton h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!initiative) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-8 text-center">
        <p className="text-text-dim">Iniciativa no encontrada.</p>
        <Link href="/pis" className="text-accent text-sm hover:underline mt-2 inline-block">
          Volver al listado
        </Link>
      </div>
    );
  }

  const isScored = initiative.status === "scored" && initiative.scoring_result;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/pis"
          className="text-xs text-text-dim hover:text-text-muted transition-colors"
        >
          &larr; Volver al listado
        </Link>
        <div className="flex gap-2">
          <button
            onClick={handleScore}
            disabled={scoring}
            className="px-3 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent-light transition-colors disabled:opacity-50"
          >
            {scoring
              ? "Evaluando..."
              : isScored
                ? "Re-evaluar"
                : "Evaluar con IA"}
          </button>
          <Link
            href={`/pis/${initiative.id}/edit`}
            className="px-3 py-1.5 bg-surface border border-border text-xs font-medium text-text-muted rounded-md hover:bg-surface-2 transition-colors"
          >
            Editar
          </Link>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="px-3 py-1.5 bg-surface border border-border text-xs font-medium text-negative rounded-md hover:bg-negative-muted transition-colors disabled:opacity-50"
          >
            Archivar
          </button>
        </div>
      </div>

      {isScored ? (
        <ScoreBreakdown initiative={initiative} />
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-bold text-text">{initiative.title}</h1>
            <div className="mt-2 flex items-center gap-3">
              <ProductTags products={initiative.products} />
              <span className="text-xs text-text-dim">
                por {initiative.author}
              </span>
              <ScoreBadge score={null} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                Descripción
              </div>
              <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">
                {initiative.description}
              </p>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                Hipótesis
              </div>
              <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">
                {initiative.hypothesis}
              </p>
            </div>
          </div>

          <div className="bg-neutral-muted border border-neutral-sent/20 rounded-lg p-4 text-center">
            <p className="text-sm text-neutral-sent">
              Esta iniciativa aún no ha sido evaluada.
            </p>
            <button
              onClick={handleScore}
              disabled={scoring}
              className="mt-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {scoring ? "Evaluando..." : "Evaluar con IA"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
