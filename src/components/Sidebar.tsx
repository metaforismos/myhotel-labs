"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, createContext, useContext } from "react";

const PUBLIC_ROUTES = ["/iniciativas"];

interface NavSection {
  label: string;
  items: { href: string; label: string }[];
}

const sections: NavSection[] = [
  {
    label: "Semantic",
    items: [
      { href: "/", label: "Analysis" },
      { href: "/semantic-v2", label: "v2 Prototype" },
      { href: "/proposals", label: "Proposals" },
      { href: "/explorer", label: "Pool Explorer" },
      { href: "/prompts", label: "Prompts" },
    ],
  },
  {
    label: "Concierge",
    items: [
      { href: "/concierge/pilot-report", label: "Pilot Report" },
      { href: "/concierge/quality-eval", label: "Quality Eval" },
      { href: "/concierge/meta-id", label: "Meta ID" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/analytics", label: "GA4 Explorer" },
      { href: "/analytics/plg-funnel", label: "Concierge PLG Funnel" },
    ],
  },
  {
    label: "Learning",
    items: [
      { href: "/learning/trivia", label: "Entrenamiento" },
      { href: "/learning/skills", label: "Skills" },
    ],
  },
  {
    label: "WhatsApp",
    items: [
      { href: "/whatsapp/templates", label: "Template Qualifier" },
    ],
  },
  {
    label: "PIS",
    items: [
      { href: "/pis", label: "Initiatives" },
    ],
  },
  {
    label: "Tracker",
    items: [
      { href: "/tracker", label: "Resumen" },
      { href: "/tracker/browse", label: "Hoteles" },
      { href: "/tracker/search", label: "Analizar URL" },
      { href: "/tracker/bulk", label: "Lotes" },
      { href: "/tracker/resources", label: "Proveedores" },
      { href: "/tracker/stats", label: "Métricas" },
      { href: "/tracker/discovery", label: "Descubrimiento" },
      { href: "/tracker/prospecting", label: "Prospección" },
    ],
  },
];

// Context so layout can read collapsed state
const SidebarContext = createContext({ desktopCollapsed: false });
export const useSidebarCollapsed = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [desktopCollapsed, setDesktopCollapsed] = useState(false); // starts expanded
  return (
    <SidebarContext.Provider value={{ desktopCollapsed }}>
      <SidebarInner desktopCollapsed={desktopCollapsed} setDesktopCollapsed={setDesktopCollapsed} />
      {children}
    </SidebarContext.Provider>
  );
}

function SidebarInner({
  desktopCollapsed,
  setDesktopCollapsed,
}: {
  desktopCollapsed: boolean;
  setDesktopCollapsed: (v: boolean) => void;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  if (isPublic) return null;

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-3 left-3 z-[60] p-2 bg-surface border border-border rounded-md"
        aria-label="Toggle sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
          {!mobileOpen ? (
            <>
              <path d="M2 4h12" /><path d="M2 8h12" /><path d="M2 12h12" />
            </>
          ) : (
            <>
              <path d="M4 4l8 8" /><path d="M12 4l-8 8" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen bg-surface border-r border-border flex flex-col transition-all duration-200 ease-in-out ${
          desktopCollapsed ? "lg:w-14" : "lg:w-56"
        } w-56 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Brand + collapse toggle */}
        <div className="px-3 h-14 flex items-center justify-between border-b border-border shrink-0">
          {!desktopCollapsed && (
            <Link href="/" className="flex items-center gap-2 group" onClick={() => setMobileOpen(false)}>
              <span className="text-sm font-bold tracking-tight text-text-muted group-hover:text-text transition-colors">
                myHotel
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] bg-labs-yellow-bg text-labs-yellow px-1.5 py-0.5 rounded">
                Labs
              </span>
            </Link>
          )}

          {/* Desktop collapse button */}
          <button
            onClick={() => setDesktopCollapsed(!desktopCollapsed)}
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-md hover:bg-surface-2 transition-colors text-text-dim hover:text-text"
            aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {desktopCollapsed ? (
                <path d="M6 3l5 5-5 5" />
              ) : (
                <path d="M10 3l-5 5 5 5" />
              )}
            </svg>
          </button>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {sections.map((section) => (
            <div key={section.label} className="mb-5">
              {!desktopCollapsed && (
                <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-text-dim">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      title={desktopCollapsed ? item.label : undefined}
                      className={`flex items-center gap-2 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                        desktopCollapsed ? "justify-center px-1" : "px-2.5"
                      } ${
                        isActive
                          ? "bg-accent/15 text-accent-light"
                          : "text-text-muted hover:text-text hover:bg-surface-2"
                      }`}
                    >
                      {desktopCollapsed ? (
                        <span className="text-[10px] font-bold">{item.label.slice(0, 2).toUpperCase()}</span>
                      ) : (
                        item.label
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        {!desktopCollapsed && (
          <div className="px-4 py-3 border-t border-border shrink-0">
            <span className="text-[10px] text-text-dim">Semantic Analysis Engine</span>
          </div>
        )}
      </aside>
    </>
  );
}

// Keep backward compat export
export function Sidebar() {
  return null; // replaced by SidebarProvider
}
