// "Is the attendance pipeline healthy?" - last runs of the jobs that create attendance records, and per-branch
// coverage for the last 7 days. A cut-off nightly run shows up here as a dip, so HR can see that the SYSTEM
// missed a day instead of reading a long list of employee names.
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { timeAgo } from "./attendanceGuide";

interface Job { key: string; label: string; lastRunAt: string | null; status: string | null; tone: "ok" | "warn" | "bad" | "unknown"; note: string | null }
interface Day { date: string; records: number; pct: number; low: boolean }
interface CoverageBranch { branchId: string; branchName: string; activeStaff: number; days: Day[] }
interface AprFeedDay { date: string; users: number; low: boolean }
export interface SyncHealthData {
  generatedAt: string; jobs: Job[]; days: string[]; coverage: CoverageBranch[]; lowDays: number;
  aprFeed?: AprFeedDay[]; aprLowDays?: number;
}

const DOT: Record<Job["tone"], string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", unknown: "bg-slate-300" };
const TONE_TEXT: Record<Job["tone"], string> = { ok: "Healthy", warn: "Running late", bad: "Needs attention", unknown: "No record yet" };
const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function OpsSyncHealthView({ data, nowMs = Date.now() }: { data: SyncHealthData; nowMs?: number }) {
  const worst = data.coverage.flatMap((b) => b.days.filter((d) => d.low).map((d) => ({ b: b.branchName, ...d }))).sort((a, c) => a.pct - c.pct)[0];
  return (
    <section aria-label="Attendance pipeline health" className="rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">Is the attendance pipeline healthy?</h2>
        <p className="text-xs text-slate-500">
          {data.lowDays === 0
            ? "Every branch had its staff recorded on each of the last 7 days."
            : `${data.lowDays} branch-day${data.lowDays === 1 ? "" : "s"} below 90% recorded — the system missed these; the repair job refills the last 7 days by itself.`}
        </p>
      </div>
      <ul className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.jobs.map((j) => (
          <li key={j.key} className="rounded-lg border p-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <span className={`h-2 w-2 rounded-full ${DOT[j.tone]}`} aria-hidden /> {j.label}
            </div>
            <div className="mt-0.5 text-slate-600">{TONE_TEXT[j.tone]} · last run {timeAgo(j.lastRunAt, nowMs)}</div>
            {j.note && <div className="text-slate-400">{j.note}</div>}
          </li>
        ))}
      </ul>
      {data.aprFeed && data.aprFeed.length > 0 && (
        <div className="border-t px-4 py-2 text-xs" aria-label="Dialler APR feed">
          <span className="font-semibold text-slate-700">Dialler APR agents per day: </span>
          {data.aprFeed.map((d) => (
            <span key={d.date} title={d.low ? "Feed missing or far below normal for this day" : undefined}
              className={`ml-2 font-mono ${d.low ? "rounded bg-red-50 px-1 font-semibold text-red-700" : "text-slate-500"}`}>
              {short(d.date)} {d.users}
            </span>
          ))}
          {(data.aprLowDays ?? 0) > 0 && (
            <span className="ml-2 text-red-700">
              — {data.aprLowDays} day{data.aprLowDays === 1 ? "" : "s"} with the dialler feed missing or far below normal. Attendance for dialler staff on these days is not reliable until the feed is re-pulled (the sync re-pulls the last 7 days every morning).
            </span>
          )}
        </div>
      )}
      <details className="border-t" open={data.lowDays > 0}>
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-700">
          Records created per branch, 7 days up to the day before yesterday (% of active staff; yesterday is filled overnight){worst ? ` — lowest: ${worst.b} ${short(worst.date)} at ${worst.pct}%` : ""}
        </summary>
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500">
                <th className="py-1 pr-3">Branch</th>
                {data.days.map((d) => <th key={d} className="px-2 py-1 text-right font-mono">{short(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.coverage.map((b) => (
                <tr key={b.branchId}>
                  <td className="whitespace-nowrap py-1 pr-3 font-medium text-slate-800">{b.branchName} <span className="font-normal text-slate-400">({b.activeStaff})</span></td>
                  {b.days.map((d) => (
                    <td key={d.date} title={`${d.records} of ${b.activeStaff}`}
                      className={`px-2 py-1 text-right font-mono ${d.low ? "bg-red-50 font-semibold text-red-700" : "text-slate-500"}`}>{Math.round(d.pct)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function OpsSyncHealth() {
  const q = useQuery({
    queryKey: ["ops-sync-health"],
    queryFn: () => hrmsApi.get<SyncHealthData>("/api/ops-control-tower/sync-health"),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  if (q.isLoading || q.isError || !q.data) return null; // a health strip must never get in the way of the page
  return <OpsSyncHealthView data={q.data} />;
}
