import { useSearchParams } from "react-router-dom";
import { ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { IndirectAllocationPanel } from "@/components/finance/pnl/IndirectAllocationPanel";
import { ProcessCostLedger } from "@/components/finance/pnl/ProcessCostLedger";
import { RevenueReconciliationPanel } from "@/components/finance/pnl/RevenueReconciliationPanel";
import { usePnlReconciliation } from "@/hooks/usePnlReconciliation";
import { useHasRole } from "@/hooks/useUserRole";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

const signoffLabels = {
  finance_preparer: "Finance Preparer",
  finance_head: "Finance Head",
  accounts_head: "Accounts Head",
  ceo: "CEO",
} as const;

export default function PnlPeriodClosePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const { periodCloseQuery, recalculate, signoff, lockPeriod } = usePnlReconciliation(period);

  // PNL_WRITE_ROLES on POST /pnl/recalculate (process-pnl.routes.ts) — deliberately narrower than
  // PNL_SIGNOFF_ROLES, which adds ceo and coo. Sign off and Lock are already driven by the
  // server's own availableActions; Recalculate was the one action rendered unconditionally, so a
  // CEO — arguably this page's main reader — clicked it and got a 403.
  const canRecalculate = useHasRole(
    "super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"
  );

  const closeData = periodCloseQuery.data;

  async function handleSignoff() {
    if (!closeData?.period.id) return;
    try {
      await signoff.mutateAsync({
        periodId: closeData.period.id,
      });
      const role = closeData.availableActions.signoffRole;
      toast.success(role ? `${signoffLabels[role]} signoff recorded.` : "Signoff recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record signoff.");
    }
  }

  async function handleLock() {
    if (!closeData?.period.id) return;
    try {
      await lockPeriod.mutateAsync(closeData.period.id);
      toast.success("Period locked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to lock period.");
    }
  }

  async function handleRecalculate() {
    try {
      await recalculate.mutateAsync();
      toast.success("The Process P&L period has been recalculated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recalculation failed.");
    }
  }

  if (periodCloseQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-[520px] rounded-3xl" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* 48px slim header */}
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">Period Close</h1>
          <div className="flex items-center gap-2">
            {/* setSearchParams replaced the whole query string, dropping any other param on the
                URL whenever the month changed; merged now, matching updateFilters in
                ProcessPnlPage. */}
            <MonthYearPicker
              value={period}
              onChange={(v) => {
                const next = new URLSearchParams(searchParams);
                next.set("period", v);
                setSearchParams(next);
              }}
              className="w-52"
            />
            {closeData && (
              <>
                <Badge variant="outline" className="text-xs">
                  Total: {closeData.processCounts?.total ?? 0}
                </Badge>
                {closeData.period?.status && (
                  <Badge
                    variant={closeData.period.status === "locked" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {closeData.period.status}
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              {closeData && <RevenueReconciliationPanel alertCounts={closeData.alertCounts} alerts={closeData.topAlerts} />}
              {closeData && <IndirectAllocationPanel rows={closeData.allocationDrivers} />}
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Signoff workflow</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {closeData?.signoffs.map((item) => (
                    <div key={item.role} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{signoffLabels[item.role]}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {item.status === "signed" && item.signed_at
                            ? `Signed ${new Date(item.signed_at).toLocaleString("en-IN")}`
                            : "Pending signoff"}
                        </p>
                      </div>
                      {item.status === "signed" ? (
                        <Button variant="outline" disabled>
                          Signed
                        </Button>
                      ) : closeData?.availableActions.signoffRole === item.role ? (
                        <Button onClick={() => handleSignoff()} disabled={signoff.isPending}>
                          Sign off
                        </Button>
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Waiting</span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Most urgent loss-makers</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {(closeData?.lossMakingProcesses ?? []).length === 0 ? (
                    <p className="px-6 py-4 text-sm text-emerald-800">No loss-making processes were flagged for this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-2">Process</th>
                            <th className="px-4 py-2">Client / Branch</th>
                            <th className="px-4 py-2 text-right">Operating profit</th>
                            <th className="px-4 py-2 text-right">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(closeData?.lossMakingProcesses ?? []).map((row) => (
                            <tr key={row.processId} className="border-b border-rose-100 bg-rose-50/40 last:border-0">
                              <td className="px-4 py-2 font-medium text-slate-900">{row.processName}</td>
                              <td className="px-4 py-2 text-slate-600">{row.clientName ?? "No client"} / {row.branchName ?? "No branch"}</td>
                              <td className="px-4 py-2 text-right font-semibold text-rose-900">{formatCurrency(row.operatingProfit)}</td>
                              <td className="px-4 py-2 text-right text-rose-700">{(row.operatingMarginPct ?? 0).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {closeData && <ProcessCostLedger title="Adjustment ledger" rows={closeData.adjustments} />}

            {!closeData && (
              <Card className="rounded-3xl border-rose-200 bg-rose-50 shadow-sm">
                <CardContent className="flex items-center gap-3 p-6 text-rose-800">
                  <ShieldAlert className="h-5 w-5" />
                  This period did not return a close bundle. Try another month or recalculate the period.
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Sticky bottom action bar */}
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-white px-4 py-3 shrink-0">
          <span className="text-xs text-slate-500">
            Period: <b className="text-slate-900">{period}</b>
          </span>
          <div className="flex gap-2">
            {canRecalculate && (
              <Button
                size="sm"
                variant="outline"
                disabled={recalculate.isPending}
                onClick={handleRecalculate}
              >
                {recalculate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Recalculate
              </Button>
            )}
            {!!closeData?.availableActions?.signoffRole && (
              <Button
                size="sm"
                disabled={signoff.isPending}
                onClick={handleSignoff}
              >
                {signoff.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Sign off
              </Button>
            )}
            {closeData?.availableActions?.canLock && (
              <Button
                size="sm"
                variant="destructive"
                disabled={lockPeriod.isPending}
                onClick={handleLock}
              >
                {lockPeriod.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Lock period
              </Button>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
