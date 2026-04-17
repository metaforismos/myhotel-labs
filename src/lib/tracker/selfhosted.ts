// Detección de sitios con motor de reservas o CMS propio ("custom /
// self-hosted") cuando no hay señal de 3rd-party. Es información
// accionable para Sales: estos hoteles son candidatos claros a migrar
// a un IBE moderno.

import psl from "psl";
import type { Detection, RawResource, SelfHostedSignal } from "./types";

const BOOKING_KEYWORDS =
  /\b(reservas?|reservar|reservation|reservations|booking|book|hospedaje|hospedagem|checkout)\b/i;

// Antes comparábamos hostname exacto, pero muchos hoteles ponen el
// booking en un subdominio propio (reservas.hotel.com, book.hotel.com).
// Comparamos el dominio registrable para que esos sitios también
// disparen como "self-hosted booking".
function sameHost(candidate: string, finalUrl: string): boolean {
  try {
    const u = new URL(candidate, finalUrl);
    const b = new URL(finalUrl);
    if (u.hostname === b.hostname) return true;
    const a = psl.get(u.hostname);
    const c = psl.get(b.hostname);
    return !!a && a === c;
  } catch {
    return false;
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
    for (const action of args.form_actions) {
      if (!action) continue;
      if (!BOOKING_KEYWORDS.test(action)) continue;
      if (!sameHost(action, args.finalUrl)) continue;
      self_hosted_booking = {
        kind: "form",
        evidence: action.slice(0, 200),
        label: "Custom / self-hosted",
      };
      break;
    }
    // Paso 2: anchor CTA con texto "Reservar/Book" apuntando a URL interna.
    if (!self_hosted_booking) {
      for (const a of args.anchors) {
        const textMatch = BOOKING_KEYWORDS.test(a.text);
        const pathMatch = (() => {
          try {
            const u = new URL(a.href, args.finalUrl);
            return BOOKING_KEYWORDS.test(u.pathname);
          } catch {
            return false;
          }
        })();
        if (!textMatch && !pathMatch) continue;
        if (!sameHost(a.href, args.finalUrl)) continue;
        self_hosted_booking = {
          kind: "internal_anchor",
          evidence: (a.href || a.text).slice(0, 200),
          label: "Custom / self-hosted",
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
      if (!sameHost(a.href, args.finalUrl)) continue;
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
