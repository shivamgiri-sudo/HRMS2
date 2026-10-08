/**
 * Per-campaign progress in the date range: sortable columns, the largest drop-off of each row marked (icon + words + tint), and a
 * Stalled badge with the server's reason when qualified people got no contact. Wide table scrolls inside its own container.
 */
import { useId, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, TrendingDown } from "lucide-react";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { CAMPAIGN_COLUMNS, STALLED_NOTE, campaignProgressView, sortCampaignRows, type CampaignRowView } from "./campaignProgressModel";
import { Note } from "./charts/ChartFrame";
import { MIN_SAMPLE } from "./charts/journeyModel";

type Dir = "asc" | "desc";
const SORT_BTN = "inline-flex min-h-11 w-full cursor-pointer items-center gap-1 rounded px-1 font-semibold transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800 sm:min-h-8";
const STALLED = "inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100";

function NameCell({ r }: { r: CampaignRowView }) {
  return (
    <th scope="row" className="max-w-[16rem] px-2 py-2 text-left align-top font-semibold">
      <span className="block break-words">{r.name}</span>
      {r.stalled && (
        <span className="mt-1 block space-y-0.5">
          <span className={STALLED}><AlertTriangle className="h-3 w-3" aria-hidden /> Stalled</span>
          {r.stalledWhy.map((w) => <span key={w} className="block break-words text-[11px] font-normal text-slate-700 dark:text-slate-200">{w}</span>)}
        </span>
      )}
      {r.biggestDrop && <span className="mt-1 block text-[11px] font-normal text-slate-700 dark:text-slate-200">Largest drop-off: {r.biggestDrop.text}</span>}
    </th>
  );
}

export default function CampaignProgressTable({ analytics, only, title = "Campaign progress" }: { analytics: Pick<DriveAnalytics, "campaigns" | "window">; only?: SourceType; title?: string }) {
  const titleId = `campaign-progress-${useId().replaceAll(":", "")}`;
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const v = campaignProgressView(analytics, only);
  const rows = sort ? sortCampaignRows(v.rows, sort.key, sort.dir) : v.rows;
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "campaign" || key === "requisition" || key === "branch" || key === "type" ? "asc" : "desc" }));
  const range = `${analytics?.window?.from ?? ""} to ${analytics?.window?.to ?? ""}`;
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-campaign-progress={only ?? "all"}>
      <div className="min-w-0">
        <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300">{`${range}. People per Meta campaign and requisition, from form fill to joined. Select a column heading to sort.`}</p>
      </div>
      {v.stalledCount > 0 && (
        <p role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{`${v.stalledCount} ${v.stalledCount === 1 ? "campaign is" : "campaigns are"} stalled: ${v.stalledPeople} qualified ${v.stalledPeople === 1 ? "person has" : "people have"} had no contact.`}</span>
        </p>
      )}
      {v.empty ? <p className="text-sm text-slate-700 dark:text-slate-200">No Meta campaign activity in this range.</p> : (
        <>
          <div className="space-y-1">
            <Note>{STALLED_NOTE}</Note>
            <Note>{`Rates need at least ${MIN_SAMPLE} people at the stage they start from. Qualified counts screening passes of form fills in this range.`}</Note>
          </div>
          <div className="relative max-h-[32rem] overflow-auto">
            <table className="w-full min-w-max border-collapse text-xs text-slate-800 dark:text-slate-100">
              <caption className="sr-only">Meta campaigns in this range with people at each stage, the largest drop-off of each and whether qualified people are stalled</caption>
              <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  {CAMPAIGN_COLUMNS.map((c) => {
                    const on = sort?.key === c.key;
                    const Icon = !on ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <th key={c.key} scope="col" aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-1 py-1 ${c.kind === "text" ? "text-left" : "text-right"}`}>
                        <button type="button" onClick={() => toggle(c.key)} className={`${SORT_BTN} ${c.kind === "text" ? "justify-start" : "justify-end"}`}>
                          {c.label}<Icon className="h-3 w-3 shrink-0" aria-hidden />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800" data-campaign-row={r.stalled ? "stalled" : "ok"}>
                    <NameCell r={r} />
                    <td className="px-2 py-2">{r.requisition}</td>
                    <td className="px-2 py-2">{r.branch}</td>
                    <td className="px-2 py-2">{r.typeLabel}</td>
                    {CAMPAIGN_COLUMNS.slice(4).map((c) => {
                      const worst = r.biggestDrop?.to === c.key;
                      return (
                        <td key={c.key} className={`px-2 py-2 text-right tabular-nums${worst ? " bg-amber-50 font-bold dark:bg-amber-950" : ""}`} data-worst={worst ? "true" : undefined}>
                          <span className="inline-flex items-center justify-end gap-1">
                            {worst && <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />}
                            {r.texts[c.key]}
                          </span>
                          {worst && <span className="sr-only"> largest drop-off</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
