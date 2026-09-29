import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Filter, LayoutDashboard, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OverviewPeriod } from "@/hooks/useAtsOverview";
import { VIZ_CSS } from "./viz";
import { DrillProvider, useDrillActions, type Actions } from "./drill";

export const PERIODS: { key: OverviewPeriod; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" }, { key: "all", label: "All" },
];

/** Cross-links so every ATS dashboard is one click from the others. */
export const ATS_VIEWS = [
  { to: "/ats/command-center", label: "Command Center" },
  { to: "/ats/recruiter/hiring-dashboard", label: "Hiring" },
  { to: "/ats/sourcing-analysis", label: "Sourcing" },
  { to: "/ats/dashboard-v2", label: "Pipeline" },
];

export function PeriodToggle({ value, onChange, options = PERIODS }: { value: OverviewPeriod; onChange: (p: OverviewPeriod) => void; options?: typeof PERIODS }) {
  return (
    <div className="inline-flex rounded-xl bg-white/10 p-1 backdrop-blur" role="group" aria-label="Period">
      {options.map((p) => (
        <button key={p.key} onClick={() => onChange(p.key)} aria-pressed={value === p.key}
          className={`min-h-[36px] min-w-[44px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${value === p.key ? "bg-white text-[#0b2a5b] shadow" : "text-blue-50 hover:bg-white/15"}`}>{p.label}</button>
      ))}
    </div>
  );
}

export function BranchSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
      <SelectTrigger className="h-10 w-44 border-white/20 bg-white/10 text-white backdrop-blur" aria-label="Branch"><Filter className="mr-1 h-3.5 w-3.5" aria-hidden /><SelectValue placeholder="All branches" /></SelectTrigger>
      <SelectContent><SelectItem value="all">All branches</SelectItem>{options.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Keeps the branch dropdown complete after filtering by remembering the unfiltered option list. */
export function useBranchOptions(names: string[] | undefined, branch: string) {
  const [opts, setOpts] = useState<string[]>([]);
  // Depend on the content, not the array identity: callers pass a freshly mapped array every render.
  const key = names?.join("\u0000") ?? "";
  useEffect(() => { if (key && !branch) setOpts(key.split("\u0000").filter((n) => n !== "Unspecified" && n !== "Unmapped")); }, [key, branch]);
  return opts;
}

interface HeroProps {
  eyebrow: string; title: string; subtitle?: ReactNode; active: string;
  controls?: ReactNode; fetching?: boolean; onRefresh?: () => void; children?: ReactNode;
}

export function Hero({ eyebrow, title, subtitle, active, controls, fetching, onRefresh, children }: HeroProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a5b] via-[#124a9c] to-[#1b6ab5] p-5 pb-16 text-white shadow-lg md:p-7 md:pb-16">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-blue-100"><LayoutDashboard className="h-3.5 w-3.5" aria-hidden />{eyebrow}</div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 flex items-center gap-2 text-xs text-blue-100">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {onRefresh && <Button variant="secondary" size="icon" className="h-10 w-10 bg-white/15 text-white hover:bg-white/25" onClick={onRefresh} disabled={fetching} aria-label="Refresh"><RefreshCcw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} /></Button>}
        </div>
      </div>
      <nav className="relative mt-4 flex flex-wrap gap-1.5" aria-label="ATS dashboards">
        {ATS_VIEWS.map((v) => (
          <Link key={v.to} to={v.to} aria-current={v.label === active ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${v.label === active ? "bg-white text-[#0b2a5b]" : "bg-white/10 text-blue-50 hover:bg-white/20"}`}>{v.label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** Page frame: scoped viz tokens + max width. Content below the hero overlaps it by 3.5rem. */
type Body = ReactNode | ((drill: Actions) => ReactNode);
function FrameBody({ children }: { children: Body }) {
  const drill = useDrillActions();
  return <div className="-mt-14 space-y-4">{typeof children === "function" ? children(drill) : children}</div>;
}

export function DashboardFrame({ hero, children }: { hero: ReactNode; children: Body }) {
  return (
    <DrillProvider>
      <div className="ats-viz mx-auto max-w-[1600px] space-y-4 p-3 text-foreground md:p-6">
        <style>{VIZ_CSS}</style>
        {hero}
        <FrameBody>{children}</FrameBody>
      </div>
    </DrillProvider>
  );
}

/** Start date (YYYY-MM-DD, IST) of a period, used to bound drill-downs so they stay fast. Undefined for "all". */
export function periodFrom(period: OverviewPeriod): string | undefined {
  const days = { today: 0, "7d": 6, "30d": 29, "90d": 89, all: -1 }[period];
  return days < 0 ? undefined : new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
