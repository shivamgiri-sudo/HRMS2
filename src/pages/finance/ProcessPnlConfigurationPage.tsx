import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PnlAdjustmentDrawer } from "@/components/finance/pnl/PnlAdjustmentDrawer";
import {
  usePnlConfiguration,
  type SaveContractPayload,
  type SaveMonthlyPlanPayload,
  type SaveRatePayload,
} from "@/hooks/usePnlConfiguration";

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

function asNumber(value: string) {
  return value === "" ? 0 : Number(value);
}

export default function ProcessPnlConfigurationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const [contractForm, setContractForm] = useState<SaveContractPayload>({
    process_id: "",
    client_id: "",
    contract_name: "",
    billing_type: "per_seat",
    billing_rate: 0,
    monthly_minimum_commitment: 0,
    effective_from: `${currentPeriod()}-01`,
    status: "active",
  });
  const [rateForm, setRateForm] = useState<SaveRatePayload>({
    process_id: "",
    contract_id: "",
    rate_type: "seat_rate",
    rate_amount: 0,
    unit: "seat",
    effective_from: `${currentPeriod()}-01`,
  });
  const [planForm, setPlanForm] = useState<SaveMonthlyPlanPayload>({
    process_id: "",
    period_code: period,
    contracted_seats: 0,
    required_productive_hc: 0,
    planned_shrinkage_pct: 0,
    required_roster_hc: 0,
    buffer_target_pct: 0,
    revenue_budget: 0,
    direct_cost_budget: 0,
    indirect_cost_budget: 0,
    profit_budget: 0,
    status: "draft",
  });

  const {
    referenceQuery,
    contractsQuery,
    ratesQuery,
    monthlyPlansQuery,
    adjustmentsQuery,
    saveContract,
    saveRate,
    saveMonthlyPlan,
    createAdjustment,
  } = usePnlConfiguration(period);

  const references = referenceQuery.data;
  const processes = references?.processes ?? [];
  const selectedProcess = useMemo(
    () => processes.find((process) => process.id === contractForm.process_id),
    [contractForm.process_id, processes]
  );

  async function handleSaveContract() {
    try {
      await saveContract.mutateAsync({
        ...contractForm,
        client_id: contractForm.client_id || selectedProcess?.client_id || null,
      });
      toast.success("Contract configuration saved.");
      setContractForm((current) => ({
        ...current,
        contract_name: "",
        billing_rate: 0,
        monthly_minimum_commitment: 0,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save contract.");
    }
  }

  async function handleSaveRate() {
    try {
      await saveRate.mutateAsync(rateForm);
      toast.success("Billing rate saved.");
      setRateForm((current) => ({
        ...current,
        rate_amount: 0,
        approval_reference: "",
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save billing rate.");
    }
  }

  async function handleSavePlan() {
    try {
      await saveMonthlyPlan.mutateAsync(planForm);
      toast.success("Monthly plan saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save monthly plan.");
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_22%),linear-gradient(180deg,_#f7fbff_0%,_#ffffff_40%,_#f4f7f6_100%)]">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.35fr_0.65fr] lg:p-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
                <Settings2 className="h-3.5 w-3.5" />
                Process P&L Controls
              </div>
              <div>
                <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">
                  Commercial controls, planning assumptions and finance overrides live in one place.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Keep contracts, rate cards, monthly plans and adjustment journals aligned before Finance signs off the month.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="bg-sky-400 text-slate-950 hover:bg-sky-300">
                  <Link to={`/finance/process-pnl?period=${period}`}>Open command centre</Link>
                </Button>
                <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                  <Link to={`/finance/process-pnl/period-close?period=${period}`}>Open period close</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Contracts</p>
                    <p className="mt-2 text-3xl font-black">{contractsQuery.data?.length ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Monthly plans</p>
                    <p className="mt-2 text-3xl font-black">{monthlyPlansQuery.data?.length ?? 0}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Billing rates</p>
                    <p className="mt-2 text-3xl font-black">{ratesQuery.data?.length ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Adjustments</p>
                    <p className="mt-2 text-3xl font-black">{adjustmentsQuery.data?.length ?? 0}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <SlidersHorizontal className="h-4 w-4" />
            Planning period
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="configuration-period">Period</Label>
              <Input
                id="configuration-period"
                type="month"
                value={period}
                onChange={(event) => {
                  const nextPeriod = event.target.value;
                  setSearchParams({ period: nextPeriod });
                  setPlanForm((current) => ({ ...current, period_code: nextPeriod }));
                }}
              />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              Use this page to set the commercial truth for the selected month. The reporting page reads these controls alongside live payroll, expense and invoice data.
            </div>
          </div>
        </section>

        <Tabs defaultValue="contracts" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start rounded-2xl bg-white p-1 shadow-sm">
            <TabsTrigger value="contracts">Contracts</TabsTrigger>
            <TabsTrigger value="rates">Billing rates</TabsTrigger>
            <TabsTrigger value="plans">Monthly plans</TabsTrigger>
            <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          </TabsList>

          <TabsContent value="contracts" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Add or update contract</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contract-process">Process</Label>
                    <select
                      id="contract-process"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={contractForm.process_id ?? ""}
                      onChange={(event) => {
                        const process = processes.find((item) => item.id === event.target.value);
                        setContractForm((current) => ({
                          ...current,
                          process_id: event.target.value,
                          client_id: process?.client_id ?? "",
                        }));
                      }}
                    >
                      <option value="">Select process</option>
                      {processes.map((process) => (
                        <option key={process.id} value={process.id}>
                          {process.process_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contract-name">Contract name</Label>
                    <Input
                      id="contract-name"
                      value={contractForm.contract_name}
                      onChange={(event) => setContractForm((current) => ({ ...current, contract_name: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="contract-type">Billing model</Label>
                      <select
                        id="contract-type"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={contractForm.billing_type}
                        onChange={(event) => setContractForm((current) => ({ ...current, billing_type: event.target.value }))}
                      >
                        <option value="per_seat">Per seat</option>
                        <option value="per_hour">Per hour</option>
                        <option value="per_transaction">Per transaction</option>
                        <option value="fixed_monthly">Fixed monthly</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contract-status">Status</Label>
                      <select
                        id="contract-status"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={contractForm.status}
                        onChange={(event) => setContractForm((current) => ({ ...current, status: event.target.value }))}
                      >
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="contract-rate">Billing rate</Label>
                      <Input
                        id="contract-rate"
                        type="number"
                        value={contractForm.billing_rate ?? 0}
                        onChange={(event) => setContractForm((current) => ({ ...current, billing_rate: asNumber(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contract-minimum">Monthly commitment</Label>
                      <Input
                        id="contract-minimum"
                        type="number"
                        value={contractForm.monthly_minimum_commitment ?? 0}
                        onChange={(event) => setContractForm((current) => ({ ...current, monthly_minimum_commitment: asNumber(event.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contract-effective">Effective from</Label>
                    <Input
                      id="contract-effective"
                      type="date"
                      value={contractForm.effective_from}
                      onChange={(event) => setContractForm((current) => ({ ...current, effective_from: event.target.value }))}
                    />
                  </div>
                  <Button onClick={handleSaveContract} disabled={saveContract.isPending || !contractForm.process_id || !contractForm.contract_name.trim()}>
                    {saveContract.isPending ? "Saving..." : "Save contract"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Active commercial contracts</CardTitle>
                </CardHeader>
                <CardContent>
                  {contractsQuery.isLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-16 rounded-2xl" />
                      <Skeleton className="h-16 rounded-2xl" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(contractsQuery.data ?? []).slice(0, 8).map((row) => (
                        <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{row.contract_name}</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {row.process_name ?? "No process"} - {row.client_name ?? "No client"}
                              </p>
                              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                                {row.billing_type} / {row.status}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-950">{formatCurrency(row.billing_rate)}</p>
                              <p className="mt-1 text-xs text-slate-500">Effective {row.effective_from}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="rates" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Add billing rate</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rate-process">Process</Label>
                    <select
                      id="rate-process"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={rateForm.process_id}
                      onChange={(event) => setRateForm((current) => ({ ...current, process_id: event.target.value }))}
                    >
                      <option value="">Select process</option>
                      {processes.map((process) => (
                        <option key={process.id} value={process.id}>
                          {process.process_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="rate-type">Rate type</Label>
                      <Input
                        id="rate-type"
                        value={rateForm.rate_type}
                        onChange={(event) => setRateForm((current) => ({ ...current, rate_type: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rate-unit">Unit</Label>
                      <Input
                        id="rate-unit"
                        value={rateForm.unit}
                        onChange={(event) => setRateForm((current) => ({ ...current, unit: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="rate-amount">Amount</Label>
                      <Input
                        id="rate-amount"
                        type="number"
                        value={rateForm.rate_amount}
                        onChange={(event) => setRateForm((current) => ({ ...current, rate_amount: asNumber(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rate-effective">Effective from</Label>
                      <Input
                        id="rate-effective"
                        type="date"
                        value={rateForm.effective_from}
                        onChange={(event) => setRateForm((current) => ({ ...current, effective_from: event.target.value }))}
                      />
                    </div>
                  </div>
                  <Button onClick={handleSaveRate} disabled={saveRate.isPending || !rateForm.process_id || !rateForm.rate_type.trim()}>
                    {saveRate.isPending ? "Saving..." : "Save billing rate"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Rate card register</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(ratesQuery.data ?? []).length === 0 && ratesQuery.isLoading && (
                    <>
                      <Skeleton className="h-16 rounded-2xl" />
                      <Skeleton className="h-16 rounded-2xl" />
                    </>
                  )}
                  {(ratesQuery.data ?? []).slice(0, 10).map((row) => (
                    <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{row.process_name ?? "Unknown process"}</p>
                          <p className="mt-1 text-sm text-slate-600">{row.rate_type} / {row.unit}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-950">{formatCurrency(row.rate_amount)}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.effective_from}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="plans" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Monthly process plan</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="plan-process">Process</Label>
                    <select
                      id="plan-process"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={planForm.process_id}
                      onChange={(event) => setPlanForm((current) => ({ ...current, process_id: event.target.value }))}
                    >
                      <option value="">Select process</option>
                      {processes.map((process) => (
                        <option key={process.id} value={process.id}>
                          {process.process_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plan-seats">Contracted seats</Label>
                      <Input
                        id="plan-seats"
                        type="number"
                        value={planForm.contracted_seats ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, contracted_seats: asNumber(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-productive">Required productive HC</Label>
                      <Input
                        id="plan-productive"
                        type="number"
                        value={planForm.required_productive_hc ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, required_productive_hc: asNumber(event.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plan-roster">Required roster HC</Label>
                      <Input
                        id="plan-roster"
                        type="number"
                        value={planForm.required_roster_hc ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, required_roster_hc: asNumber(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-buffer">Buffer target %</Label>
                      <Input
                        id="plan-buffer"
                        type="number"
                        value={planForm.buffer_target_pct ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, buffer_target_pct: asNumber(event.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plan-revenue">Revenue budget</Label>
                      <Input
                        id="plan-revenue"
                        type="number"
                        value={planForm.revenue_budget ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, revenue_budget: asNumber(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-profit">Profit budget</Label>
                      <Input
                        id="plan-profit"
                        type="number"
                        value={planForm.profit_budget ?? 0}
                        onChange={(event) => setPlanForm((current) => ({ ...current, profit_budget: asNumber(event.target.value) }))}
                      />
                    </div>
                  </div>
                  <Button onClick={handleSavePlan} disabled={saveMonthlyPlan.isPending || !planForm.process_id}>
                    {saveMonthlyPlan.isPending ? "Saving..." : "Save monthly plan"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Plan rows for {period}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {monthlyPlansQuery.isLoading && (
                    <>
                      <Skeleton className="h-16 rounded-2xl" />
                      <Skeleton className="h-16 rounded-2xl" />
                    </>
                  )}
                  {(monthlyPlansQuery.data ?? []).map((row) => (
                    <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{row.process_name ?? "Unknown process"}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            Seats {row.contracted_seats ?? 0} / HC {row.required_productive_hc ?? 0}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-950">{formatCurrency(row.profit_budget)}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.status}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="adjustments" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Journal control</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4 text-sm text-sky-900">
                    Every manual change should carry a reason and land in the journal before the period is signed off.
                  </div>
                  <PnlAdjustmentDrawer
                    referenceData={references}
                    defaultPeriod={period}
                    onSubmit={async (payload) => {
                      try {
                        await createAdjustment.mutateAsync(payload);
                        toast.success("Adjustment journal entry saved.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Failed to save adjustment.");
                        throw error;
                      }
                    }}
                  />
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-950">Recent adjustments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(adjustmentsQuery.data ?? []).length === 0 && adjustmentsQuery.isLoading && (
                    <>
                      <Skeleton className="h-16 rounded-2xl" />
                      <Skeleton className="h-16 rounded-2xl" />
                    </>
                  )}
                  {(adjustmentsQuery.data ?? []).slice(0, 10).map((row) => (
                    <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{row.process_name ?? "Unknown process"}</p>
                          <p className="mt-1 text-sm text-slate-600">{row.metric_key}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">{row.approval_status}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-950">{formatCurrency(row.revised_value)}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.period_code}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-slate-950">Use approved source values</p>
                <p className="text-sm text-slate-600">Revenue, payroll and expense feeds should reconcile before a manual override is used.</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-slate-950">Keep plans period-specific</p>
                <p className="text-sm text-slate-600">Each process should have its own budget and workforce assumption for every financial month.</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-slate-950">Close through workflow</p>
                <p className="text-sm text-slate-600">Move to the period-close page once the month is ready for preparer, finance and accounts signoff.</p>
              </div>
            </CardContent>
          </Card>
        </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
