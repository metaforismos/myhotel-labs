import { ComingSoon } from "@/components/tracker/ComingSoon";

export default function TrackerDiscoveryPage() {
  return (
    <ComingSoon
      phase="Fase 2"
      title="Discovery geográfico"
      description="Dado un país, región o ciudad, descubrir hoteles desde Google Places, Mapbox POI, Booking y TripAdvisor vía SerpAPI. Dedupe fuzzy (nombre + coords 100m). Cada hotel nuevo se manda automáticamente al analyzer v1."
    />
  );
}
