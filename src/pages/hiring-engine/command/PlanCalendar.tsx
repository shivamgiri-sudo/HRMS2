/**
 * Calendar of the Plan section: an accessible table (rows = streams, columns = days). Each cell prints "<lined up> / <seats>" and the
 * day's fill word; the sequential blue shade only repeats what the text says (never the only signal).
 */
import { calendarView, type FillWord } from "./planModel";
import type { DrivePlan } from "./driveCommandTypes";

// Sequential shades (light and dark), lightest = empty; text stays slate-900 / slate-100 on every step (4.5:1).
const SHADE: Record<number, string> = {
  0: "bg-white dark:bg-slate-900",
  1: "bg-blue-50 dark:bg-blue-950",
  2: "bg-blue-100 dark:bg-blue-900",
  3: "bg-blue-200 dark:bg-blue-800",
  4: "bg-blue-300 dark:bg-blue-700",
};
const WORD_LABEL: Record<FillWord, string> = { empty: "empty", low: "low", good: "good", full: "full", over: "over" };

export default function PlanCalendar({ plan }: { plan: Pick<DrivePlan, "days" | "calendar"> }) {
  const v = calendarView(plan);
  if (v.rows.length === 0 || v.days.length === 0) return null;
  return (
    <section aria-labelledby="plan-calendar-heading" className="space-y-2">
      <h4 id="plan-calendar-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100">Calendar: seats per day and stream</h4>
      <p className="text-xs text-slate-700 dark:text-slate-200">
        Each cell: people lined up from that stream / seats on the day. The word says how full the day is across all streams (empty, low under 25%, good under 75%, full, over).
      </p>
      <div className="relative overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full border-collapse text-sm">
          <caption className="sr-only">Seats lined up per stream and day against the day&apos;s capacity, with the day&apos;s fill level</caption>
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100">Stream</th>
              {v.days.map((d) => <th key={d.date} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100">{d.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.streamId} className="border-t border-slate-200 dark:border-slate-700">
                <th scope="row" className="max-w-xs break-words px-3 py-2 text-left text-xs font-semibold text-slate-900 dark:text-slate-100">{r.label}</th>
                {r.cells.map((c) => (
                  <td key={c.date} className={`whitespace-nowrap px-3 py-2 text-slate-900 dark:text-slate-100 ${SHADE[c.step] ?? SHADE[0]}`}>
                    <span className="font-semibold tabular-nums">{c.text}</span>
                    <span className="ml-1 text-xs">{WORD_LABEL[c.word]}</span>
                    {!c.open && <span className="block text-xs text-slate-700 dark:text-slate-200">not open</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
