/**
 * Top of the Live Meta / Old Meta data sections: the Summary's KPI tiles, funnel and daily trend for one source type, the reason behind
 * any zero, and (Old Meta data) the one-tap widen. Shown whether or not a stream exists; the streams list follows below it.
 */
import { Info } from "lucide-react";
import KpiStrip from "./charts/KpiStrip";
import YieldChart from "./charts/YieldChart";
import ChartFrame, { BTN, Note } from "./charts/ChartFrame";
import { funnelView, yieldView } from "./charts/summaryView";
import { TYPE_LABEL, pctText, type Filters } from "./driveCommandModel";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import CampaignMapping from "./CampaignMapping";
import { ALL_TIME_HINT, SHOW_ALL_TIME, atWidestRange, scopeToType, showAllTimeFilters, zeroNotes } from "./sourceSectionModel";

/** Funnel of one type as a list: the bar is decoration, the numbers and conversions are the text alternative. */
function SourceFunnel({ analytics, type }: { analytics: DriveAnalytics; type: SourceType }) {
  const v = funnelView(analytics);
  const top = Math.max(1, ...v.rows.map((r) => r.values[type] ?? 0));
  const table = {
    caption: `${TYPE_LABEL[type]} funnel: people at each stage and conversion from the stage before`,
    columns: ["Stage", "People", "From previous stage"],
    rows: v.rows.map((r) => [r.label, r.text[type], r.stage === "leads" ? "–" : pctText(r.conversion[type])]),
  };
  return (
    <ChartFrame title="Funnel" subtitle="People at each stage, with the share that moved on from the stage before." table={table} empty={false} aria={table.caption} kind="grid"
      note={v.untracked ? <Note>Qualified is not tracked yet, so it shows a dash.</Note> : undefined}>
      <ol className="space-y-2">
        {v.rows.map((r) => {
          const n = r.values[type];
          return (
            <li key={r.stage} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs text-slate-800 dark:text-slate-100" data-funnel-stage={r.stage}>
              <span className="font-semibold">{r.label}</span>
              <span className="h-3 min-w-0 rounded bg-slate-100 dark:bg-slate-800" aria-hidden><span className="block h-3 rounded bg-blue-600 dark:bg-blue-400" style={{ width: `${Math.round(((n ?? 0) / top) * 100)}%` }} /></span>
              <span className="text-right tabular-nums"><strong>{r.text[type]}</strong>{r.stage !== "leads" && <span className="text-slate-600 dark:text-slate-300"> ({pctText(r.conversion[type])})</span>}</span>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

export default function SourceOverview({ analytics, type, filters, onFilters }: { analytics: DriveAnalytics; type: SourceType; filters: Filters; onFilters?: (f: Filters) => void }) {
  const scoped = scopeToType(analytics, type);
  const leads = scoped.types[type]?.stages?.leads ?? 0;
  const trend = yieldView(scoped);
  const notes = zeroNotes(analytics, type, filters);
  const canWiden = leads === 0 && type === "meta_old" && !atWidestRange(filters);
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
          <button type="button" className={BTN} onClick={() => onFilters(showAllTimeFilters(filters))}>{SHOW_ALL_TIME}</button>
          <span className="text-xs text-slate-600 dark:text-slate-300">{ALL_TIME_HINT}</span>
        </div>
      )}
      {leads > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SourceFunnel analytics={scoped} type={type} />
          {!trend.empty && <YieldChart analytics={scoped} />}
        </div>
      )}
      <CampaignMapping />
    </div>
  );
}
