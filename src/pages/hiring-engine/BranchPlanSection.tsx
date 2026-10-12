/**
 * Hiring Engine - Planner: every branch at once. For each branch with open seats: joins still needed, walk-ins needed at the
 * branch's own conversion rates, how many are already booked, days to target at its observed walk-in pace, and cost to target.
 * Reads GET /api/he/branch-plan. Optional what-if inputs override the conversion rates and daily pace for all branches.
 */
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Row {
  branch: string; requisitions: number; requested: number; joinTarget: number; joined: number; joinsLeft: number;
  pendingSelected: number; expectedFromPending: number;
  rates: { walkinToSelected: number; selectedToJoined: number; source: string };
  selectionsNeeded: number; walkinsNeeded: number; bookedShows: number; walkinsToBring: number;
  walkinsPerDay: number | null; paceSource: string; daysToTarget: number | null; targetDate: string | null;
  cost: { perWalkin: number | null; perJoin: number | null; toTarget: number | null; spend: number };
  status: "covered" | "on_track" | "at_risk" | "no_history" | "no_pace"; note: string | null;
}
interface Resp {
  rows: Row[]; asOf: string; historyMonths: number; paceDays: number; joinBufferPct: number; costNote: string;
  totals: { joinsLeft: number; walkinsNeeded: number; walkinsToBring: number; costToTarget: number | null; branchesAtRisk: number };
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const inr = (n: number | null) => (n == null ? "n/a" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n));
const STATUS = {
  covered: ["Covered", "bg-emerald-50 text-emerald-700 ring-emerald-200"], on_track: ["On track", "bg-blue-50 text-blue-700 ring-blue-200"],
  at_risk: ["At risk", "bg-rose-50 text-rose-700 ring-rose-200"], no_pace: ["No pace data", "bg-amber-50 text-amber-700 ring-amber-200"],
  no_history: ["No history", "bg-amber-50 text-amber-700 ring-amber-200"],
} as const;

function toCsv(rows: Row[]): string {
  const head = ["Branch", "Open requisitions", "Seats requested", "Join target (130%)", "Joined", "Joins still needed", "Selected, not joined", "Walk-in to selected", "Selected to joined",
    "Selections needed", "Walk-ins needed", "Already booked (expected shows)", "Walk-ins to bring", "Walk-ins per day", "Days to target", "Target date", "Cost per walk-in", "Cost to target", "Status", "Note"];
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => [r.branch, r.requisitions, r.requested, r.joinTarget, r.joined, r.joinsLeft, r.pendingSelected, pct(r.rates.walkinToSelected), pct(r.rates.selectedToJoined),
    r.selectionsNeeded, r.walkinsNeeded, r.bookedShows, r.walkinsToBring, r.walkinsPerDay ?? "", r.daysToTarget ?? "", r.targetDate ?? "", r.cost.perWalkin ?? "", r.cost.toTarget ?? "", STATUS[r.status][0], r.note ?? ""].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export default function BranchPlanSection() {
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [months, setMonths] = useState("6");
  const [deadline, setDeadline] = useState("");
  const [w2s, setW2s] = useState("");
  const [s2j, setS2j] = useState("");
  const [pace, setPace] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const p = new URLSearchParams({ months });
      if (deadline) p.set("deadline", deadline);
      if (w2s) p.set("walkinToSelected", w2s);
      if (s2j) p.set("selectedToJoined", s2j);
      if (pace) p.set("walkinsPerDay", pace);
      setData((await hrmsApi.get<{ data: Resp }>(`/api/he/branch-plan?${p.toString()}`)).data);
    } catch (e: unknown) { setErr((e as { message?: string })?.message || "Could not build the branch plan"); }
    finally { setBusy(false); }
  }, [months, deadline, w2s, s2j, pace]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    if (!data) return;
    const blob = new Blob(["﻿" + toCsv(data.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `branch-hiring-plan-${data.asOf}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };
  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Branch hiring plan">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">All branches: walk-ins, days and cost to target</h2>
          <p className="text-xs text-slate-500">Target = joined employees at {100 + (data?.joinBufferPct ?? 30)}% of seats. Rates and pace are each branch's own; leave what-if boxes empty to use them.</p>
        </div>
        <button type="button" onClick={download} disabled={!data?.rows.length}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <Download className="h-4 w-4" aria-hidden /> Download CSV</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(5,1fr)_auto] lg:items-end">
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">History used</span>
          <select value={months} onChange={(e) => setMonths(e.target.value)} className={`${input} bg-white`}>
            <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option></select></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Deadline (optional)</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">What-if walk-in → selected %</span>
          <input type="number" min={1} max={100} inputMode="numeric" value={w2s} placeholder="actual" onChange={(e) => setW2s(e.target.value)} className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">What-if selected → joined %</span>
          <input type="number" min={1} max={100} inputMode="numeric" value={s2j} placeholder="actual" onChange={(e) => setS2j(e.target.value)} className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">What-if walk-ins / day / branch</span>
          <input type="number" min={1} inputMode="numeric" value={pace} placeholder="observed" onChange={(e) => setPace(e.target.value)} className={input} /></label>
        <button type="button" onClick={() => void load()} disabled={busy} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy ? "Working…" : "Update"}</button>
      </div>

      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}
      {busy && !data && <div className="h-40 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden />}
      {data && (
        <div className={`space-y-3 transition-opacity ${busy ? "opacity-60" : ""}`}>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Joins still needed</dt><dd className="text-2xl font-bold tabular-nums">{num(data.totals.joinsLeft)}</dd></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Walk-ins needed</dt><dd className="text-2xl font-bold tabular-nums">{num(data.totals.walkinsNeeded)}</dd><div className="text-xs text-slate-500">{num(data.totals.walkinsToBring)} still to bring</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cost to target</dt><dd className="text-2xl font-bold tabular-nums">{inr(data.totals.costToTarget)}</dd></div>
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Branches at risk</dt><dd className="text-2xl font-bold tabular-nums">{data.totals.branchesAtRisk}</dd></div>
          </dl>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr>
                <th className="px-3 py-2">Branch</th><th className="px-3 py-2 text-right">Joins left</th><th className="px-3 py-2 text-right">Walk-in → sel.</th><th className="px-3 py-2 text-right">Sel. → join</th>
                <th className="px-3 py-2 text-right">Walk-ins needed</th><th className="px-3 py-2 text-right">Booked</th><th className="px-3 py-2 text-right">To bring</th>
                <th className="px-3 py-2 text-right">Per day</th><th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Cost to target</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.branch} className="hover:bg-slate-50" title={r.note ?? undefined}>
                    <td className="px-3 py-2 font-medium text-slate-900">{r.branch}<div className="text-[11px] font-normal text-slate-500">{r.joined} joined of {r.joinTarget} target · {r.requisitions} req.</div></td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(r.joinsLeft)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.rates.walkinToSelected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.rates.selectedToJoined)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.walkinsNeeded)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.bookedShows)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(r.walkinsToBring)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.walkinsPerDay ?? "n/a"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.daysToTarget ?? "n/a"}{r.targetDate ? <div className="text-[11px] text-slate-500">{r.targetDate}</div> : null}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(r.cost.toTarget)}{r.cost.perWalkin != null ? <div className="text-[11px] text-slate-500">{inr(r.cost.perWalkin)} / walk-in</div> : null}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">No branch has open seats.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">{data.costNote} Rates from the last {data.historyMonths} months; pace from the last {data.paceDays} days. Booked = future-slot invited/confirmed candidates at the engine's base show-up rates.</p>
        </div>
      )}
    </section>
  );
}
