/**
 * Hiring Engine hub: tabs for the unified lead pool, drives, the live walk-in board and the template registry.
 * The selected tab is kept in the URL hash so a branch HR can bookmark "#board".
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

const LeadsTab = lazy(() => import("./LeadsTab"));
const DrivesTab = lazy(() => import("./DrivesTab"));
const BoardTab = lazy(() => import("./BoardTab"));
const TemplatesTab = lazy(() => import("./TemplatesTab"));

const TABS = [
  { id: "board", label: "Walk-in board" },
  { id: "drives", label: "Drives" },
  { id: "leads", label: "Lead pool" },
  { id: "templates", label: "Templates" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const fromHash = (): TabId => (TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? "board");

export default function HiringEnginePage() {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => { const h = () => setTab(fromHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  const go = (id: TabId) => { window.location.hash = id; setTab(id); };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Sparkles className="h-5 w-5 text-blue-600" aria-hidden /> Hiring Engine</h1>
          <p className="text-sm text-slate-600">Turn open positions into walk-ins: who to invite, who confirmed, who is on the way, and what to do next.</p>
        </header>
        <nav role="tablist" aria-label="Hiring Engine sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => go(t.id)}
              className={`-mb-px cursor-pointer whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading…</div>}>
          {tab === "board" && <BoardTab />}
          {tab === "drives" && <DrivesTab />}
          {tab === "leads" && <LeadsTab />}
          {tab === "templates" && <TemplatesTab />}
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
