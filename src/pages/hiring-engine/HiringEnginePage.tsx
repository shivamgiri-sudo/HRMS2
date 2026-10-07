/**
 * Hiring Engine hub: tabs for the walk-in board, drives, the unified lead pool, manual bulk voice calls and the template registry.
 * The selected tab is kept in the URL hash so a branch HR can bookmark "#board".
 */
import { lazy, Suspense, startTransition, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import MetaRecruitmentStrip from "./MetaRecruitmentStrip";
import { tabFromHash } from "./hiringEngineTabs";

const loaders = {
  board: () => import("./BoardTab"),
  drives: () => import("./DrivesTab"),
  leads: () => import("./LeadsTab"),
  master: () => import("./MasterTab"),
  planner: () => import("./PlannerTab"),
  calls: () => import("./BulkCallsTab"),
  templates: () => import("./TemplatesTab"),
};
const LeadsTab = lazy(loaders.leads);
const DrivesTab = lazy(loaders.drives);
const BoardTab = lazy(loaders.board);
const TemplatesTab = lazy(loaders.templates);
const BulkCallsTab = lazy(loaders.calls);
const MasterTab = lazy(loaders.master);
const PlannerTab = lazy(loaders.planner);

const TABS = [
  { id: "board", label: "Walk-in board" },
  { id: "drives", label: "Drives" },
  { id: "leads", label: "Lead pool" },
  { id: "master", label: "Master" },
  { id: "planner", label: "Planner" },
  { id: "calls", label: "Bulk calls" },
  { id: "templates", label: "Templates" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_IDS = TABS.map((t) => t.id);
const fromHash = (): TabId => tabFromHash(window.location.hash, TAB_IDS, "board");

export default function HiringEnginePage() {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => { const h = () => setTab(fromHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  const go = (id: TabId) => { window.location.hash = id; startTransition(() => setTab(id)); };
  // Warm every other tab's code once the page is idle so switching is instant.
  useEffect(() => {
    const warm = () => (Object.keys(loaders) as TabId[]).forEach((k) => { void loaders[k](); });
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(warm); return () => { (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(h); }; }
    const t = setTimeout(warm, 1500); return () => clearTimeout(t);
  }, []);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Sparkles className="h-5 w-5 text-blue-600" aria-hidden /> Hiring Engine</h1>
          <p className="text-sm text-slate-600">Turn open positions into walk-ins: who to invite, who confirmed, who is on the way, and what to do next.</p>
        </header>
        <MetaRecruitmentStrip />
        <nav role="tablist" aria-label="Hiring Engine sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => go(t.id)} onPointerEnter={() => { void loaders[t.id](); }} onFocus={() => { void loaders[t.id](); }}
              className={`-mb-px cursor-pointer whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <Suspense fallback={<div className="space-y-3" aria-busy="true"><div className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" /><div className="h-48 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" /></div>}>
          {tab === "board" && <BoardTab />}
          {tab === "drives" && <DrivesTab />}
          {tab === "leads" && <LeadsTab />}
          {tab === "master" && <MasterTab />}
          {tab === "planner" && <PlannerTab />}
          {tab === "calls" && <BulkCallsTab />}
          {tab === "templates" && <TemplatesTab />}
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
