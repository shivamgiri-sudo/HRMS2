import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, CheckCircle2, FileCheck2, Info, MinusCircle } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { fmtDate } from "./lpCallShared";
import type { SbiReadiness, SbiSourceKey } from "./sbiCardTypes";
import { Empty, nz } from "./SbiCardShared";

/**
 * Files: did each daily feed arrive, and were all nine fresh CD3 HB call tables in the NEW-flow export (client mail of 24-Sep-2026)?
 * Status is always shown as text and an icon, never colour alone.
 */
const API = "/api/process-performance/sbi-card-dashboard/readiness";
const LEVEL = {
  critical: { icon: AlertOctagon, cls: "border-red-200 bg-red-50 text-red-900", label: "Critical" },
  warning: { icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-900", label: "Warning" },
  info: { icon: Info, cls: "border-blue-200 bg-blue-50 text-blue-900", label: "Note" },
} as const;
const DAILY: SbiSourceKey[] = ["accountNew", "accountManual", "apr", "dialerMis", "agentMis"];
const OPTIONAL: SbiSourceKey[] = ["penEstimation", "outcome", "downtime"];
const SHORT: Record<SbiSourceKey, string> = { accountNew: "NEW flow", accountManual: "MANUAL flow", apr: "APR", dialerMis: "Dialer MIS", agentMis: "Agent MIS", penEstimation: "Pen est.", outcome: "Outcome", downtime: "Downtime" };

export function SbiCardReadinessTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ["sbi-card-readiness", from, to], queryFn: () => hrmsApi.get<HrmsEnvelope<SbiReadiness>>(`${API}?from=${from}&to=${to}`), retry: false });
  if (q.isLoading) return <p className="text-sm text-slate-500">Loading file status…</p>;
  if (q.isError || !q.data?.data) return <p role="alert" className="text-sm text-red-600">Could not load the file status.</p>;
  const d = q.data.data;
  if (d.days.length === 0 && d.alerts.every((a) => a.level === "info")) return <Empty>No files loaded between {fmtDate(from)} and {fmtDate(to)}. Upload the day-end export, APR, Dialer MIS and Agent MIS.</Empty>;
  const days = [...d.days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 31);
  const lt = d.tablesDay?.tables;

  return (
    <div className="space-y-4">
      {d.alerts.length > 0 && (
        <ul className="space-y-2" aria-label="File alerts">
          {d.alerts.map((a, i) => { const L = LEVEL[a.level]; const Icon = L.icon; return (
            <li key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${L.cls}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><b>{L.label}.</b> {a.text}</span></li>); })}
        </ul>
      )}

      <section aria-label="Source freshness" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {d.freshness.map((f) => (
          <div key={f.key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><FileCheck2 className="h-3 w-3" aria-hidden />{f.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{f.lastDate ? fmtDate(f.lastDate) : "never"}</p>
            <p className={`text-[11px] font-semibold ${f.status === "stale" ? "text-red-700" : f.status === "never" ? "text-slate-500" : "text-emerald-700"}`}>
              {f.status === "never" ? (f.daily ? "✕ not loaded" : "not loaded yet") : f.status === "stale" ? `▼ ${f.ageDays} days old` : f.ageDays === 0 ? "✓ up to date" : `✓ ${f.ageDays} day(s) old`}
              <span className="font-normal text-slate-500"> · {nz(f.rows)} rows</span>
            </p>
          </div>
        ))}
      </section>

      {lt && (
        <section aria-label="Fresh call tables" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-bold text-slate-900">Fresh CD3 HB call tables, {fmtDate(d.tablesDay!.date)}</h3>
          <p className="mb-2 text-[11px] text-slate-500">The nine tables the client listed; the NEW-flow day-end export should carry accounts from each.</p>
          <ul className="flex flex-wrap gap-2">
            {d.expectedTables.map((t) => { const ok = lt.found.includes(t.label); return (
              <li key={t.key} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertOctagon className="h-3 w-3" aria-hidden />}{t.label}<span className="font-normal">{ok ? " present" : " missing"}</span>
              </li>); })}
          </ul>
          {lt.other.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Also loaded, outside the client's list: {lt.other.join(", ")}.</p>}
        </section>
      )}

      <section aria-label="Day by day" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-bold text-slate-900">Day by day <span className="text-xs font-normal text-slate-500">(rows loaded; "—" = nothing for that day)</span></h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Rows loaded per source per day</caption>
            <thead><tr className="text-slate-600"><th scope="col" className="px-2 py-1.5 text-left font-semibold">Date</th>{[...DAILY, ...OPTIONAL].map((k) => <th key={k} scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{SHORT[k]}{DAILY.includes(k) ? "" : " ·"}</th>)}<th scope="col" className="px-2 py-1.5 text-left font-semibold">Daily feeds</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-800">{fmtDate(day.date)}</th>
                  {[...DAILY, ...OPTIONAL].map((k) => { const n = day.cells[k] ?? 0; const missing = day.dailyMissing.includes(k); return (
                    <td key={k} className={`px-2 py-1 text-right tabular-nums ${missing ? "bg-red-50 font-semibold text-red-700" : n > 0 ? "text-slate-800" : "text-slate-300"}`}>{n > 0 ? nz(n) : missing ? "missing" : "—"}</td>); })}
                  <td className="whitespace-nowrap px-2 py-1">{day.complete ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" aria-hidden />complete</span> : <span className="inline-flex items-center gap-1 font-semibold text-red-700"><MinusCircle className="h-3 w-3" aria-hidden />{day.dailyMissing.length} missing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">If the SFTP automation fails the client expects a manual upload by the IT team (their BCP). Pen estimation, outcome and downtime are optional and are not counted as missing.</p>
      </section>
    </div>
  );
}
