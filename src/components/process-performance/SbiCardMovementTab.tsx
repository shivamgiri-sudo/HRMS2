import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, LogOut, MinusCircle, TrendingDown } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { KpiCard } from "./DashboardKit";
import { fmtDate } from "./lpCallShared";
import type { SbiMoveKey, SbiMovement } from "./sbiCardTypes";
import { FOCUS, PAL, inrC } from "./sbiViz";
import { Empty, SortTable, nz, pctTxt, type Col } from "./SbiCardShared";

/**
 * Movement: how the book changed between two account snapshots. The movements are neutral on purpose; how they relate to SBI's Resolution /
 * Normalisation / Rollback depends on SBI's definitions, so compare with the Outcome figures once those are loaded.
 */
const API = "/api/process-performance/sbi-card-dashboard/movement";
type StageRow = NonNullable<SbiMovement["movement"]>["byStage"][number];
const COLOR: Record<SbiMoveKey, string> = { left: PAL.aqua, rolledBack: PAL.blue, stayedPaidDown: PAL.yellow, stayed: PAL.gray, rolledForward: PAL.red };
const ICON: Record<SbiMoveKey, typeof LogOut> = { left: LogOut, rolledBack: ArrowDownRight, stayedPaidDown: TrendingDown, stayed: MinusCircle, rolledForward: ArrowUpRight };
const TONE: Record<SbiMoveKey, "emerald" | "sky" | "amber" | "violet" | "rose"> = { left: "emerald", rolledBack: "sky", stayedPaidDown: "amber", stayed: "violet", rolledForward: "rose" };

export function SbiCardMovementTab({ from, to }: { from: string; to: string }) {
  const [a, setA] = useState(""); const [b, setB] = useState("");
  const q = useQuery({
    queryKey: ["sbi-card-movement", from, to, a, b],
    queryFn: () => hrmsApi.get<HrmsEnvelope<SbiMovement>>(`${API}?from=${from}&to=${to}${a ? `&a=${a}` : ""}${b ? `&b=${b}` : ""}`),
    retry: false,
  });
  if (q.isLoading) return <p className="text-sm text-slate-500">Loading movement…</p>;
  if (q.isError || !q.data?.data) return <p role="alert" className="text-sm text-red-600">Could not load the movement.</p>;
  const d = q.data.data; const m = d.movement;
  if (!m) {
    return (
      <Empty>
        {d.dates.length === 0 ? "No account file in this range."
          : d.dates.length === 1 ? `Only one account snapshot (${fmtDate(d.dates[0]!)}) is loaded in this range. Movement compares two: load another day-end export from later in the cycle.`
          : "Pick two different snapshot dates."}
      </Empty>
    );
  }
  const stageCols: Array<Col<StageRow>> = [
    { key: "f", label: "Stage at start", align: "left", value: (r) => r.from },
    { key: "n", label: "Accounts", value: (r) => r.accounts },
    { key: "e", label: "Amount due", value: (r) => r.exposure, render: (r) => inrC(r.exposure) },
    ...(["left", "rolledBack", "stayedPaidDown", "stayed", "rolledForward"] as SbiMoveKey[]).map((k) => ({
      key: k, label: m.outcomes.find((o) => o.key === k)!.label, value: (r: StageRow) => r.pct[k], render: (r: StageRow) => pctTxt(r.pct[k]),
    })),
  ];
  const targets = [...new Set(m.matrix.flatMap((r) => Object.keys(r.to)))].sort((x, y) => (x === "Left" ? 1 : y === "Left" ? -1 : x.localeCompare(y)));
  const sel = `rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs ${FOCUS}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-1.5">From snapshot<select value={a || m.dateA} onChange={(e) => setA(e.target.value)} className={sel}>{d.dates.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}</select></label>
        <label className="flex items-center gap-1.5">to<select value={b || m.dateB} onChange={(e) => setB(e.target.value)} className={sel}>{d.dates.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}</select></label>
        <span>Opening <b className="tabular-nums text-slate-900">{nz(m.opening.accounts)}</b> accounts · <b className="tabular-nums text-slate-900">{inrC(m.opening.exposure)}</b> due → closing <b className="tabular-nums text-slate-900">{nz(m.closing.accounts)}</b> · <b className="tabular-nums text-slate-900">{inrC(m.closing.exposure)}</b></span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        {m.outcomes.map((o) => <KpiCard key={o.key} icon={ICON[o.key]} tone={TONE[o.key]} label={o.label} value={pctTxt(o.pct)} sub={`${nz(o.accounts)} accounts · ${inrC(o.exposure)}`} />)}
      </div>

      <section aria-label="Where the opening book went" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-bold text-slate-700">Where the opening book went (share of opening accounts)</p>
        <div role="img" aria-label={m.outcomes.map((o) => `${o.label} ${o.pct} percent`).join(", ")} className="flex h-8 overflow-hidden rounded-lg bg-slate-100">
          {m.outcomes.filter((o) => o.accounts > 0).map((o) => <div key={o.key} title={`${o.label}: ${nz(o.accounts)} (${o.pct}%)`} style={{ width: `${o.pct}%`, background: COLOR[o.key], borderRight: "2px solid #fff" }} />)}
        </div>
        <ul className="mt-2 grid gap-x-4 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-2 lg:grid-cols-5">
          {m.outcomes.map((o) => <li key={o.key} className="flex items-start gap-1.5"><span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: COLOR[o.key] }} aria-hidden /><span><b className="text-slate-800">{o.label}</b>: {o.hint}</span></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-700">Amount due fell by <b>{inrC(m.paidDownAmount)}</b> on accounts still on the file; {nz(m.newInB.accounts)} new account(s) ({inrC(m.newInB.exposure)}) arrived after the opening snapshot.</p>
      </section>

      <SortTable rows={m.byStage} cols={stageCols} caption="Movement by stage at the start" rowKey={(r) => r.from} />

      <section aria-label="Stage to stage" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-bold text-slate-700">Stage to stage (accounts)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Accounts by stage at the start and stage at the end</caption>
            <thead><tr className="text-slate-600"><th scope="col" className="px-2 py-1.5 text-left font-semibold">Start ↓ / End →</th>{targets.map((t) => <th key={t} scope="col" className="px-2 py-1.5 text-right font-semibold">{t}</th>)}<th scope="col" className="px-2 py-1.5 text-right font-semibold">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {m.matrix.map((r) => (
                <tr key={r.from}>
                  <th scope="row" className="px-2 py-1 text-left font-semibold text-slate-800">{r.from}</th>
                  {targets.map((t) => { const n = r.to[t] ?? 0; const diag = t === r.from; return <td key={t} className={`px-2 py-1 text-right tabular-nums ${diag ? "bg-slate-50 font-semibold text-slate-900" : n > 0 ? "text-slate-800" : "text-slate-300"}`}>{n > 0 ? nz(n) : "—"}</td>; })}
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">{nz(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-[11px] text-slate-500">These are neutral movements between two day-end snapshots. How they line up with SBI Card's Resolution, Normalisation and Rollback depends on SBI's definitions: upload SBI's own figures (Outcome) and compare before using this for the payout.</p>
    </div>
  );
}
