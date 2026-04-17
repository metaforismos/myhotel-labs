// Extracción de presencia en OTAs desde los outbound links del sitio
// del hotel. Los hoteles suelen linkear directamente a sus perfiles
// de Booking/TripAdvisor/Expedia/etc. — esos enlaces son la forma más
// barata y confiable de saber en qué OTAs están listados.
//
// Fallback con SerpAPI/Serper queda como Fase 1C.2 (opcional).

export type OtaProfile = {
  ota: OtaName;
  profile_url: string;
  host: string;
  confidence: number;
};

export type OtaName =
  | "booking"
  | "expedia"
  | "tripadvisor"
  | "airbnb"
  | "vrbo"
  | "hotels"
  | "agoda"
  | "despegar"
  | "trivago"
  | "kayak"
  | "hotelscom"
  | "google";

// Patrón de host → nombre canónico de OTA. Cubrimos .com y variantes
// regionales (.com.ar, .com.br, .cl, .mx, .es, etc.).
const OTA_HOST_MAP: { re: RegExp; ota: OtaName }[] = [
  { re: /(^|\.)booking\.com$/i, ota: "booking" },
  { re: /(^|\.)expedia\.(com|com\.ar|com\.br|mx|cl|es)$/i, ota: "expedia" },
  {
    re: /(^|\.)tripadvisor\.(com|cl|com\.ar|com\.br|com\.mx|es)$/i,
    ota: "tripadvisor",
  },
  { re: /(^|\.)airbnb\.(com|cl|com\.ar|com\.br|com\.mx|es)$/i, ota: "airbnb" },
  { re: /(^|\.)vrbo\.com$/i, ota: "vrbo" },
  { re: /(^|\.)hotels\.com$/i, ota: "hotels" },
  { re: /(^|\.)agoda\.com$/i, ota: "agoda" },
  { re: /(^|\.)despegar\.(com|com\.ar|cl|com\.mx|com\.br)$/i, ota: "despegar" },
  { re: /(^|\.)decolar\.com$/i, ota: "despegar" },
  { re: /(^|\.)trivago\.(com|cl|com\.ar|com\.mx|com\.br)$/i, ota: "trivago" },
  { re: /(^|\.)kayak\.com$/i, ota: "kayak" },
  { re: /(^|\.)hoteles\.com$/i, ota: "hotelscom" },
];

function classifyHost(host: string): OtaName | null {
  for (const { re, ota } of OTA_HOST_MAP) {
    if (re.test(host.toLowerCase())) return ota;
  }
  // Google Hotels: matched por path, no sólo host.
  return null;
}

function isGoogleHotelsLink(url: URL): boolean {
  if (!/^(www\.)?google\.(com|[a-z]{2,3})(\.[a-z]{2})?$/i.test(url.hostname))
    return false;
  const p = url.pathname.toLowerCase();
  return (
    p.includes("/hotels/") ||
    p.includes("/travel/hotels") ||
    p.includes("/maps/place/")
  );
}

export function extractOtaPresence(outboundLinks: string[]): OtaProfile[] {
  const byOta = new Map<OtaName, OtaProfile>();

  for (const raw of outboundLinks) {
    try {
      const u = new URL(raw);
      let ota = classifyHost(u.hostname);
      if (!ota && isGoogleHotelsLink(u)) ota = "google";
      if (!ota) continue;

      // Confianza más alta cuando el path referencia un perfil específico
      // (/hotel/xxx, /Hotel_Review-..., /rooms/..., /h/slug).
      const specific =
        /\/hotel\/|\/hotel-|\/room[s]?\/|\/property|\/propiedad|\/h\/|hotel_review|\/listings?\/|\/propiedades/i.test(
          u.pathname
        );
      const confidence = specific ? 0.95 : 0.75;

      const existing = byOta.get(ota);
      // Preferimos el link con path específico si aparece. Si dos tienen
      // path específico, nos quedamos con el primero que apareció.
      if (!existing || (confidence > existing.confidence)) {
        byOta.set(ota, {
          ota,
          host: u.hostname,
          profile_url: u.toString().slice(0, 500),
          confidence,
        });
      }
    } catch {
      /* skip malformed URLs */
    }
  }

  return Array.from(byOta.values());
}
