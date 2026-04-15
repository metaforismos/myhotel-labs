export interface Kpi {
  id: number;
  name: string;
  type: "performance" | "strategic";
  description: string;
  target: string;
}

export const KPI_2026: Kpi[] = [
  { id: 1, name: "WhatsApp activado", type: "performance", description: "Hoteles enviando encuestas por WhatsApp", target: "1,500 hoteles" },
  { id: 2, name: "WhatsApp pagado", type: "performance", description: "Hoteles con al menos 1 bolsa de pago contratada", target: "750 hoteles" },
  { id: 3, name: "Penetración AUTH", type: "performance", description: "90% de las OTAs disponibles por hotel", target: "90%" },
  { id: 4, name: "Encuestas Respondidas", type: "performance", description: "Encuestas respondidas (OnSite + FollowUp)", target: "2,000,000" },
  { id: 5, name: "Logins totales", type: "performance", description: "Ingresos no únicos en el período", target: "3,000,000" },
  { id: 6, name: "Smart Replies", type: "performance", description: "Respuestas inteligentes generadas (On, Fu y On)", target: "1,400,000" },
  { id: 7, name: "Hoteles con Desk", type: "performance", description: "Hoteles con al menos 3 casos mensuales", target: "50% del total" },
  { id: 8, name: "Hoteles con Desk Pro", type: "performance", description: "Hoteles pagando suscripción de Desk", target: "40% de hoteles usando Desk" },
  { id: 9, name: "Casos resueltos", type: "performance", description: "Porcentaje de casos resueltos en el año", target: "85%" },
  { id: 10, name: "Conversión MRR (Onboarding)", type: "performance", description: "Porcentaje de hoteles que convierten en Onboarding", target: "85%" },
  { id: 11, name: "Hoteles con Concierge", type: "performance", description: "Hoteles con Concierge de pago", target: "400 hoteles" },
  { id: 12, name: "Nuevo MRR", type: "strategic", description: "Ventas totales de nuevos clientes", target: "$72,000 USD" },
  { id: 13, name: "Upselling", type: "strategic", description: "Ventas totales a clientes existentes", target: "$25,000 USD" },
  { id: 14, name: "Fuga", type: "strategic", description: "Downgrades o clientes que dejan de pagar (máximo)", target: "$14,400 USD" },
];

export const SCORE_THRESHOLDS = {
  GREEN: 70,
  YELLOW: 40,
} as const;

// ---------------------------------------------------------------------------
// PIS Rubric (5 axes summing to 100)
// ---------------------------------------------------------------------------

export const DEV_CYCLE_DAYS = 30; // 6 weeks = 30 working days

export interface PisAxisDef {
  id: "directness" | "magnitude" | "evidence" | "strategic" | "delivery";
  label: string;
  max: number;
  question: string;
  guidance: string;
  bands: { min: number; description: string }[];
}

