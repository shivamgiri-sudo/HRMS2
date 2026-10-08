/** "Plan to raise footfall" for one drive: the arithmetic in words and a table; the Plan section holds the what-if sliders (linked). */
import { useId } from "react";
import { CalendarRange, Footprints } from "lucide-react";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { BTN, Note } from "./charts/ChartFrame";
import { PLAN_LINK_TEXT, SHARED_SEATS_NOTE, footfallPlan } from "./footfallModel";

export default function FootfallPlan({ analytics, type, planHref }: { analytics: DriveAnalytics; type: SourceType; planHref?: string }) {
  const titleId = `footfall-${type}-${useId().replaceAll(":", "")}`;
  const p = footfallPlan(analytics, type);
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-footfall={type}>
      <h3 id={titleId} className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100"><Footprints className="h-4 w-4" aria-hidden /> Plan to raise footfall: {p.label}</h3>
      {!p.available ? <p className="text-sm text-slate-700 dark:text-slate-200">{p.unavailableText}</p> : (
        <>
          <p className="text-sm text-slate-800 dark:text-slate-100">{p.summary}</p>
          {p.openSeats > 0 && (
            <>
              <Note>{p.targetText}</Note>
              <Note>{SHARED_SEATS_NOTE}</Note>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-left text-xs text-slate-800 dark:text-slate-100">
                  <caption className="sr-only">{p.table.caption}</caption>
                  <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                    {p.table.columns.map((c, i) => <th key={c} scope="col" className={`px-2 py-1 font-semibold ${i ? "text-right" : ""}`}>{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {p.needs.map((n) => (
                      <tr key={n.stage} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                        <th scope="row" className="px-2 py-1.5 font-medium">{n.label}</th>
                        <td className="px-2 py-1.5 text-right tabular-nums">{n.base}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{n.rateText}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums"><strong>{n.neededText}</strong>{n.note && <span className="block max-w-[16rem] whitespace-normal text-[11px] font-normal text-slate-700 dark:text-slate-200">{n.note}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {p.closedRequisitions > 0 && <Note>{`${p.closedRequisitions} ${p.closedRequisitions === 1 ? "requisition in scope is" : "requisitions in scope are"} closed or full and add no seats.`}</Note>}
        </>
      )}
      {planHref && <a href={planHref} className={BTN}><CalendarRange className="h-3.5 w-3.5" aria-hidden /> {PLAN_LINK_TEXT}</a>}
    </section>
  );
}
