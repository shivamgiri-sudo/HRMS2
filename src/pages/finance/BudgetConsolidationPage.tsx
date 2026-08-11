import { useMemo, useState } from "react";
import { Building2, CheckCircle2, Layers3, Loader2, Pin, PinOff } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudgetConsolidation, type CompanyConsolidationGroup } from "@/hooks/useBudgetConsolidation";
import { usePinnedOffsets, useColumnPinning } from "@/hooks/useColumnPinning";

const ROW_LABEL_WIDTH = 280;
const COLUMN_WIDTH = 150;
const COMPANY_COLUMN_WIDTH = 130;
/** Planned/Reserved/Consumed are the budget's own figures; Paid/Booked are actuals sourced from
 *  GRN (see getCompanyBudgetConsolidation's grn_cost_allocation join) — same rupee, four states,
 *  finally in one row instead of split across the Budget, GRN and P&L screens. */
const COMPANY_TOTAL_COLUMNS: Array<{ key: string; label: string; hint: string; value: (group: CompanyConsolidationGroup) => number }> = [
  { key: "planned", label: "Planned", hint: "Company-wide budgeted amount", value: (g) => g.companyGrossAmount },
  { key: "reserved", label: "Reserved", hint: "Held against Branch Head-approved GRNs, not yet consumed", value: (g) => g.companyReservedAmount },
  { key: "consumed", label: "Consumed", hint: "Finance Head-approved GRN spend against this budget", value: (g) => g.companyConsumedAmount },
  { key: "paid", label: "Paid", hint: "GRNs whose payment has actually gone out", value: (g) => g.companyPaidAmount },
  { key: "booked", label: "Booked to P&L", hint: "GRN cost actually recognised in Process P&L (lifecycle_status = consumed)", value: (g) => g.companyBookedToPnlAmount },
];

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
  const readiness = data?.readiness ?? [];
  const isPeriodLocked = data?.isPeriodLocked ?? false;

  const { pinnedIds, togglePin } = useColumnPinning();

  const branchColumns = useMemo(
    () =>
      branchSummaries
        // branch_name comes from a LEFT JOIN on branch_master, so it is null for a budget whose
        // branch row has been removed or renamed away. This route has no error boundary, so one
        // such header threw "Cannot read properties of null (reading 'localeCompare')" during
        // render and white-screened the whole consolidation page. The same hook already types
        // the field nullable elsewhere and the readiness table already renders `?? "-"`.
        .map((b) => ({ id: b.branch_id, name: b.branch_name ?? "Unmapped branch" }))
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
      <div className="min-h-screen bg-slate-50">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1680px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-950">Budget Consolidation</h1>
                  {!isLoading && (
                    <Badge
                      variant="outline"
                      className={
                        isPeriodLocked
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                      title={
                        isPeriodLocked
                          ? "This period's P&L has been signed off and locked, but this rollup still reads live budget data — figures can still move even though P&L is frozen."
                          : "This period's P&L has not been signed off yet; both P&L and this rollup can still change."
                      }
                    >
                      {isPeriodLocked ? "P&L locked · budget still live" : "Period open"}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 max-w-xl text-xs text-slate-500">Every branch's budget rolled up company-wide — branch summaries and a head/sub-head breakdown.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Period</Label>
                <Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="h-9 w-40" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Branches</p>
                <p className="mt-1 text-base font-bold text-slate-950">{branchSummaries.length}</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Company gross</p>
                <p className="mt-1 text-base font-bold text-slate-950">{money(grandTotals.gross)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Consumed</p>
                <p className="mt-1 text-base font-bold text-slate-950">{money(grandTotals.consumed)}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
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
                  <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Submission readiness — every branch</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">Head/Sub-head Coverage completion per branch's budget for this period — the same readiness check each branch already sees in its own workspace.</p>
                </CardHeader>
                <CardContent className="p-0">
                  {readiness.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">No branch has a budget for this period yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2">Branch</th>
                            <th className="px-4 py-2">Coverage completion</th>
                            <th className="px-4 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {readiness.map((r) => (
                            <tr key={r.budgetId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                              <td className="px-4 py-2 font-semibold text-slate-900">{r.branchName ?? "-"}</td>
                              <td className="px-4 py-2 text-slate-600">{r.completionPct === null ? <span title="Coverage could not be read for this branch">Not measured</span> : `${r.completionPct}%`}</td>
                              <td className="px-4 py-2">
                                <Badge variant="outline" className={r.readyToSubmit ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                                  {r.readyToSubmit ? "Ready to submit" : "Incomplete"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
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
                        style={{ minWidth: `${ROW_LABEL_WIDTH + orderedBranchColumns.length * COLUMN_WIDTH + COMPANY_TOTAL_COLUMNS.length * COMPANY_COLUMN_WIDTH}px` }}
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
                            {COMPANY_TOTAL_COLUMNS.map((col, colIndex) => (
                              <th
                                key={col.key}
                                className={`sticky z-40 border-b bg-slate-100 px-3 py-3 text-right ${colIndex === 0 ? "border-l-2 border-slate-300" : ""}`}
                                style={{ right: (COMPANY_TOTAL_COLUMNS.length - 1 - colIndex) * COMPANY_COLUMN_WIDTH, minWidth: COMPANY_COLUMN_WIDTH }}
                                title={col.hint}
                              >
                                {col.label}
                              </th>
                            ))}
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
                              {COMPANY_TOTAL_COLUMNS.map((col, colIndex) => (
                                <td
                                  key={col.key}
                                  className={`sticky z-10 bg-slate-50/80 px-3 py-2 text-right font-semibold text-slate-900 group-hover:bg-slate-100 ${colIndex === 0 ? "border-l-2 border-slate-200" : ""}`}
                                  style={{ right: (COMPANY_TOTAL_COLUMNS.length - 1 - colIndex) * COMPANY_COLUMN_WIDTH, minWidth: COMPANY_COLUMN_WIDTH }}
                                >
                                  {money(col.value(group))}
                                </td>
                              ))}
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
