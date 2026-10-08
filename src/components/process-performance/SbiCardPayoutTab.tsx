import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarDays, Calculator, Lock, Target, TrendingUp } from "lucide-react";
import { getHrmsApiErrorStatus, hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { fmtDate } from "./lpCallShared";
import type { SbiPayoutData } from "./sbiCardTypes";
import { FOCUS, PAL, inrC } from "./sbiViz";
import { Empty, nz } from "./SbiCardShared";

/**
 * Payout (manager and above). The process is 100% variable: rate x amount collected. The rate is read off the client's slab from
 * Resolution / Normalisation / Rollback percentages, which are typed in here until the client's outcome figures are loaded, and default
 * to the client's own targets. Every assumption is listed on the page. The server decides who may see this; a 403 shows as restricted.
 */
const API = "/api/process-performance/sbi-card-payout";
const pctS = (n: number): string => `${n.toFixed(2).replace(/\.?0+$/, "")}%`;
/** A change in the rate is in percentage POINTS of collections, not a relative change. */
const ptsS = (n: number): string => (n === 0 ? "no change" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2).replace(/\.?0+$/, "")} pts`);

function Num({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint: string; placeholder: string }) {
  return (
    <label className="block text-xs">
      <span className="font-semibold text-slate-700">{label}</span>
      <input type="number" inputMode="decimal" min={0} max={100} step={0.1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={`mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums ${FOCUS}`} />
      <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
    </label>
  );
}

export function SbiCardPayoutTab({ from, to }: { from: string; to: string }) {
  const [res, setRes] = useState(""); const [nm, setNm] = useState(""); const [rb, setRb] = useState("");
  const [segment, setSegment] = useState(""); const [basis, setBasis] = useState("");
  const [applied, setApplied] = useState({ res: "", nm: "", rb: "" });
  useEffect(() => { const t = setTimeout(() => setApplied({ res, nm, rb }), 350); return () => clearTimeout(t); }, [res, nm, rb]);

  const q = useQuery({
    queryKey: ["sbi-card-payout", from, to, applied.res, applied.nm, applied.rb, segment, basis],
    queryFn: () => {
      const p = new URLSearchParams({ from, to });
      if (segment) p.set("segment", segment); if (basis) p.set("basis", basis);
      if (applied.res !== "") p.set("res", applied.res); if (applied.nm !== "") p.set("nm", applied.nm); if (applied.rb !== "") p.set("rb", applied.rb);
      return hrmsApi.get<HrmsEnvelope<SbiPayoutData>>(`${API}?${p.toString()}`);
    },
    retry: false,
  });

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading payout…</p>;
  if (q.isError) {
    const denied = getHrmsApiErrorStatus(q.error) === 403;
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{denied ? "Payout is restricted to manager level and above." : "Could not load the payout. Try again in a moment."}</p>
      </div>
    );
  }
  const d = q.data?.data;
  if (!d) return <Empty>No payout data.</Empty>;
  const s = d.scenario; const t = d.atTarget; const slab = d.slab;
  const inp = s.inputs;
  const gap = (a: number, b: number) => a - b;
  const oc = d.outcome;
  const BASIS: Record<string, string> = { stated: "percentages as SBI states them", accounts: "accounts (counts over the opening book)", amount: "amount (rupees over the opening book)" };
  const ph = (own: number | null | undefined, target: number) => String(own ?? target);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        <Lock className="h-3.5 w-3.5" aria-hidden /> <b>Manager and above.</b> {d.segment} · 100% variable: no fixed payout, revenue = rate × amount collected.
      </div>

      <section aria-label="Targets" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: "Resolution target", value: pctS(d.targets.resolutionPct), sub: "minimum for the payout slab" },
          { label: "NRB target", value: pctS(d.targets.nrbPct), sub: "Normalisation + Rollback (80% of Resolution)" },
          { label: "Total (Res + NM + RB)", value: pctS(d.targets.totalPct), sub: "matrix row at target" },
          { label: "PC target", value: inrC(d.targets.pcAmount), sub: d.collected.pcProgressPct === null ? "no collections loaded" : `${d.collected.pcProgressPct}% reached (MTD collected ${inrC(d.collected.mtd.amount)})` },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Target className="h-3 w-3" aria-hidden />{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{c.value}</p>
            <p className="text-[11px] text-slate-500">{c.sub}</p>
          </div>
        ))}
      </section>

      <section aria-label="Payout calculator" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Calculator className="h-4 w-4" aria-hidden />Enter the achieved percentages</h3>
          <button type="button" onClick={() => { setRes(""); setNm(""); setRb(""); setSegment(""); setBasis(""); }} className={`cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 ${FOCUS}`}>{oc ? "Reset to uploaded outcome" : "Reset to targets"}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Num label="Resolution %" value={res} onChange={setRes} placeholder={ph(oc?.resolutionPct, d.targets.resolutionPct)} hint={`Target ${d.targets.resolutionPct}. Kicker starts at 36.`} />
          <Num label="Normalisation %" value={nm} onChange={setNm} placeholder={ph(oc?.normalisationPct, d.targets.normKickerStartPct)} hint={oc?.normalisationPct != null ? "From the uploaded outcome. Kicker starts above 18." : `Assumed ${d.targets.normKickerStartPct} at target. Kicker starts above 18.`} />
          <Num label="Rollback %" value={rb} onChange={setRb} placeholder={ph(oc?.rollbackPct, d.targets.nrbPct - d.targets.normKickerStartPct)} hint={oc?.rollbackPct != null ? "From the uploaded outcome." : `Assumed ${d.targets.nrbPct - d.targets.normKickerStartPct} at target (NRB 28 − Normalisation 18).`} />
        </div>
        {oc ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <span><b>Outcome loaded</b> · {oc.segment} · as at {fmtDate(oc.asOf)} · {oc.basis ? BASIS[oc.basis] : "no usable figures"}</span>
            {!oc.complete && oc.basis && <span className="font-semibold text-amber-800">Some figures are missing in the file; the targets fill those fields.</span>}
            {oc.segments.length > 1 && (
              <label className="flex items-center gap-1.5">Segment
                <select value={segment || oc.segment} onChange={(e) => setSegment(e.target.value)} className={`rounded border border-emerald-300 bg-white px-1.5 py-1 ${FOCUS}`}>
                  {oc.segments.map((sg) => <option key={sg} value={sg}>{sg}</option>)}
                </select>
              </label>
            )}
            {oc.available.length > 1 && (
              <label className="flex items-center gap-1.5">Basis
                <select value={basis || oc.basis || ""} onChange={(e) => setBasis(e.target.value)} className={`rounded border border-emerald-300 bg-white px-1.5 py-1 ${FOCUS}`}>
                  {oc.available.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            )}
            {d.inputsSource === "entered" && <span>Typed figures override the file field by field.</span>}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">
            No outcome file for this range, so the client's targets are shown. Upload <b>Outcome (Res / NM / RB)</b> under SBI Card uploaders, or type the achieved figures.
          </p>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 p-5 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-200">Payout rate</p>
            <p className="mt-1 text-5xl font-bold tabular-nums">{pctS(s.ratePct)}</p>
            <p className="mt-1 text-xs text-blue-100">
              {pctS(s.matrixPct)} matrix + {pctS(s.normKickerPct)} Norm kicker + {pctS(s.resKickerPct)} Resolution kicker
              {" "}· total {pctS(s.totalPct)} · NRB {pctS(s.nrbPct)}
            </p>
            <p className="mt-2 text-xs text-blue-100">At the client's targets the rate is {pctS(t.ratePct)}; this scenario is {s.ratePct === t.ratePct ? "level with" : s.ratePct > t.ratePct ? "above" : "below"} it ({ptsS(gap(s.ratePct, t.ratePct))}).</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><CalendarDays className="h-3 w-3" aria-hidden />FTD revenue</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{inrC(s.revenue.ftd)}</p>
              <p className="text-[11px] text-slate-500">{d.collected.ftd.date ? `${fmtDate(d.collected.ftd.date)} · collected ${inrC(d.collected.ftd.amount)}` : "no collections loaded"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Banknote className="h-3 w-3" aria-hidden />MTD revenue</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{inrC(s.revenue.mtd)}</p>
              <p className="text-[11px] text-slate-500">collected {inrC(d.collected.mtd.amount)} over {d.collected.mtd.days} day(s)</p>
            </div>
          </div>
        </div>
        {d.collected.mtd.amount === 0 && <p className="mt-2 text-xs text-slate-500">No collections in this range yet: upload the Agent MIS (Amt collected) to see revenue in rupees.</p>}
      </section>

      {d.nextSteps.length > 0 && (
        <section aria-label="Fastest ways to a higher rate" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-900"><TrendingUp className="h-4 w-4" aria-hidden />Fastest ways to a higher rate</h3>
          <p className="mb-3 text-[11px] text-slate-500">The smallest extra points of each outcome that move the rate up a step, in accounts of the opening book{d.outcome?.openingAccounts ? ` (${nz(d.outcome.openingAccounts)})` : ""} and in rupees on what is collected so far.</p>
          <ol className="grid gap-2.5 sm:grid-cols-3">
            {d.nextSteps.map((n, i) => (
              <li key={n.lever} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">{i + 1}. {n.label}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{ptsS(n.deltaPct)} <span className="text-xs font-semibold text-slate-500">→ {pctS(n.newRatePct)}</span></p>
                <p className="text-[11px] text-slate-600">{n.accountsNeeded !== null ? `≈ ${nz(n.accountsNeeded)} more account(s) · ` : "needs an Outcome file for the account count · "}unlocks {n.unlocks}</p>
                <p className="text-[11px] text-slate-500">{d.collected.mtd.amount > 0 ? `≈ ${n.deltaAmount >= 0 ? "+" : ""}${inrC(n.deltaAmount)} on MTD collections` : "worth more once collections are loaded"}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="What the next point is worth" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><TrendingUp className="h-4 w-4" aria-hidden />What one more point is worth</h3>
        <ul className="grid gap-2.5 sm:grid-cols-3">
          {d.levers.map((l) => (
            <li key={l.lever} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{l.label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{ptsS(l.deltaPct)} <span className="text-xs font-semibold text-slate-500">→ {pctS(l.newRatePct)}</span></p>
              <p className="text-[11px] text-slate-500">{d.collected.mtd.amount > 0 ? `≈ ${l.deltaAmount >= 0 ? "+" : ""}${inrC(l.deltaAmount)} on MTD collections` : "worth more once collections are loaded"}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Payout slab" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-900">The slab, with your position</h3>
        <p className="mb-3 text-[11px] text-slate-500">Rows: Resolution + Normalisation + Rollback. Columns: Normalisation + Rollback. Dark cell = this scenario; outlined cell = the client's target.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Payout percentage by total and NRB band</caption>
            <thead><tr className="text-slate-600"><th scope="col" className="px-2 py-1.5 text-left font-semibold">Res + NM + RB ↓ / NRB →</th>{slab.cols.map((c) => <th key={c} scope="col" className="px-2 py-1.5 text-right font-semibold">{c}</th>)}</tr></thead>
            <tbody>
              {slab.matrix.map((row, i) => (
                <tr key={slab.rows[i]}>
                  <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-700">{slab.rows[i]}</th>
                  {row.map((v, j) => {
                    const active = s.cells.row === i && s.cells.col === j; const target = t.cells.row === i && t.cells.col === j;
                    return (
                      <td key={j} aria-current={active ? "true" : undefined}
                        className={`px-2 py-1 text-right tabular-nums ${active ? "rounded bg-blue-700 font-bold text-white" : "text-slate-800"} ${target ? "outline outline-2 outline-offset-[-2px] outline-amber-500" : ""}`}
                        style={active ? undefined : { background: `rgba(42,120,214,${(0.05 + ((v - 3.5) / 5.25) * 0.4).toFixed(3)})` }}>
                        {v.toFixed(2)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {([["Norm kicker (on Normalisation %)", slab.norm, s.cells.norm, t.cells.norm], ["Resolution kicker (on Resolution %)", slab.res, s.cells.res, t.cells.res]] as const).map(([title, tab, act, tg]) => (
            <div key={title}>
              <p className="mb-1 text-xs font-bold text-slate-700">{title}</p>
              <ul className="space-y-0.5 text-xs">
                {tab.labels.map((lab, i) => (
                  <li key={lab} className={`flex justify-between rounded px-2 py-1 tabular-nums ${i === act ? "bg-blue-700 font-bold text-white" : "text-slate-700"} ${i === tg ? "outline outline-2 outline-offset-[-2px] outline-amber-500" : ""}`}>
                    <span>{lab}</span><span>+{tab.pays[i]!.toFixed(2)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500" style={{ color: PAL.inkSoft }}>Note: the Norm kicker table pays +1.10% in both 21-22% and 22-23% bands, exactly as printed in the client's mail.</p>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>How this is read (assumptions)</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{d.reading.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-2">Inputs achieved: Resolution {pctS(inp.resolutionPct)}, Normalisation {pctS(inp.normalisationPct)}, Rollback {pctS(inp.rollbackPct)}. Range {fmtDate(d.range.from)} to {fmtDate(d.range.to)}; {nz(d.collected.daily.length)} day(s) with collections.</p>
      </details>
    </div>
  );
}
