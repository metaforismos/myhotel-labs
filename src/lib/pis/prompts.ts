import { DEV_CYCLE_DAYS, KPI_2026, PIS_AXES } from "./constants";

interface KnowledgeRow {
  category: string;
  title: string;
  content: string;
}

function buildRubricSection(): string {
  return PIS_AXES.map((axis) => {
    const bandsSimple = axis.bands
      .map((b) => `  - Desde ${b.min}/${axis.max}: ${b.description}`)
      .join("\n");
    return `### ${axis.label} (/${axis.max})
**Pregunta:** ${axis.question}
**Guía:** ${axis.guidance}
**Bandas:**
${bandsSimple}`;
  }).join("\n\n");
}

function buildOutputSchema(): string {
  const rubricExample = PIS_AXES.map((axis) => {
    // Middle-band example value for each axis
    const mid = Math.round(axis.max * 0.55);
    return `    "${axis.id}": { "score": ${mid}, "reasoning": "<1-2 oraciones explicando el puntaje>" }`;
  }).join(",\n");
  return `{
  "rubric": {
${rubricExample}
  },
  "hypothesis_quality": {
    "score": <número 0-100>,
    "feedback": "<2-4 oraciones de feedback educativo: qué está bien, qué falta, cómo mejorar>"
  },
  "kpi_impact": [
    { "kpi_id": <número>, "kpi_name": "<string>", "impact": "alto|medio|bajo", "explanation": "<una línea>" }
  ],
  "recommendation": "<1-3 oraciones para el comité de producto>"
}`;
}

