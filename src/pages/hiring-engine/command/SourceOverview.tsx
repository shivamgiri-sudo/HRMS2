/**
 * Top of the Live Meta / Old Meta data sections: the Summary's KPI tiles, the full-journey funnel and daily trend for one source type, the reason behind
 * any zero, and (Old Meta data) the one-tap widen. Shown whether or not a stream exists; the streams list follows below it.
 */
import { Info } from "lucide-react";
import KpiStrip from "./charts/KpiStrip";
import YieldChart from "./charts/YieldChart";
import { BTN } from "./charts/ChartFrame";
import JourneyFunnel from "./charts/JourneyFunnel";
import { yieldView } from "./charts/summaryView";
import { TYPE_LABEL, type Filters } from "./driveCommandModel";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import CampaignMapping from "./CampaignMapping";
import { ALL_TIME_HINT, SHOW_ALL_TIME, atWidestRange, scopeToType, showAllTimeFilters, zeroNotes } from "./sourceSectionModel";

/** `now`: the clock for the window rules (tests pin it; the page uses the real time). */
export default function SourceOverview({ analytics, type, filters, onFilters, now }: { analytics: DriveAnalytics; type: SourceType; filters: Filters; onFilters?: (f: Filters) => void; now?: Date }) {
  const scoped = scopeToType(analytics, type);
  const leads = scoped.types[type]?.stages?.leads ?? 0;
  const trend = yieldView(scoped);
  const notes = zeroNotes(analytics, type, filters, now);
  const canWiden = leads === 0 && type === "meta_old" && !atWidestRange(filters, now);
  const label = TYPE_LABEL[type];
  return (
    <div className="space-y-3" data-source-overview={type}>
      <KpiStrip analytics={scoped} only={type} />
      {notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800" aria-label={`Why some ${label} numbers are zero`}>
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-1.5 text-sm text-slate-800 dark:text-slate-100"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden /><span>{n.text}</span></li>
          ))}
        </ul>
      )}
      {canWiden && onFilters && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} onClick={() => onFilters(showAllTimeFilters(filters, now))}>{SHOW_ALL_TIME}</button>
          <span className="text-xs text-slate-600 dark:text-slate-300">{ALL_TIME_HINT}</span>
        </div>
      )}
      {leads > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <JourneyFunnel analytics={scoped} type={type} title={`Funnel: ${label} journey`} />
          {!trend.empty && <YieldChart analytics={scoped} />}
        </div>
      )}
      <CampaignMapping />
    </div>
  );
}
