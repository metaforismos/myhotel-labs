// Roll-up determinístico: del tema (que sí elige el LLM) sacamos área primaria,
// áreas secundarias y dimensión canónica. Sin LLM, código puro.
//
// Regla aclarada por el PO: cuando tema != null, la dimensión sale del lookup del
// tema (no de la que dijo el LLM). La dimensión del LLM se respeta SOLO para los
// propuesto:true (donde no hay tag canónico aún).

import { getTema } from "./taxonomy";
import { AreaRef, Mention, MentionFromLLM, Touchpoint } from "./types";

export interface RollupArgs {
  m: MentionFromLLM;
  reviewId: string;
  index: number;
  touchpoint: Touchpoint;
  enabledAreaIds: Set<number>;
}

export interface RollupResult {
  mention: Mention;
  // Si el LLM mandó un tema que existe pero su área primaria no está habilitada
  // en el hotel, marcamos esto para mostrar "tu huésped habla de un área no habilitada".
  area_not_enabled?: boolean;
}

export function rollup({ m, reviewId, index, touchpoint, enabledAreaIds }: RollupArgs): RollupResult {
  // Caso 1: propuesto explícito (LLM no encontró tema) → no hay área canónica.
  if (m.propuesto || !m.tema) {
    return {
      mention: {
        id: `${reviewId}-m${index}`,
        review_id: reviewId,
        span: m.span,
        subtema: m.subtema,
        tema: null,
        dimension: m.dimension, // se respeta la del LLM para propuestos
        area_primary: null,
        areas_secondary: [],
        polaridad: m.polaridad,
        intensidad: m.intensidad,
        confianza: m.confianza,
        idioma: m.idioma,
        propuesto: true,
        touchpoint,
      },
    };
  }

  // Caso 2: el LLM mandó un tag → lo buscamos.
  const tema = getTema(m.tema);
  if (!tema) {
    // Tag desconocido (drift del modelo). Lo degradamos a propuesto.
    return {
      mention: {
        id: `${reviewId}-m${index}`,
        review_id: reviewId,
        span: m.span,
        subtema: m.subtema,
        tema: null,
        dimension: m.dimension,
        area_primary: null,
        areas_secondary: [],
        polaridad: m.polaridad,
        intensidad: m.intensidad,
        confianza: m.confianza,
        idioma: m.idioma,
        propuesto: true,
        touchpoint,
      },
    };
  }

  // Caso 3: tag conocido. Dimensión y área salen del lookup.
  const area_not_enabled = !enabledAreaIds.has(tema.area_primary.area_id);

  // Si el área primaria del tema NO está habilitada en el hotel, tratamos la mención
  // como propuesta para que entre al panel de descubrimiento ("¿activar este área?").
  // Mantenemos el tema y la dimensión canónica para que el reviewer humano vea de qué se trata.
  if (area_not_enabled) {
    return {
      area_not_enabled: true,
      mention: {
        id: `${reviewId}-m${index}`,
        review_id: reviewId,
        span: m.span,
        subtema: m.subtema,
        tema: tema.tag,
        dimension: tema.dimension,
        area_primary: null, // no cuenta al índice
        areas_secondary: tema.areas_secondary as AreaRef[],
        polaridad: m.polaridad,
        intensidad: m.intensidad,
        confianza: m.confianza,
        idioma: m.idioma,
        propuesto: true,
        touchpoint,
      },
    };
  }

  return {
    mention: {
      id: `${reviewId}-m${index}`,
      review_id: reviewId,
      span: m.span,
      subtema: m.subtema,
      tema: tema.tag,
      dimension: tema.dimension, // determinístico desde el tema
      area_primary: tema.area_primary,
      areas_secondary: tema.areas_secondary as AreaRef[],
      polaridad: m.polaridad,
      intensidad: m.intensidad,
      confianza: m.confianza,
      idioma: m.idioma,
      propuesto: false,
      touchpoint,
    },
  };
}

// Re-aplica el rollup cuando el usuario hace override de subtema/tema/dimensión/etc.
// Si cambió el tema → re-derivar dimensión y áreas.
export function applyOverride(prev: Mention, patch: Partial<Mention>, enabledAreaIds: Set<number>): Mention {
  const merged: Mention = { ...prev, ...patch, override: true };
  // Si cambió el tema y no es propuesto, re-derivar
  if (patch.tema !== undefined) {
    if (!patch.tema) {
      merged.tema = null;
      merged.area_primary = null;
      merged.areas_secondary = [];
      merged.propuesto = true;
    } else {
      const t = getTema(patch.tema);
      if (t) {
        merged.tema = t.tag;
        merged.dimension = t.dimension;
        merged.area_primary = enabledAreaIds.has(t.area_primary.area_id) ? t.area_primary : null;
        merged.areas_secondary = t.areas_secondary;
        merged.propuesto = merged.area_primary === null;
      }
    }
  }
  return merged;
}
