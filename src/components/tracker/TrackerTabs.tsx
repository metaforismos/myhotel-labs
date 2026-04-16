"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/tracker", label: "Overview" },
  { href: "/tracker/search", label: "Search" },
  { href: "/tracker/bulk", label: "Bulk" },
  { href: "/tracker/browse", label: "Browse" },
  { href: "/tracker/discovery", label: "Discovery" },
  { href: "/tracker/prospecting", label: "Prospecting" },
];

export function TrackerTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const isActive =
          t.href === "/tracker" ? pathname === "/tracker" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? "border-accent text-accent-light"
                : "border-transparent text-text-dim hover:text-text-muted"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
