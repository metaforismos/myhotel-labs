"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Order follows the natural flow: look → act → deep dive. The last two
// ("Descubrimiento", "Prospección") are scoped/blocked future work and
// sit behind a visual separator so the day-to-day toolbar is cleaner.
const tabs = [
  { href: "/tracker", label: "Resumen" },
  { href: "/tracker/browse", label: "Hoteles" },
  { href: "/tracker/search", label: "Analizar URL" },
  { href: "/tracker/bulk", label: "Lotes" },
  { href: "/tracker/resources", label: "Proveedores" },
  { href: "/tracker/stats", label: "Métricas" },
];

const futureTabs = [
  { href: "/tracker/discovery", label: "Descubrimiento" },
  { href: "/tracker/prospecting", label: "Prospección" },
];

export function TrackerTabs() {
  const pathname = usePathname();

  const renderTab = (t: { href: string; label: string }, dim?: boolean) => {
    const isActive =
      t.href === "/tracker" ? pathname === "/tracker" : pathname.startsWith(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
          isActive
            ? "border-accent text-accent-light"
            : dim
              ? "border-transparent text-text-dim/70 hover:text-text-dim"
              : "border-transparent text-text-dim hover:text-text-muted"
        }`}
      >
        {t.label}
      </Link>
    );
  };

  return (
    <div className="flex gap-1 border-b border-border items-center flex-wrap">
      {tabs.map((t) => renderTab(t, false))}
      <div className="mx-2 h-5 w-px bg-border" aria-hidden />
      {futureTabs.map((t) => renderTab(t, true))}
    </div>
  );
}
