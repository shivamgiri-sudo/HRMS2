import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Building2, Home } from "lucide-react";
import { StatusChip, type HealthStatus } from "./StatusChip";
import "./look/look.css";

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
  /** The emailed report's status (Critical / Watch / Healthy), labelled so it never reads as the score band. */
  status?: HealthStatus;
  date?: string;
  homeFallback?: boolean;
  tabs?: BhTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Branch / date / refresh controls, rendered inside the banner. */
  controls?: ReactNode;
  children?: ReactNode;
}

/**
 * Dark navy banner in the Process Operations look (rainbow top line, soft highlight) holding the title,
 * the controls and the page tablist (active pill white). Tabs scroll sideways inside the banner on narrow
 * screens; arrow keys, Home and End move between them.
 */
export function BranchHero({ branchName, status, date, homeFallback, tabs = BH_SECTIONS, activeTab, onTabChange, controls, children }: BranchHeroProps) {
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
    <div className="bhl-hero" data-keep-gradient>
      <div className="bhl-hero-orb" aria-hidden="true" />
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="bhl-eyebrow">MAS PeopleOS · Branch Head</p>
          <h1 className="mt-1 flex items-center gap-2 text-[20px] font-bold leading-tight [.role-dashboard-reference_&]:!text-white">
            <Building2 className="h-5 w-5 shrink-0" aria-hidden="true" />Branch health
          </h1>
          <p className="bhl-hero-sub mt-1">Every section of the daily Branch Health email - click any tile to drill in</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
            <span className="min-w-0 truncate text-[15px] font-bold text-white">{branchName}</span>
            {status ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#d6e7f7]">
                Report status <StatusChip status={status} />
              </span>
            ) : null}
            {date ? <span className="tabular-nums font-semibold text-[#d6e7f7]">{date}</span> : null}
          </div>
          {homeFallback ? <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[#d6e7f7]"><Home className="h-4 w-4" aria-hidden="true" />Showing your home branch</p> : null}
        </div>
        {controls ? <div className="relative min-w-0 max-w-full">{controls}</div> : null}
      </div>
      <div role="tablist" aria-label="Branch health sections" className="bhl-tabs relative mt-4 overflow-x-auto">
        {tabs.map((t, i) => {
          const on = t.id === activeTab;
          return (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={tabDomId(t.id)} aria-selected={on} aria-controls={panelDomId(t.id)}
              tabIndex={on ? 0 : -1} onClick={() => onTabChange(t.id)} onKeyDown={(e) => onKey(e, i)} className="bhl-pill min-h-[44px]">
              {t.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