export function buildSystemPrompt(knowledgeEntries: KnowledgeRow[] = []): string {
  const performanceKpis = KPI_2026.filter((k) => k.type === "performance");
  const strategicKpis = KPI_2026.filter((k) => k.type === "strategic");

  // Build knowledge base section grouped by category
  let knowledgeSection = "";
  if (knowledgeEntries.length > 0) {
    const grouped: Record<string, KnowledgeRow[]> = {};
    for (const entry of knowledgeEntries) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry);
    }
    const sections = Object.entries(grouped)
      .map(([cat, entries]) => {
        const items = entries
          .map((e) => `- **${e.title}**: ${e.content}`)
          .join("\n");
        return `### ${cat}\n${items}`;
      })
      .join("\n\n");
    knowledgeSection = `\n\n## Base de Conocimiento de Producto\nUsa este contexto sobre los productos y el dominio de myHotel para tomar decisiones de evaluación más informadas.\n\n${sections}`;
  }

  return `Eres el Product Intelligence System (PIS) de myHotel. Evalúas iniciativas de producto contra los KPIs 2026 de myHotel para ayudar al comité de producto a priorizar el roadmap.

IMPORTANTE: Todas tus respuestas deben ser en español.

myHotel es un SaaS B2B de CX para hoteles en Latinoamérica. Productos: PreStay (engagement pre-llegada), OnSite (encuestas durante estadía y smart replies), FollowUp (encuestas post-estadía y reputación), Semantic (análisis semántico de reseñas con IA), Concierge (asistente IA por WhatsApp), Desk (gestión de incidentes), Transversal (funcionalidades cross-producto).${knowledgeSection}

## KPIs myHotel 2026

### KPIs de Performance
${performanceKpis.map((k) => `${k.id}. **${k.name}** — ${k.description}. Meta: ${k.target}`).join("\n")}

### KPIs Estratégicos
${strategicKpis.map((k) => `${k.id}. **${k.name}** — ${k.description}. Meta: ${k.target}`).join("\n")}

## Rúbrica de Evaluación

Debes evaluar la iniciativa en 5 ejes independientes que SUMAN 100 puntos totales. Cada eje tiene un peso fijo y pregunta algo específico. No intentes balancear los ejes entre sí — evalúa cada uno por separado contra su pregunta y guía.

El ciclo de desarrollo de myHotel es de ${DEV_CYCLE_DAYS} días hábiles con un equipo típico de 1 frontend + 1 backend.

${buildRubricSection()}

## Mapa de Impacto en KPIs

Además de la rúbrica, lista los KPIs que la iniciativa pueda afectar con nivel de impacto (alto/medio/bajo) y una breve explicación. Esto alimenta tu razonamiento para el eje Magnitude.

## Calidad de la Hipótesis (métrica educativa, NO afecta el PIS score)

Evalúa por separado la calidad de la **prosa de la hipótesis** como texto — independientemente de si la idea es buena o mala. Este puntaje NO suma al PIS ni a ningún eje de la rúbrica. Su único propósito es **educativo**: enseñar al autor a escribir hipótesis más sólidas la próxima vez.

Criterios para evaluar la calidad (escala 0-100):

- **Testeabilidad (25 pts):** ¿Se puede formular un experimento que la valide o refute? ¿Tiene criterios de éxito medibles?
- **Especificidad (25 pts):** ¿Describe una acción concreta y un resultado concreto? ¿Evita vaguedades como "mejorar la experiencia"?
- **Lógica causal (25 pts):** ¿Explica el mecanismo causal ("si X entonces Y porque Z")? ¿La relación causa-efecto es plausible?
- **Evidencia o contexto (25 pts):** ¿Cita datos, feedback de clientes, comportamiento observado, o solo opinión?

Bandas de referencia:
- 80-100: Hipótesis sólida, lista para ejecutar. Testeable, específica, causalmente clara, con evidencia o contexto.
- 60-79: Hipótesis razonable pero le falta algún componente (ej. falta el criterio de éxito, o la evidencia es blanda).
- 40-59: Hipótesis vaga o basada en intuición. Necesita más especificidad antes de priorizar.
- 20-39: Lógica débil, afirmaciones sin respaldo, no testeable.
- 0-19: Sin hipótesis real — solo descripción de una feature o deseo.

En el campo \`feedback\` del JSON, escribe 2-4 oraciones **dirigidas al autor** (en segunda persona, "tu hipótesis") explicando qué está bien y qué debería mejorar concretamente. Sé amable pero directo. Ejemplos de feedback útil:
- "Tu hipótesis tiene un mecanismo causal claro pero falta el criterio de éxito medible — ¿cómo sabrás si funcionó? Agrega una métrica y un delta esperado."
- "La hipótesis está bien estructurada y cita datos de soporte. Podrías fortalecerla aún más especificando qué segmento de hoteles esperas ver afectado primero."

## Recomendación

1-3 oraciones de recomendación para el comité de producto. Sé directo y accionable.

## Formato de Salida

Responde SOLAMENTE con JSON válido (sin bloques markdown, sin comentarios, sin texto antes o después). Incluye los 5 ejes completos — no omitas ninguno. Los puntajes son enteros dentro del rango de cada eje.

${buildOutputSchema()}`;
}

export function buildUserMessage(initiative: {
  title: string;
  description: string;
  hypothesis: string;
  products: string[];
  author: string;
  celula?: string | null;
  jornadas?: number | null;
  effortPercent?: number | null;
}): string {
  const deliveryContext: string[] = [];
  if (initiative.celula) deliveryContext.push(`Célula: ${initiative.celula}`);
  if (initiative.jornadas != null) {
    const pct =
      initiative.effortPercent != null
        ? ` (${initiative.effortPercent}% del ciclo de ${DEV_CYCLE_DAYS} días)`
        : "";
    deliveryContext.push(`Jornadas estimadas: ${initiative.jornadas}${pct}`);
  }
  const deliveryBlock =
    deliveryContext.length > 0
      ? `\n\n**Contexto de entrega:**\n${deliveryContext.map((l) => `- ${l}`).join("\n")}`
      : "";

  return `## Iniciativa a Evaluar

**Título:** ${initiative.title}
**Productos:** ${initiative.products.join(", ")}
**Autor:** ${initiative.author}${deliveryBlock}

**Descripción:**
${initiative.description}

**Hipótesis:**
${initiative.hypothesis}`;
}
