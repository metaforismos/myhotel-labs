import { ComingSoon } from "@/components/tracker/ComingSoon";

export default function TrackerBulkPage() {
  return (
    <ComingSoon
      phase="Fase 1D"
      title="Carga masiva por CSV"
      description="Subir un CSV con URLs (+ columnas opcionales name, city, country, external_id, is_customer) y correr el analyzer en batch con progreso en vivo. Export de resultados como CSV y JSON."
    />
  );
}
