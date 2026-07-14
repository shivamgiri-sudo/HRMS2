import { Link, useSearchParams } from "react-router-dom";
import { CheckCheck, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { IndirectAllocationPanel } from "@/components/finance/pnl/IndirectAllocationPanel";
import { ProcessCostLedger } from "@/components/finance/pnl/ProcessCostLedger";
import { RevenueReconciliationPanel } from "@/components/finance/pnl/RevenueReconciliationPanel";
import { usePnlReconciliation } from "@/hooks/usePnlReconciliation";

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
          <Skeleton className="h-52 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-[520px] rounded-3xl" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_20%),linear-gradient(180deg,_#fffdf6_0%,_#ffffff_36%,_#f7fafc_100%)]">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
                <CheckCheck className="h-3.5 w-3.5" />
                Period Close
              </div>
              <div>
                <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">
                  Sign off the month only after the commercial numbers and the source ledgers agree.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  This close view surfaces unresolved exceptions, signoff progress, branch allocation pressure and adjustment history for the selected month.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="bg-amber-400 text-slate-950 hover:bg-amber-300">
                  <Link to={`/finance/process-pnl?period=${period}`}>Open command centre</Link>
                </Button>
                <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                  <Link to={`/finance/process-pnl/configuration?period=${period}`}>Open configuration</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Period status</p>
                    <p className="mt-2 text-2xl font-black">{closeData?.period.status ?? "open"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Last calculation</p>
                    <p className="mt-2 text-sm font-semibold">{closeData?.lastCalculatedAt ? new Date(closeData.lastCalculatedAt).toLocaleString("en-IN") : "-"}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Operating profit</p>
                    <p className="mt-2 text-2xl font-black">{formatCurrency(closeData?.summary.operatingProfit)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Revenue at risk</p>
                    <p className="mt-2 text-2xl font-black">{formatCurrency(closeData?.summary.revenueAtRisk)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Receivable risk</p>
                    <p className="mt-2 text-2xl font-black">{formatCurrency(closeData?.summary.receivableRisk)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
            <div className="space-y-2">
              <label htmlFor="close-period" className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Period
              </label>
              <Input
                id="close-period"
                type="month"
                value={period}
                onChange={(event) => setSearchParams({ period: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Processes</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{closeData?.processCounts.total ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Profitable</p>
                <p className="mt-2 text-2xl font-black text-emerald-950">{closeData?.processCounts.profitable ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-amber-700">At risk</p>
                <p className="mt-2 text-2xl font-black text-amber-950">{closeData?.processCounts.atRisk ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-rose-700">Loss-making</p>
                <p className="mt-2 text-2xl font-black text-rose-950">{closeData?.processCounts.lossMaking ?? 0}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <Button variant="outline" onClick={handleRecalculate} disabled={recalculate.isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {recalculate.isPending ? "Refreshing..." : "Recalculate"}
              </Button>
              <Button onClick={handleLock} disabled={lockPeriod.isPending || !closeData?.availableActions.canLock || closeData?.period.status === "locked"}>
                <Lock className="mr-2 h-4 w-4" />
                {lockPeriod.isPending ? "Locking..." : "Lock period"}
              </Button>
            </div>
          </div>
        </section>

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
            <CardContent className="space-y-3">
              {(closeData?.lossMakingProcesses ?? []).length === 0 && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                  No loss-making processes were flagged for this period.
                </div>
              )}
              {(closeData?.lossMakingProcesses ?? []).map((row) => (
                <div key={row.processId} className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{row.processName}</p>
                      <p className="mt-1 text-sm text-slate-600">{row.clientName ?? "No client"} / {row.branchName ?? "No branch"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-rose-900">{formatCurrency(row.operatingProfit)}</p>
                      <p className="mt-1 text-xs text-rose-700">{(row.operatingMarginPct ?? 0).toFixed(1)}% margin</p>
                    </div>
                  </div>
                </div>
              ))}
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
    </DashboardLayout>
  );
}
