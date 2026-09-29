import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAtsOverview, type OverviewPeriod } from "@/hooks/useAtsOverview";
import { DrillProvider } from "@/components/ats/overview/drill";
import { useBranchOptions } from "@/components/ats/overview/shell";
import { VIZ_CSS } from "@/components/ats/overview/viz";
import { InsightsOverviewSection } from "./InsightsOverviewSection";
import { InsightsAnalyticsSection } from "./InsightsAnalyticsSection";

const PERIODS: { key: OverviewPeriod; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" }, { key: "all", label: "All" },
];
const VIEWS = [{ key: "overview", label: "Overview" }, { key: "analytics", label: "Analytics" }] as const;

/**
 * Insights tab: trends, movers, anomalies, interview quality and offer economics, with drill-down on every element.
 * It has its own period and branch controls (the page-level FTD/WTD/MTD filters do not apply here) and is served by
 * /api/ats/dashboard/*, which uses the same reporting scope (record_type, IDC) and vocabulary as the other tabs.
 */
export function InsightsTab() {
  const [period, setPeriod] = useState<OverviewPeriod>("30d");
  const [branch, setBranch] = useState("");
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("overview");
  const { data: ov } = useAtsOverview("30d", "");
  const branchOptions = useBranchOptions(ov?.branches.map((b) => b.name), "");
  // Analytics answers are meaningful over months, so it offers 30D / 90D / All only.
  const periods = view === "analytics" ? PERIODS.filter((p) => ["30d", "90d", "all"].includes(p.key)) : PERIODS;
  const effective: OverviewPeriod = periods.some((p) => p.key === period) ? period : "90d";

  return (
    <DrillProvider>
      <div className="ats-viz space-y-4 text-foreground">
        <style>{VIZ_CSS}</style>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-2">
          <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Insights view">
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)} aria-pressed={view === v.key}
                className={`min-h-[36px] cursor-pointer rounded-lg px-4 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${view === v.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} aria-pressed={effective === p.key}
                  className={`min-h-[36px] min-w-[44px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${effective === p.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}>{p.label}</button>
              ))}
            </div>
            <Select value={branch || "all"} onValueChange={(v) => setBranch(v === "all" ? "" : v)}>
              <SelectTrigger className="h-10 w-44" aria-label="Branch"><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All branches</SelectItem>{branchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Independent of the page filters above. Click any chart segment, tile or row to drill down to the candidates behind it.</p>
        {view === "overview" ? <InsightsOverviewSection period={effective} branch={branch} /> : <InsightsAnalyticsSection period={effective} branch={branch} />}
      </div>
    </DrillProvider>
  );
}
