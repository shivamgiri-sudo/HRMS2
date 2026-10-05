/**
 * Hiring Engine - Planner: "to get N selected by a date, what has to happen each day, from which source, with how many
 * recruiters?" Reads GET /api/he/planner (rates from the recruiter attempt ledger, smoothed for small samples) and shows
 * the reverse funnel, the per-source daily plan, staffing, and how much of the existing pool already covers it.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Target, Users } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Req { id: string; requisition_code: string; designation_name: string; process_name: string | null; branch_name: string; open_positions: number; priority: string }
interface SourcePlan { source: string; expectedSelected: number; uniqueLeads: number; walkins: number; callAttempts: number; dailyCalls: number; dailyLeads: number; dailyWalkins: number; rates: { leadToWalkin: number; walkinToSelected: number; callToLead: number; selectedToJoined: number }; sample: string }
interface Plan {
  targetSelected: number; withBuffer: number; days: number; risk: "normal" | "medium" | "high"; scope: string; historyMonths: number;
  totals: { uniqueLeads: number; walkins: number; callAttempts: number; expectedJoined: number };
  daily: { calls: number; leads: number; walkins: number; selected: number };
  recruiters: { forCalling: number; forWalkins: number; forClosures: number; needed: number };
  pool: { reachableNow: number; suggested: number; invitedOrConfirmed: number };
  sources: SourcePlan[]; notes: string[];
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const RISK = { normal: "bg-emerald-50 text-emerald-700 ring-emerald-200", medium: "bg-amber-50 text-amber-700 ring-amber-200", high: "bg-rose-50 text-rose-700 ring-rose-200" };
const inDays = (d: number) => { const t = new Date(Date.now() + d * 86_400_000); return t.toISOString().slice(0, 10); };

export default function PlannerTab() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [reqId, setReqId] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState(inDays(10));
  const [months, setMonths] = useState("6");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { hrmsApi.get<{ data: Req[] }>("/api/he/requisitions/open").then((r) => setReqs(r.data ?? [])).catch(() => setReqs([])); }, []);
  const chosen = useMemo(() => reqs.find((r) => r.id === reqId) ?? null, [reqs, reqId]);
  useEffect(() => { if (chosen && !target) setTarget(String(chosen.open_positions)); }, [chosen, target]);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const p = new URLSearchParams({ deadline, months });
      if (reqId) p.set("requisitionId", reqId);
      if (target) p.set("target", target);
      const r = await hrmsApi.get<{ data: Plan }>(`/api/he/planner?${p.toString()}`);
      setPlan(r.data);
    } catch (e: unknown) { setErr((e as { message?: string })?.message || "Could not build the plan"); }
    finally { setBusy(false); }
  };

  const funnel = plan ? [
    { label: "Call attempts", value: plan.totals.callAttempts, daily: plan.daily.calls },
    { label: "Unique leads", value: plan.totals.uniqueLeads, daily: plan.daily.leads },
    { label: "Walk-ins", value: plan.totals.walkins, daily: plan.daily.walkins },
    { label: "Selected (with buffer)", value: plan.withBuffer, daily: plan.daily.selected },
    { label: "Expected to join", value: plan.totals.expectedJoined, daily: null as number | null },
  ] : [];
  const max = funnel.length ? Math.max(...funnel.map((f) => f.value), 1) : 1;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Plan inputs">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Requisition</span>
            <select value={reqId} onChange={(e) => { setReqId(e.target.value); setTarget(""); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <option value="">Choose an open requisition</option>
              {reqs.map((r) => <option key={r.id} value={r.id}>{r.requisition_code} · {r.designation_name} · {r.branch_name} ({r.open_positions} open)</option>)}
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Selections needed</span>
            <input type="number" min={1} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">By date</span>
            <input type="date" value={deadline} min={inDays(1)} onChange={(e) => setDeadline(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">History used</span>
            <select value={months} onChange={(e) => setMonths(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option>
            </select></label>
          <button type="button" onClick={() => void run()} disabled={busy || (!reqId && !target)} className="h-10 cursor-pointer rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy ? "Planning…" : "Build plan"}</button>
        </div>
      </section>
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}
      {busy && !plan && <div className="h-64 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden />}
      {plan && (
        <div className={`space-y-5 transition-opacity duration-200 ${busy ? "opacity-60" : "opacity-100"}`}>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Plan headline">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><Target className="h-3.5 w-3.5" aria-hidden /> Target</div><div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{num(plan.targetSelected)}</div><div className="text-xs text-slate-500">plan for {num(plan.withBuffer)} incl. buffer</div></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Days left</div><div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{num(plan.days)}</div><div className="text-xs text-slate-500">{num(plan.daily.calls)} calls · {num(plan.daily.walkins)} walk-ins a day</div></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><Users className="h-3.5 w-3.5" aria-hidden /> Recruiters</div><div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{num(plan.recruiters.needed)}</div><div className="text-xs text-slate-500">calling {plan.recruiters.forCalling} · walk-ins {plan.recruiters.forWalkins} · closures {plan.recruiters.forClosures}</div></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Risk</div><div className="mt-2"><span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ring-1 ring-inset ${RISK[plan.risk]}`}>{plan.risk}</span></div><div className="mt-2 text-xs text-slate-500">Pool: {num(plan.pool.reachableNow)} reachable · {num(plan.pool.invitedOrConfirmed)} booked</div></div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Reverse funnel">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">What it takes</h2>
            <ol className="space-y-2">
              {funnel.map((f) => (
                <li key={f.label} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 text-sm sm:grid-cols-[190px_1fr_130px]">
                  <span className="text-slate-700">{f.label}</span>
                  <div className="h-6 overflow-hidden rounded-md bg-slate-100"><div className="flex h-full items-center rounded-md bg-gradient-to-r from-blue-600 to-blue-400 px-2 text-xs font-semibold text-white transition-all duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(6, (f.value / max) * 100)}%` }}>{num(f.value)}</div></div>
                  <span className="text-right text-xs tabular-nums text-slate-500">{f.daily != null ? `${num(f.daily)} / day` : ""}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white" aria-label="Plan by source">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr>
                <th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Selections</th><th className="px-3 py-2 text-right">Calls / day</th><th className="px-3 py-2 text-right">Leads / day</th><th className="px-3 py-2 text-right">Walk-ins / day</th><th className="px-3 py-2 text-right">Lead → walk-in</th><th className="px-3 py-2 text-right">Walk-in → selected</th><th className="px-3 py-2">History</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {plan.sources.map((s) => (
                  <tr key={s.source} className="transition-colors duration-150 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{s.source}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(s.expectedSelected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.dailyCalls)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.dailyLeads)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.dailyWalkins)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(s.rates.leadToWalkin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(s.rates.walkinToSelected)}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.sample === "low" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>{s.sample} sample</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Rates from the last {plan.historyMonths} months of recruiter activity ({plan.scope === "branch+process" ? "this branch and process" : plan.scope === "process" ? "this process, all branches" : "all hiring"}). Small samples are pulled toward the average instead of taken at face value.</p>
          </section>

          {plan.notes.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4" aria-label="What to watch">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> What to watch</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
          )}
        </div>
      )}
      {!plan && !busy && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Pick a requisition (or type a target) and a date to see the daily plan.</p>}
    </div>
  );
}