export const PIS_AXES: readonly PisAxisDef[] = [
  {
    id: "directness",
    label: "Directness",
    max: 30,
    question: "¿Existe un mecanismo causal claro entre la iniciativa y un KPI?",
    guidance:
      "Busca la cadena causal más corta entre la iniciativa y un KPI del 2026. Mientras más intermediarios, menor puntaje.",
    bands: [
      { min: 25, description: "Mueve directamente un KPI sin intermediarios. La relación causa-efecto es obvia y medible." },
      { min: 18, description: "Cadena causal clara pero con 1-2 pasos intermedios bien definidos." },
      { min: 10, description: "Conexión indirecta: depende de comportamiento de usuarios o de varias condiciones." },
      { min: 0, description: "Sin conexión clara a un KPI — mecanismo especulativo o no identificado." },
    ],
  },
  {
    id: "magnitude",
    label: "Magnitude",
    max: 25,
    question: "¿Cuánto mueve el KPI en términos absolutos? No porcentuales, absolutos.",
    guidance:
      "Cuantifica en términos ABSOLUTOS (número de hoteles, $ USD, # encuestas, # logins), nunca en porcentajes. Si no puedes estimar un número concreto, usa la banda baja.",
    bands: [
      { min: 20, description: "Movimiento grande y material: cientos de hoteles, decenas de miles de USD, o cientos de miles de eventos." },
      { min: 14, description: "Movimiento moderado: decenas de hoteles, miles de USD, o decenas de miles de eventos." },
      { min: 7, description: "Movimiento pequeño pero medible, o grande pero concentrado en pocos clientes." },
      { min: 0, description: "Movimiento mínimo, imposible de cuantificar, o solo mejoras cualitativas." },
    ],
  },
  {
    id: "evidence",
    label: "Evidence",
    max: 20,
    question: "¿Qué evidencia tenemos de que esto importa?",
    guidance:
      "Datos observados, feedback recurrente de clientes, benchmarks, tickets de soporte, análisis semántico. Una hipótesis sin datos observables es evidence baja. Una hipótesis con datos blandos (opinión interna) es evidence media.",
    bands: [
      { min: 16, description: "Datos cuantitativos sólidos: métricas actuales, análisis de uso, benchmarks externos, estudios." },
      { min: 11, description: "Feedback cualitativo recurrente de múltiples clientes o equipos, respaldado por algún dato parcial." },
      { min: 5, description: "Intuición informada por experiencia interna o pocos datapoints anecdóticos." },
      { min: 0, description: "Sin evidencia — solo opinión o suposición." },
    ],
  },
  {
    id: "strategic",
    label: "Strategic leverage",
    max: 15,
    question: "¿Desbloquea otras cosas? ¿Cierra un gap competitivo?",
    guidance:
      "Apalancamiento estratégico: habilita futuras iniciativas, cierra un gap vs competidores, construye capacidad reutilizable, o protege un flanco defensivo (seguridad, compliance).",
    bands: [
      { min: 12, description: "Desbloquea múltiples iniciativas futuras, cierra un gap crítico vs competidores, o crea capacidad reutilizable." },
      { min: 8, description: "Habilita 1 iniciativa futura clara, o mejora la posición competitiva en un área." },
      { min: 3, description: "Apalancamiento débil: mejora incremental sin efecto en roadmap o competitividad." },
      { min: 0, description: "Sin apalancamiento estratégico — esfuerzo aislado." },
    ],
  },
  {
    id: "delivery",
    label: "Delivery confidence",
    max: 10,
    question: `¿2 devs (1 FE + 1 BE) pueden entregar algo significativo en un ciclo de ${DEV_CYCLE_DAYS} días?`,
    guidance: `Asume 1 frontend + 1 backend con un ciclo de ${DEV_CYCLE_DAYS} días hábiles. Puntaje alto si \`jornadas\` cabe holgadamente en el ciclo con scope claro; bajo si el scope excede el ciclo, depende de integraciones externas, o no tiene definición clara. Iniciativas multi-producto son más riesgosas.`,
    bands: [
      { min: 8, description: "Scope claro, encaja en el ciclo, bajo riesgo técnico. 'Podemos empezar mañana.'" },
      { min: 5, description: "Scope razonable pero con dependencias o áreas grises. Requiere refinamiento antes de ejecutar." },
      { min: 2, description: "Scope grande o incierto, excede el ciclo, o requiere integraciones complejas." },
      { min: 0, description: "Scope no viable para 1 ciclo con este equipo." },
    ],
  },
] as const;

// Helpers used by the score endpoint and UI

export function clampAxisScore(axisId: PisAxisDef["id"], rawScore: number): number {
  const axis = PIS_AXES.find((a) => a.id === axisId);
  if (!axis) return 0;
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) return 0;
  return Math.max(0, Math.min(axis.max, Math.round(rawScore)));
}

export function sumAxisScores(rubric: Record<PisAxisDef["id"], { score: number }>): number {
  return PIS_AXES.reduce((total, axis) => {
    const raw = rubric[axis.id]?.score ?? 0;
    return total + clampAxisScore(axis.id, raw);
  }, 0);
}

// Color ramp for axis cells in the matrix view. Normalized per-axis so
// Delivery (max 10) and Directness (max 30) render on the same scale.
export function axisRatio(axisId: PisAxisDef["id"], score: number | null | undefined): number {
  if (score == null) return 0;
  const axis = PIS_AXES.find((a) => a.id === axisId);
  if (!axis) return 0;
  return Math.max(0, Math.min(1, score / axis.max));
}
