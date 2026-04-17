// Detección de sitios con motor de reservas o CMS propio ("custom /
// self-hosted") cuando no hay señal de 3rd-party. Es información
// accionable para Sales: estos hoteles son candidatos claros a migrar
// a un IBE moderno.

import psl from "psl";
import type { Detection, RawResource, SelfHostedSignal } from "./types";

const BOOKING_KEYWORDS =
  /\b(reservas?|reservar|reservation|reservations|booking|book|hospedaje|hospedagem|checkout)\b/i;

// Endpoints que SÍ huelen a motor de reservas (path pegado a acción).
// Los exigimos para aceptar un anchor como "self-hosted booking" y
// evitar falsos positivos tipo /contact, /how-to-book, /manage-reservation,
// /privacy-policy — páginas informativas que matchean el keyword laxo.
const BOOKING_ENDPOINT =
  /\/(?:book(?:ing)?|reserv(?:a|ar|as|e|ation|ations)?|checkout|engine|hotel[-_]booking|make[-_]reservation|new[-_]reservation)\/?(?:\?|$)|\.(?:php|aspx|jsp|cfm)(?:\?|$)/i;

// Rechazamos explícitamente estas paths aunque tengan keyword — son
// páginas informativas / administrativas, no el motor de reservas.
const BOOKING_NEGATIVE =
  /\/(?:how[-_]?to[-_]?book|manage[-_]?(?:my[-_]?)?reservation|find[-_]?reservation|reservation[-_]?policy|revisar[-_]?reserva|contrato[-_]?(?:de[-_]?)?hospeda|contact|contacto|terms|privacy|about|sobre)\b/i;

// Compara hostname exacto (preferido, alta confianza) o registrable
// domain (mismo hotel en otro subdominio, confianza menor — puede ser
// booking white-label de Omnibees/Cloudbeds detrás de reservas.X).
function hostRelation(
  candidate: string,
  finalUrl: string
): "same_host" | "same_registrable" | null {
  try {
    const u = new URL(candidate, finalUrl);
    const b = new URL(finalUrl);
    if (u.hostname === b.hostname) return "same_host";
    const a = psl.get(u.hostname);
    const c = psl.get(b.hostname);
    if (!!a && a === c) return "same_registrable";
    return null;
  } catch {
    return null;
  }
}

export function detectSelfHosted(args: {
  html: string;
  finalUrl: string;
  form_actions: string[];
  anchors: { href: string; text: string }[];
  detections: Detection[];
  resources: RawResource[];
}): {
  self_hosted_booking: SelfHostedSignal | null;
  self_hosted_cms: SelfHostedSignal | null;
} {
  const hasBooking3p =
    args.detections.some((d) => d.category === "booking_engine") ||
    args.resources.some((r) => r.role_hint === "booking_engine");
  const hasCms3p =
    args.detections.some((d) => d.category === "cms") ||
    args.resources.some((r) => r.role_hint === "cms");

  let self_hosted_booking: SelfHostedSignal | null = null;

  if (!hasBooking3p) {
    // Paso 1: <form action="reservas.php" ...> (o similar) internal.
    // Requiere endpoint específico de booking — no cualquier URL que
    // mencione la palabra "reserva".
    for (const action of args.form_actions) {
      if (!action) continue;
      if (!BOOKING_ENDPOINT.test(action)) continue;
      const rel = hostRelation(action, args.finalUrl);
      if (rel !== "same_host") continue;
      self_hosted_booking = {
        kind: "form",
        evidence: action.slice(0, 200),
        label: "Custom / self-hosted",
      };
      break;
    }

    // Paso 2: anchor CTA. Nueva heurística mucho más estricta:
    //  - href DEBE matchear BOOKING_ENDPOINT (paths tipo /book, /reserva,
    //    .php, .aspx, /checkout) — rechaza /contact, /about, /how-to-book,
    //    /manage-reservation, /privacy-policy y similares que antes se
    //    colaban.
    //  - href NUNCA puede empezar con "#" — son anclas de página, no
    //    booking flows.
    //  - hostRelation distingue same_host (tier 3, alta) vs
    //    same_registrable (subdominio propio, tier 4, puede ser
    //    white-label — label distinto para no mezclar en stats).
    if (!self_hosted_booking) {
      for (const a of args.anchors) {
        if (!a.href || a.href.startsWith("#")) continue;
        if (a.href.startsWith("mailto:") || a.href.startsWith("tel:")) continue;
        let path: string;
        try {
          path = new URL(a.href, args.finalUrl).pathname;
        } catch {
          continue;
        }
        if (BOOKING_NEGATIVE.test(path)) continue;
        if (!BOOKING_ENDPOINT.test(path)) continue;
        const rel = hostRelation(a.href, args.finalUrl);
        if (!rel) continue;
        self_hosted_booking = {
          kind: "internal_anchor",
          evidence: a.href.slice(0, 200),
          label:
            rel === "same_host"
              ? "Custom / self-hosted"
              : "Booking subdominio propio (probable white-label)",
        };
        break;
      }
    }
  }

  let self_hosted_cms: SelfHostedSignal | null = null;
  if (!hasCms3p) {
    const extCounts = new Map<string, number>();
    for (const a of args.anchors) {
      if (!a.href) continue;
      if (hostRelation(a.href, args.finalUrl) !== "same_host") continue;
      try {
        const u = new URL(a.href, args.finalUrl);
        const m = u.pathname.match(/\.(php|aspx|jsp|cfm)$/i);
        if (m) {
          const ext = m[1].toLowerCase();
          extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
        }
      } catch {
        /* skip */
      }
    }
    if (extCounts.size > 0) {
      const [topExt, count] = [...extCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0];
      if (count >= 2) {
        const label =
          topExt === "php"
            ? "Custom (PHP)"
            : topExt === "aspx"
              ? "Custom (ASP.NET)"
              : topExt === "jsp"
                ? "Custom (JSP)"
                : "Custom (ColdFusion)";
        self_hosted_cms = {
          kind: "extension",
          evidence: `.${topExt} en ${count} enlaces internos`,
          label,
        };
      }
    }
  }

  return { self_hosted_booking, self_hosted_cms };
}
