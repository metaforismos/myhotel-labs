// Carga + lookups de la taxonomía Semántico v2.
// Reglas duras (del PRD):
// - Catálogo activo del LLM = áreas habilitadas + temas con consolidar !== true + incluir nuevo:true.
// - El área NUNCA la decide el LLM (rollup determinístico desde el tema).
// - La dimensión sale del tema (determinístico) salvo en propuestos.

import areasJson from "../../../data/semantic-v2/areas.json";
import temasJson from "../../../data/semantic-v2/temas.json";
import subtemasSeedJson from "../../../data/semantic-v2/subtemas-seed.json";
import { Area, AreaRef, Subtema, Tema, TipoArea } from "./types";

interface AreasFile {
  property_type: string;
  areas: Area[];
}
interface TemasFile {
  count: number;
  temas: Tema[];
}
interface SubtemasFile {
  count: number;
  subtemas: Subtema[];
}

const areasFile = areasJson as AreasFile;
const temasFile = temasJson as TemasFile;
const subtemasFile = subtemasSeedJson as SubtemasFile;

export const ALL_AREAS: Area[] = areasFile.areas;
export const ALL_TEMAS: Tema[] = temasFile.temas;
export const ALL_SUBTEMAS: Subtema[] = subtemasFile.subtemas;

// índices de lookup, computados una vez al cargar el módulo
const byTag = new Map<string, Tema>();
const byAreaId = new Map<number, Area>();
const subtemaByKey = new Map<string, Subtema>();
const tagsBySubtema = new Map<string, Tema[]>(); // subtema raíz → temas que lo mencionan
const tagsByDimension = new Map<string, Tema[]>();

for (const t of ALL_TEMAS) byTag.set(t.tag, t);
for (const a of ALL_AREAS) byAreaId.set(a.area_id, a);
for (const s of ALL_SUBTEMAS) subtemaByKey.set(s.subtema.toLowerCase(), s);

for (const t of ALL_TEMAS) {
  const slug = t.dimension_slug ?? t.dimension.toLowerCase();
  if (!tagsByDimension.has(slug)) tagsByDimension.set(slug, []);
  tagsByDimension.get(slug)!.push(t);
  // El "núcleo" del tag (e.g. accommodations-bathroom-cleanliness → "bathroom") sirve como
  // pista de subtema raíz; lo usamos cuando el LLM propone un subtema cercano a uno conocido.
  for (const s of ALL_SUBTEMAS) {
    if (t.tag.includes(`-${s.subtema}-`) || t.tag.endsWith(`-${s.subtema}`)) {
      if (!tagsBySubtema.has(s.subtema)) tagsBySubtema.set(s.subtema, []);
      tagsBySubtema.get(s.subtema)!.push(t);
    }
  }
}

export function getArea(area_id: number): Area | undefined {
  return byAreaId.get(area_id);
}

export function getTema(tag: string): Tema | undefined {
  return byTag.get(tag);
}

export function getSubtema(key: string): Subtema | undefined {
  return subtemaByKey.get(key.toLowerCase());
}

// Default sensato para el prototipo: todas las universal ON,
// + algunas instalaciones comunes ON, resto OFF para demostrar el caso
// "huésped habla de área no habilitada" (Ski, Yurt, Banquete…).
export const DEFAULT_ENABLED_AREA_IDS = new Set<number>([
  ...ALL_AREAS.filter((a) => a.tipo === "universal").map((a) => a.area_id),
  24, // Piscina
  10, // Spa
  20, // Gimnasio
  27, // Bar
  38, // Room Service
]);

export function isAreaEnabled(area_id: number, enabledIds: Set<number>): boolean {
  return enabledIds.has(area_id);
}

// Temas activos del catálogo que se manda al LLM:
//   - excluir consolidar:true
//   - incluir nuevo:true (ya vienen sin consolidar)
//   - filtrar por áreas habilitadas (si el primary no está habilitado, fuera)
export function activeTemas(enabledAreaIds: Set<number>): Tema[] {
  return ALL_TEMAS.filter((t) => {
    if (t.consolidar === true) return false;
    return enabledAreaIds.has(t.area_primary.area_id);
  });
}

// Subtemas del prompt: 85 del Pareto-90 (los que el LLM tiene a la vista).
// Discovery usa los 236 completos.
export const PARETO_SUBTEMAS: Subtema[] = ALL_SUBTEMAS.filter((s) => s.in_pareto_90);

// Compacto para el system prompt: tag + labels trilingües + dimension.
export interface CompactTema {
  tag: string;
  dim: string;
  es: string;
  en: string;
  pt: string;
}

export function compactTemas(temas: Tema[]): CompactTema[] {
  return temas.map((t) => ({
    tag: t.tag,
    dim: t.dimension,
    es: t.labels.es,
    en: t.labels.en,
    pt: t.labels.pt,
  }));
}

export interface CompactSubtema {
  subtema: string;
  label_es: string;
}
export function compactSubtemas(subs: Subtema[]): CompactSubtema[] {
  return subs.map((s) => ({ subtema: s.subtema, label_es: s.label_es ?? s.subtema }));
}

// Dimensiones únicas presentes en el catálogo activo (para el toggle Por-Dimensión del acordeón).
export function activeDimensions(enabledAreaIds: Set<number>): { slug: string; label: string }[] {
  const map = new Map<string, string>();
  for (const t of activeTemas(enabledAreaIds)) {
    const slug = t.dimension_slug ?? t.dimension.toLowerCase();
    if (!map.has(slug)) map.set(slug, t.dimension);
  }
  return Array.from(map.entries()).map(([slug, label]) => ({ slug, label }));
}

export function temasByDimension(slug: string): Tema[] {
  return tagsByDimension.get(slug) ?? [];
}

export function areasByTipo(tipo: TipoArea): Area[] {
  return ALL_AREAS.filter((a) => a.tipo === tipo);
}

// Resuelve un AreaRef enriquecido (con string ES) a partir de un area_id puntual.
export function areaRefById(area_id: number): AreaRef | null {
  const a = byAreaId.get(area_id);
  return a ? { area_id: a.area_id, es: a.es } : null;
}
