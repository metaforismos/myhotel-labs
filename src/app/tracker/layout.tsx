import { TrackerTabs } from "@/components/tracker/TrackerTabs";

export const metadata = { title: "Tracker — myHotel Labs" };

export default function TrackerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-text">Tracker</h1>
          <p className="text-xs text-text-dim mt-1">
            Base de datos viva de hoteles en LatAm + USA — stack tecnológico, OTAs,
            contactos y prospección.
          </p>
        </div>
      </div>
      <TrackerTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
