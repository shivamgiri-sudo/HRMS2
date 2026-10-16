import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Building2, Home } from "lucide-react";
import { StatusChip, type HealthStatus } from "./StatusChip";

export interface BhTab { id: string; label: string }

/** Tabs of the page, in order. The id doubles as the tab key of the layout's `initialTab`. */
export const BH_SECTIONS: BhTab[] = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "attendance", label: "Attendance" },
  { id: "attrition", label: "Attrition" },
  { id: "finance", label: "Finance" },
  { id: "pnl", label: "P&L" },
  { id: "hiring", label: "Hiring" },
  { id: "backlog", label: "Backlogs" },
  { id: "ops", label: "Operations" },
  { id: "processes", label: "Processes" },
];

export const tabDomId = (id: string) => `bh-tab-${id}`;
export const panelDomId = (id: string) => `bh-panel-${id}`;

export interface BranchHeroProps {
  /** Branch name, or a count line for a multi-branch view. */
  branchName: string;
  status?: HealthStatus;
  date?: string;
  homeFallback?: boolean;
  tabs?: BhTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children?: ReactNode;
}

/**
 * Gradient banner in the DashboardHero style (kit classes), with a real tablist. The tabs scroll
 * sideways inside the banner on narrow screens; arrow keys, Home and End move between them.
 */
export function BranchHero({ branchName, status, date, homeFallback, tabs = BH_SECTIONS, activeTab, onTabChange, children }: BranchHeroProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    onTabChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-700 via-blue-700 to-indigo-800 p-4 text-white shadow-lg sm:p-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{ backgroundImage: "radial-gradient(circle at 15% 20%, white, transparent 45%), radial-gradient(circle at 85% 85%, white, transparent 40%)" }} />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm"><Building2 className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">Branch Head</p>
            <h1 className="text-lg font-bold sm:text-xl">Branch health</h1>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/90">
          <span className="min-w-0 truncate font-semibold text-white">{branchName}</span>
          {status ? <StatusChip status={status} /> : null}
          {date ? <span className="tabular-nums">{date}</span> : null}
        </div>
      </div>
      {homeFallback ? <p className="relative mt-2 flex items-center gap-1.5 text-[13px] text-white/90"><Home className="h-4 w-4" aria-hidden="true" />Showing your home branch</p> : null}
      <div role="tablist" aria-label="Branch health sections" className="relative mt-4 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-white/10 p-1 backdrop-blur-sm [scrollbar-width:none]">
        {tabs.map((t, i) => {
          const on = t.id === activeTab;
          return (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={tabDomId(t.id)} aria-selected={on} aria-controls={panelDomId(t.id)}
              tabIndex={on ? 0 : -1} onClick={() => onTabChange(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${on ? "bg-white text-slate-800 shadow-sm" : "text-white/90 hover:bg-white/10"}`}>
              {t.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
