import { useMemo, useState } from "react";
import { Building2, Layers3, Loader2, Pin, PinOff, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudgetConsolidation } from "@/hooks/useBudgetConsolidation";
import { usePinnedOffsets, useColumnPinning } from "@/hooks/useColumnPinning";

const ROW_LABEL_WIDTH = 280;
const COLUMN_WIDTH = 150;

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function statusTone(status: string) {
  if (["active", "accounts_head_approved"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["draft", "revision_required"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function BudgetConsolidationPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const { data, isLoading, isError, error } = useBudgetConsolidation(period);
  const branchSummaries = data?.branchSummaries ?? [];
  const headBreakdown = data?.headBreakdown ?? [];

  const { pinnedIds, togglePin } = useColumnPinning();

  const branchColumns = useMemo(
    () =>
      branchSummaries
        .map((b) => ({ id: b.branch_id, name: b.branch_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branchSummaries]
  );
  const orderedBranchColumns = useMemo(
    () => [
      ...branchColumns.filter((c) => pinnedIds.has(c.id)),
      ...branchColumns.filter((c) => !pinnedIds.has(c.id)),
    ],
    [branchColumns, pinnedIds]
  );
  const widthByColumnId = useMemo(
    () => Object.fromEntries(orderedBranchColumns.map((c) => [c.id, COLUMN_WIDTH])),
    [orderedBranchColumns]
  );
  const pinnedOffsets = usePinnedOffsets(
    orderedBranchColumns.filter((c) => pinnedIds.has(c.id)).map((c) => c.id),
    widthByColumnId
  );

  const grandTotals = branchSummaries.reduce(
    (sum, b) => {
      sum.gross += Number(b.gross_budget_amount);
      sum.reserved += Number(b.reserved_amount);
      sum.consumed += Number(b.consumed_amount);
      return sum;
    },
    { gross: 0, reserved: 0, consumed: 0 }
  );

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_44%,_#f5f7fb_100%)]">
        <div className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="relative overflow-hidden rounded-[32px] border border-slate-800 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.25)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.28),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.20),_transparent_30%)]" />
            <div className="relative grid gap-8 p-6 lg:grid-cols-[1.35fr_0.9fr] lg:p-8">
              <div>
                <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />Company-wide, all branches
                </Badge>
                <h1 className="mt-5 max-w-4xl text-3xl font-black tracking-tight sm:text-4xl">Budget Consolidation</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Every branch's budget rolled up into one company-wide view — branch summaries and a head/sub-head breakdown across every branch.
                </p>
                <div className="mt-6 max-w-xs space-y-2">
                  <Label className="text-slate-200">Period</Label>
                  <Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="bg-white text-slate-900" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-300">Branches</p>
                  <p className="mt-2 text-lg font-black">{branchSummaries.length}</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-300">Company gross</p>
                  <p className="mt-2 text-lg font-black">{money(grandTotals.gross)}</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-300">Consumed</p>
                  <p className="mt-2 text-lg font-black">{money(grandTotals.consumed)}</p>
                </div>
              </div>
            </div>
          </section>

          {isError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {error instanceof Error ? error.message : "Consolidation data could not be loaded"}
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>
          ) : (
            <>
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                  <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-5 w-5 text-emerald-600" />Branch summaries — {period}</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">One row per branch. Branches without a budget for this period are not listed.</p>
                </CardHeader>
                <CardContent className="p-0">
                  {branchSummaries.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">No branch has a budget for this period yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2">Branch</th>
                            <th className="px-4 py-2">Budget #</th>
                            <th className="px-4 py-2">Status</th>
                            <th className="px-4 py-2 text-right">Gross</th>
                            <th className="px-4 py-2 text-right">Reserved</th>
                            <th className="px-4 py-2 text-right">Consumed</th>
                            <th className="px-4 py-2 text-right">Available</th>
                            <th className="px-4 py-2 text-right">Lines</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchSummaries.map((b) => {
                            const available = Number(b.gross_budget_amount) - Number(b.reserved_amount) - Number(b.consumed_amount);
                            return (
                              <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                                <td className="px-4 py-2 font-semibold text-slate-900">{b.branch_name}</td>
                                <td className="px-4 py-2 text-slate-600">{b.budget_number}</td>
                                <td className="px-4 py-2"><Badge variant="outline" className={statusTone(b.status)}>{b.status.replaceAll("_", " ")}</Badge></td>
                                <td className="px-4 py-2 text-right">{money(Number(b.gross_budget_amount))}</td>
                                <td className="px-4 py-2 text-right">{money(Number(b.reserved_amount))}</td>
                                <td className="px-4 py-2 text-right">{money(Number(b.consumed_amount))}</td>
                                <td className="px-4 py-2 text-right">{money(available)}</td>
                                <td className="px-4 py-2 text-right">{b.line_count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-100 text-sm font-bold text-slate-900">
                            <td className="px-4 py-2" colSpan={3}>Company total</td>
                            <td className="px-4 py-2 text-right">{money(grandTotals.gross)}</td>
                            <td className="px-4 py-2 text-right">{money(grandTotals.reserved)}</td>
                            <td className="px-4 py-2 text-right">{money(grandTotals.consumed)}</td>
                            <td className="px-4 py-2 text-right">{money(grandTotals.gross - grandTotals.reserved - grandTotals.consumed)}</td>
                            <td className="px-4 py-2" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                  <CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-5 w-5 text-emerald-600" />Head / Sub-head breakdown — every branch</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">Same item planned across branches is grouped into one row. Pin a branch column to keep it visible while scrolling.</p>
                </CardHeader>
                <CardContent className="p-0">
                  {headBreakdown.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">No budget lines exist for this period yet.</p>
                  ) : (
                    <div className="overflow-auto">
                      <table
                        className="w-full border-separate border-spacing-0 text-xs"
                        style={{ minWidth: `${ROW_LABEL_WIDTH + orderedBranchColumns.length * COLUMN_WIDTH + COLUMN_WIDTH}px` }}
                      >
                        <thead className="text-slate-600">
                          <tr className="sticky top-0 z-30 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em]">
                            <th className="sticky z-40 min-w-[280px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left" style={{ left: 0, width: ROW_LABEL_WIDTH }}>
                              Head / Sub-head / Item
                            </th>
                            {orderedBranchColumns.map((col) => {
                              const pinned = pinnedIds.has(col.id);
                              return (
                                <th
                                  key={col.id}
                                  className={`min-w-[150px] border-b border-r border-slate-200 px-3 py-3 text-right ${pinned ? "sticky z-40 bg-slate-50" : ""}`}
                                  style={pinned ? { left: ROW_LABEL_WIDTH + pinnedOffsets[col.id] } : undefined}
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    <button type="button" title={pinned ? "Unpin" : "Pin"} onClick={() => togglePin(col.id)} className="text-slate-400 hover:text-emerald-700">
                                      {pinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
                                    </button>
                                    <span className="truncate">{col.name}</span>
                                  </div>
                                </th>
                              );
                            })}
                            <th className="sticky right-0 z-40 min-w-[150px] border-b border-l-2 border-slate-300 bg-slate-100 px-3 py-3 text-right">Company Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {headBreakdown.map((group, index) => (
                            <tr key={`${group.head}-${group.subHead}-${group.itemName}-${index}`} className="group hover:bg-slate-50/70">
                              <td className="sticky z-10 min-w-[280px] border-r border-slate-100 bg-white px-3 py-2 text-left group-hover:bg-slate-50" style={{ left: 0, width: ROW_LABEL_WIDTH }}>
                                <p className="font-semibold text-slate-900">{group.itemName}</p>
                                <p className="text-[10px] text-slate-500">
                                  {group.head}{group.subHead ? ` / ${group.subHead}` : ""} · {group.branchCount} branch(es)
                                </p>
                                {!group.unitConsistent && <Badge variant="destructive" className="mt-1 text-[9px]">Mixed units</Badge>}
                              </td>
                              {orderedBranchColumns.map((col) => {
                                const pinned = pinnedIds.has(col.id);
                                const amount = group.branches.find((b) => b.branchId === col.id)?.grossAmount ?? 0;
                                return (
                                  <td
                                    key={col.id}
                                    className={`min-w-[150px] border-r border-slate-100 px-3 py-2 text-right ${amount === 0 ? "text-slate-300" : "text-slate-800"} ${pinned ? "sticky z-10 bg-white group-hover:bg-slate-50" : ""}`}
                                    style={pinned ? { left: ROW_LABEL_WIDTH + pinnedOffsets[col.id] } : undefined}
                                  >
                                    {amount === 0 ? "-" : money(amount)}
                                  </td>
                                );
                              })}
                              <td className="sticky right-0 z-10 min-w-[150px] border-l-2 border-slate-200 bg-slate-50/80 px-3 py-2 text-right font-semibold text-slate-900 group-hover:bg-slate-100">
                                {money(group.companyGrossAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
