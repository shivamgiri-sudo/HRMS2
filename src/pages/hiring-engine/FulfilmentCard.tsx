/**
 * Two answers on one card: who walks in today (and the next working day) by branch and hour, and whether each open requisition will be
 * filled by its end date, with the numbers behind the verdict. Reads GET /api/he/fulfilment (read-only).
 */
import { useEffect, useState } from "react";
import { CalendarCheck, Target } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { coveragePct, dayHeadline, dayLabel, VERDICT_LABEL, VERDICT_TONE, type ExpectedDay, type FulfilmentView } from "./fulfilmentModel";

const num = (n: number) => n.toLocaleString("en-IN");
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function DayBlock({ title, day, todayIso }: { title: string; day: ExpectedDay | null; todayIso: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{dayHeadline(day, todayIso)}</p>
      {day && day.branches.length > 0 && (
        <ul className="mt-2 space-y-2">
          {day.branches.map((b) => (
            <li key={b.branch}>
              <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-slate-900 dark:text-slate-100">{b.branch}</span><span className="tabular-nums text-slate-700 dark:text-slate-200">{b.expected} expected · {num(b.booked)} booked · {num(b.confirmed)} confirmed</span></div>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Hours at ${b.branch}`}>
                {b.hours.map((h) => (<li key={h.hour} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-800 dark:bg-slate-800 dark:text-slate-100">{h.hour} · {h.expected} <span className="text-slate-500">of {h.booked}</span></li>))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FulfilmentCard() {
  const [data, setData] = useState<FulfilmentView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () => hrmsApi.get<{ data: FulfilmentView }>("/api/he/fulfilment").then((r) => {
      if (!alive) return;
      setData(r.data); setFailed(false);
      // The table is still being sized on the server (first read after a restart): look again shortly.
      timer = window.setTimeout(() => { if (document.visibilityState === "visible") void load(); }, r.data.computing ? 10_000 : 120_000);
    }).catch(() => { if (alive) { setFailed(true); timer = window.setTimeout(() => void load(), 30_000); } });
    void load();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, []);
  if (failed && !data) return null;
  if (!data) return <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const todayIso = istToday();
  const todayEmpty = data.today.booked === 0;
  return (
    <section aria-labelledby="fc-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div>
        <h2 id="fc-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><CalendarCheck className="h-4 w-4 text-blue-600" aria-hidden /> Who is expected to walk in</h2>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Each booked person is counted by their chance of showing up (learned from past drives). The hour chips read "expected of booked".</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DayBlock title={todayEmpty ? `Today (${dayLabel(todayIso)}): no interviews` : `Today (${dayLabel(todayIso)})`} day={todayEmpty ? null : data.today} todayIso={todayIso} />
        {data.next && <DayBlock title={`Next: ${dayLabel(data.next.date)}`} day={data.next} todayIso={todayIso} />}
      </div>

      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><Target className="h-4 w-4 text-blue-600" aria-hidden /> Will every requisition be filled?</h2>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
          {num(data.totals.seatsOpen)} more selections needed across {data.requisitions.length} requisitions; {data.totals.atRisk} at risk. A requisition is filled when the number of people with an employee code reaches its seats plus 30%; then the next one of the same process, designation and branch starts (nearest end date first). "People covered" is how many must be invited to land the remaining selections, from this process's walk-in and selection history.
        </p>
        {data.computing && <p role="status" className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">Working out how many people each requisition needs from past walk-in and selection history. This takes under a minute after a restart.</p>}
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Open requisitions: seats, end date, people needed and covered, and whether they will be filled</caption>
            <thead className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300">
              <tr><th scope="col" className="py-1 pr-3">Requisition</th><th scope="col" className="px-2 py-1 text-right">Joined / target</th><th scope="col" className="px-2 py-1">End date</th><th scope="col" className="px-2 py-1">People covered</th><th scope="col" className="px-2 py-1 text-right">Expected 7 days</th><th scope="col" className="px-2 py-1">Verdict</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.requisitions.map((r) => (
                <tr key={r.id} className="align-top">
                  <th scope="row" className="py-2 pr-3 font-semibold text-slate-900 dark:text-slate-100"><span className="mr-1.5 inline-block rounded bg-slate-100 px-1.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200" title="Order in which this process fills its requisitions (nearest end date first)">{r.sequence}</span>{r.code}<div className="text-xs font-normal text-slate-600 dark:text-slate-300">{r.branch}{r.process ? ` · ${r.process}` : ""}</div></th>
                  <td className="px-2 py-2 text-right tabular-nums">{r.joined} / {r.target}<div className="text-xs text-slate-500">{r.selected} selected · {r.requested} seats +30%</div></td>
                  <td className="px-2 py-2 tabular-nums">{r.deadline ? dayLabel(r.deadline) : "none"}<div className="text-xs text-slate-500">{r.daysLeft == null ? "" : r.daysLeft > 0 ? `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left` : "passed"}</div></td>
                  <td className="px-2 py-2">
                    <div className="tabular-nums">{num(r.covered)} of {num(r.neededLeads)}</div>
                    <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${coveragePct(r)}%` }} /></div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.expectedArrivals7d}<div className="text-xs text-slate-500">{r.confirmed} confirmed</div></td>
                  <td className="px-2 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${VERDICT_TONE[r.verdict]}`}>{VERDICT_LABEL[r.verdict]}</span><p className="mt-1 max-w-xs text-xs text-slate-700 dark:text-slate-200">{r.reason}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
