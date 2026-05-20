# Mini-PRD — Navegación acordeón trazable (addendum del prototipo Semántico v2)

**Complementa:** `docs/semántico/PRD-prototipo-claude-code.md` (§5 UI) y `docs/PRD-Semantico-v2.md` (§9).
**Qué es:** la vista de navegación principal del Resumen — un acordeón jerárquico que deja al hotelero bajar de lo agregado a la frase real, sin perder trazabilidad.

---

## 1. Estructura: drill de 4 niveles

```
Área            (Housekeeping)                      → fila raíz
  └ Tema        (Limpieza del baño / ascensor / restaurant)
      └ Subtema (Migajas, Bandeja)                  → neutro, sin adjetivo
          └ Comentarios reales                      → la frase del huésped, span resaltado
```

Cada nivel se expande/colapsa (`›` colapsado, `▾` expandido). El último nivel (Comentarios) puede ser inline o un click-through a la pantalla Comentarios ya filtrada por ese subtema. **Siempre se tiene que poder llegar a la cita textual.**

## 2. Dos lentes (toggle arriba: **Ver por: Área | Dimensión**)

Mismo componente acordeón, distinta raíz:

- **Por Área** (default): Área → Tema → Subtema → Comentarios. Responde "¿quién lo arregla?".
- **Por Dimensión:** Dimensión (Limpieza, Trato, Estado…) → Tema → Subtema → Comentarios. Responde "¿qué cualidad mejoro, transversal a todo el hotel?". Acá "Limpieza" agrupa baño + ascensor + restaurant + piscina aunque vivan en áreas distintas.

Las dos lentes son obligatorias; sin la de Dimensión se pierde el insight transversal.

## 3. Columnas y números por nivel

`N° · Etiqueta · Positivas · Negativas · Índice semántico (dot color + %)`

- Cada fila (área, tema, subtema) muestra **sus propios** Positivas/Negativas/Índice. No solo la raíz.
- **Regla de N mínimo** (configurable, sugerido ≥20): por debajo del umbral, en vez de % mostrar el conteo + un ejemplo ("3 menciones"). Evita que "Bandeja" con 3 menciones aparente tendencia.
- **Semáforo** del índice (rojo→verde), consistente con `globals.css`.

## 4. Sugerencias aparte

La polaridad `sugerencia` **no** entra a Positivas/Negativas ni al índice. Se muestra como badge/columna aparte ("N sugerencias") en la fila, accionable pero sin distorsionar el indicador.

## 5. Reglas de consistencia (críticas)

- **Una sola área primaria por tema (MECE):** cada tema aparece bajo **una** área, nunca duplicado. Lo mismo en la lente Dimensión (cada tema tiene una dimensión).
- **Los números reconcilian entre niveles:** todo número = conteo de menciones que matchean ese camino. Como cada mención tiene exactamente una área primaria, una dimensión y un subtema, vale: `Área = Σ temas = Σ subtemas`. **Test para devs:** assert de que el total del padre = suma de hijos.
- Si un tema aparece bajo el área "equivocada", es señal de mis-mapeo en la tabla → se corrige ahí (la vista lo hace visible, es una feature de auditoría, no un bug de UI).

## 6. Estados

- **Loading:** skeleton por fila.
- **Vacío:** "Sin menciones en el período".
- **Low-N:** conteo + ejemplo en gris, sin %.
- **Subtema propuesto** (de la cola de descubrimiento): badge "nuevo / por revisar"; no suma al índice hasta curarse.

## 7. Estética

Editorial / Bloomberg, densa, tipografía estrecha. Indentación clara por nivel. Iconos `›`/`▾`. Sin emojis. Tokens de color de `globals.css`.

## 8. Criterios de aceptación

- Drill completo Área → Tema → Subtema → comentarios reales con span resaltado.
- Toggle Área/Dimensión re-rootea el mismo árbol sobre los mismos datos.
- Números por nivel con regla de N mínimo; total del padre = suma de hijos (MECE).
- Sugerencias separadas del índice.
- Subtemas mostrados neutros (Migajas, Bandeja), nunca con adjetivo pegado.
- Todo sale de agregaciones sobre el store de menciones (sin backend nuevo).

## 9. Referencia visual

Mockup base (diseño del PO): tabla `N° · Área · Positivas · Negativas · Índice semántico`, fila "Housekeeping ▾ → 90 / 10 / 90%●", con temas "Limpieza del baño ›", "Limpieza del ascensor ›", "Limpieza del restaurant ▾" → subtemas "Migajas", "Bandeja". Este mini-PRD extiende ese mockup con: toggle de Dimensión, números en cada nivel, sugerencias aparte y el drill final a comentarios.
