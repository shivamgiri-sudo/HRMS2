import { useEffect, useMemo, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { SectionCard, TableExcelIconButton, formatINR, localDateStr } from "./DashboardKit";

/**
 * Abandon Cart "Date-wise Target" table -- fully automatic (backend: bellavita-auto-targets.shared.ts):
 *   Conv Tgt %      fixed per-date default
 *   Allocation      distinct carts allocated that date (db_masmis.bb_cart)
 *   Sale Target     = Allocation x Conv Tgt %
 *   Revenue Target  = Sale Target x 500
 * shown beside that day's real Abandon Cart revenue so it reads as Target vs Achievement. The
 * Overall Bellavita dashboard's Abandon Cart target/Achi% is the sum of these rows up to today.
 */

interface TargetRow {
  date: string; convTgtPct: number | null; allocation: number; saleTarget: number; revenueTarget: number;
  actualRevenue: number; achievementPct: number | null; source: "auto" | "none";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-09-01 -> "1-Sep" (the target sheet's own date style). */
const dayLabel = (iso: string): string => `${Number(iso.slice(8, 10))}-${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const ddmmyyyy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtN = (n: number): string => n.toLocaleString("en-IN");
const fmtDec = (n: number, d = 3): string => (Number.isInteger(n) ? fmtN(n) : n.toLocaleString("en-IN", { maximumFractionDigits: d }));

export function BellavitaCartTargetTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<TargetRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    hrmsApi.get<{ success: boolean; data: { rows: TargetRow[] } }>(`/api/process-performance/bellavita-cart-dashboard/daily-targets?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setRows(res.data.rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the date-wise target."); });
    return () => { cancelled = true; };
  }, [from, to]);

  const today = localDateStr(new Date());
  const totals = useMemo(() => {
    // "Till today": days after today have no achievement yet, so they don't count towards the running total.
    const upTo = (rows ?? []).filter((r) => r.date <= today);
    const revenueTarget = upTo.reduce((n, r) => n + r.revenueTarget, 0);
    const actual = upTo.reduce((n, r) => n + r.actualRevenue, 0);
    return {
      allocation: upTo.reduce((n, r) => n + r.allocation, 0),
      saleTarget: upTo.reduce((n, r) => n + r.saleTarget, 0),
      revenueTarget, actual,
      achi: revenueTarget > 0 ? Math.round((actual / revenueTarget) * 1000) / 10 : null,
    };
  }, [rows, today]);

  const sheets = () => [{
    name: "Date-wise Target",
    columns: ["Date", "Conv Tgt %", "Allocation", "Sale Target", "Revenue Target", "Actual Revenue", "Achi %"],
    rows: (rows ?? []).map((r) => [r.date, r.convTgtPct ?? "—", r.allocation, r.saleTarget, r.revenueTarget, r.actualRevenue, r.achievementPct ?? "—"]),
  }];

  return (
    <>
      <SectionCard
        icon={Target} title="Date-wise Target" tone="amber"
        action={<TableExcelIconButton fileBase="Bellavita_Abandon_Cart_Date_wise_Target" getSheets={sheets} disabled={!rows || rows.length === 0} />}
        footnote="Automatic. Sale Target = Allocation × Conv Tgt %; Revenue Target = Sale Target × 500. Allocation is the distinct carts allocated that date (bb_cart); a date with no allocation yet shows 0. The Overall dashboard's Abandon Cart target is the sum of these rows up to today."
      >
        {error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        {!rows && !error && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {rows && (
          <div className="max-h-[30rem] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] border-collapse text-center text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-800 text-[10px] font-bold uppercase tracking-wide text-white">
                  {["Date", "Conv Tgt", "Allocation", "Sale Target", "Revenue Target", "Actual Revenue", "Achi %"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr>
                <tr className="bg-slate-100 text-[11px] font-bold text-slate-800">
                  <th className="px-3 py-1.5 text-left">Total (to today)</th>
                  <th className="px-3 py-1.5">—</th>
                  <th className="px-3 py-1.5">{fmtN(totals.allocation)}</th>
                  <th className="px-3 py-1.5">{fmtDec(totals.saleTarget)}</th>
                  <th className="px-3 py-1.5">{formatINR(totals.revenueTarget)}</th>
                  <th className="px-3 py-1.5">{formatINR(totals.actual)}</th>
                  <th className="px-3 py-1.5 text-emerald-700">{totals.achi !== null ? `${totals.achi}%` : "—"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const future = r.date > today;
                  return (
                    <tr
                      key={r.date} onClick={() => setOpen(r)} role="button" tabIndex={0}
                      className={`cursor-pointer transition-colors hover:bg-amber-50/60 ${future ? "text-slate-400" : ""} ${i % 2 ? "bg-slate-50/70" : "bg-white"}`}
                    >
                      <td className="border-b border-slate-100 px-3 py-1.5 text-left font-semibold">{dayLabel(r.date)}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5">{r.convTgtPct !== null ? `${r.convTgtPct}%` : "—"}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5">{fmtN(r.allocation)}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5">{fmtDec(r.saleTarget)}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5 font-semibold">{formatINR(r.revenueTarget)}</td>
                      <td className="border-b border-slate-100 px-3 py-1.5">{future ? "—" : formatINR(r.actualRevenue)}</td>
                      <td className={`border-b border-slate-100 px-3 py-1.5 font-bold ${r.achievementPct === null || future ? "" : r.achievementPct >= 100 ? "text-emerald-600" : r.achievementPct >= 60 ? "text-amber-600" : "text-rose-600"}`}>
                        {r.achievementPct !== null && !future ? `${r.achievementPct}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">None</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
            <div className="flex flex-wrap items-center gap-2 pr-10">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Target</span>
              <SheetTitle className="text-base font-bold text-slate-800">{open ? ddmmyyyy(open.date) : ""}</SheetTitle>
            </div>
            <SheetDescription className="text-[11px] text-slate-400">How this day's Abandon Cart target is worked out.</SheetDescription>
          </SheetHeader>
          {open && (
            <div className="space-y-5 px-5 py-4">
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Calculation</p>
                <ol className="space-y-2 text-sm text-slate-700">
                  <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">Allocation <b>{fmtN(open.allocation)}</b> carts (distinct cart ids allocated on this date)</li>
                  <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">× Conv Tgt <b>{open.convTgtPct !== null ? `${open.convTgtPct}%` : "not set"}</b> = Sale Target <b>{fmtDec(open.saleTarget)}</b></li>
                  <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">× ₹500 per sale = Revenue Target <b>{formatINR(open.revenueTarget)}</b></li>
                </ol>
              </section>
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Achievement</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { l: "Revenue Target", v: formatINR(open.revenueTarget) },
                    { l: "Actual Revenue", v: open.date > today ? "—" : formatINR(open.actualRevenue) },
                    { l: "Achi %", v: open.achievementPct !== null && open.date <= today ? `${open.achievementPct}%` : "—" },
                  ].map((x) => (
                    <div key={x.l} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-center">
                      <p className="text-sm font-bold text-slate-800">{x.v}</p>
                      <p className="text-[10px] text-slate-500">{x.l}</p>
                    </div>
                  ))}
                </div>
                {open.allocation === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">No carts are allocated for this date yet, so its target is 0.</p>}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
