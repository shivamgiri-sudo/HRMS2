import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  IndianRupee,
  Layers3,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useHasRole } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useProcessLobPnl,
  type ProcessLobDeliveryRow,
  type ProcessLobPlanRow,
  type ProcessLobRevenueRuleRow,
  type ProcessLobRow,
  type SaveLobDeliveryPayload,
  type SaveLobPayload,
  type SaveLobPlanPayload,
  type SaveLobRevenueRulePayload,
} from "@/hooks/useProcessLobPnl";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function firstDay(period: string) {
  return `${period}-01`;
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function percent(value: unknown) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function titleCase(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function StatusBadge({ value }: { value: unknown }) {
  const status = String(value ?? "unknown").toLowerCase();
  const className = status.includes("approved") || status.includes("validated") || status.includes("locked")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status.includes("inactive") || status.includes("missing") || status.includes("exception")
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return <Badge variant="outline" className={className}>{titleCase(status)}</Badge>;
}

const emptyLob = (processId: string, period: string): SaveLobPayload => ({
  processId,
  lobCode: "",
  lobName: "",
  description: "",
  allocationScope: "direct_lob",
  effectiveFrom: firstDay(period),
  effectiveTo: null,
  activeStatus: true,
  approvalStatus: "draft",
});

const emptyPlan = (processLobId: string, period: string): SaveLobPlanPayload => ({
  processLobId,
  periodCode: period,
  contractedSeats: null,
  billableSeats: null,
  occupiedSeats: null,
  requiredProductiveHc: null,
  requiredRosterHc: null,
  revenueBudget: null,
  agentCostBudget: null,
  directVendorCostBudget: null,
  sharedCostBudget: null,
  ebitdaBudget: null,
  sharedCostDriver: "contracted_seats",
  manualAllocationPct: null,
  status: "draft",
});

const emptyRule = (processId: string, processLobId: string, period: string): SaveLobRevenueRulePayload => ({
  processId,
  processLobId,
  ruleName: "",
  billingModel: "per_seat",
  metricKey: "billable_seats",
  rateAmount: 0,
  currencyCode: "INR",
  fxToInr: 1,
  monthlyMinimumCommitment: 0,
  includedUnits: 0,
  overageRate: 0,
  mandatedSeats: null,
  effectiveFrom: firstDay(period),
  effectiveTo: null,
  status: "draft",
  approvalReference: "",
});

const emptyDelivery = (processId: string, processLobId: string, period: string): SaveLobDeliveryPayload => ({
  processId,
  processLobId,
  periodCode: period,
  activityDate: null,
  metricKey: "billable_seats",
  plannedUnits: 0,
  deliveredUnits: 0,
  acceptedUnits: 0,
  rejectedUnits: 0,
  billableUnits: 0,
  productiveHours: 0,
  loginHours: 0,
  talkMinutes: 0,
  qualityScore: null,
  slaScore: null,
  dataSource: "manual",
  sourceReference: "manual",
  status: "draft",
});

export default function ProcessLobManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const processId = searchParams.get("processId") ?? "";
  const activeTab = searchParams.get("tab") ?? "performance";
  const data = useProcessLobPnl(processId || undefined, period);

  /**
   * LOB_WRITE_ROLES in backend/src/modules/process-pnl/process-lob.routes.ts. The page itself is
   * reachable by the wider pnlRoles list (finance.routes.tsx), which also admits ceo, coo,
   * finance and payroll_head — none of whom may write. Every Save button here was ungated, so
   * those roles could fill in an entire rate card and only discover on Save that the API refuses
   * it. The backend remains the gate; this only stops the page promising something it cannot do.
   */
  const canWrite = useHasRole("super_admin", "admin", "finance_head", "accounts_head");

  const processes = data.referenceQuery.data?.processes ?? [];
  const selectedProcess = processes.find((process) => process.id === processId);
  const lobs = data.lobsQuery.data ?? [];
  const plans = data.plansQuery.data ?? [];
  const commercial = data.commercialQuery.data;
  const diagnostics = data.diagnosticsQuery.data;
  const summary = data.summaryQuery.data;

  const defaultLobId = lobs[0]?.id ?? "";
  const [lobForm, setLobForm] = useState<SaveLobPayload>(() => emptyLob(processId, period));
  const [planForm, setPlanForm] = useState<SaveLobPlanPayload>(() => emptyPlan(defaultLobId, period));
  const [ruleForm, setRuleForm] = useState<SaveLobRevenueRulePayload>(() => emptyRule(processId, defaultLobId, period));
  const [deliveryForm, setDeliveryForm] = useState<SaveLobDeliveryPayload>(() => emptyDelivery(processId, defaultLobId, period));

  useEffect(() => {
    setLobForm(emptyLob(processId, period));
    setPlanForm(emptyPlan(defaultLobId, period));
    setRuleForm(emptyRule(processId, defaultLobId, period));
    setDeliveryForm(emptyDelivery(processId, defaultLobId, period));
  }, [processId, period, defaultLobId]);

  const planByLob = useMemo(
    () => new Map(plans.map((plan) => [plan.process_lob_id, plan])),
    [plans]
  );

  function updateSearch(next: { processId?: string; period?: string; tab?: string }) {
    const params = new URLSearchParams(searchParams);
    const merged = { processId, period, tab: activeTab, ...next };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    setSearchParams(params);
  }

  async function runMutation(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error("Unable to save", {
        description: error instanceof Error ? error.message : "The finance record could not be saved",
      });
    }
  }

  function editLob(row: ProcessLobRow) {
    setLobForm({
      id: row.id,
      processId: row.process_id,
      lobCode: row.lob_code,
      lobName: row.lob_name,
      description: row.description,
      costCentreId: row.cost_centre_id,
      allocationScope: row.allocation_scope,
      effectiveFrom: String(row.effective_from).slice(0, 10),
      effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      activeStatus: Number(row.active_status) === 1,
      approvalStatus: row.approval_status,
    });
  }

  function editPlan(row: ProcessLobPlanRow) {
    setPlanForm({
      id: row.id,
      processLobId: row.process_lob_id,
      periodCode: row.period_code,
      contractedSeats: row.contracted_seats,
      billableSeats: row.billable_seats,
      occupiedSeats: row.occupied_seats,
      requiredProductiveHc: row.required_productive_hc,
      requiredRosterHc: row.required_roster_hc,
      revenueBudget: row.revenue_budget,
      agentCostBudget: row.agent_cost_budget,
      directVendorCostBudget: row.direct_vendor_cost_budget,
      sharedCostBudget: row.shared_cost_budget,
      ebitdaBudget: row.ebitda_budget,
      sharedCostDriver: row.shared_cost_driver,
      manualAllocationPct: row.manual_allocation_pct,
      status: row.status,
    });
  }

  function editRule(row: ProcessLobRevenueRuleRow) {
    setRuleForm({
      id: row.id,
      processId: row.process_id,
      processLobId: row.process_lob_id,
      ruleName: row.rule_name,
      billingModel: row.billing_model,
      metricKey: row.metric_key,
      rateAmount: Number(row.rate_amount),
      currencyCode: row.currency_code,
      fxToInr: Number(row.fx_to_inr),
      monthlyMinimumCommitment: Number(row.monthly_minimum_commitment),
      includedUnits: Number(row.included_units),
      overageRate: Number(row.overage_rate),
      mandatedSeats: row.mandated_seats,
      effectiveFrom: String(row.effective_from).slice(0, 10),
      effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      status: row.status as SaveLobRevenueRulePayload["status"],
    });
  }

  function editDelivery(row: ProcessLobDeliveryRow) {
    setDeliveryForm({
      id: row.id,
      processId: row.process_id,
      processLobId: row.process_lob_id,
      periodCode: row.period_code,
      activityDate: row.activity_date ? String(row.activity_date).slice(0, 10) : null,
      metricKey: row.metric_key,
      plannedUnits: Number(row.planned_units),
      deliveredUnits: Number(row.delivered_units),
      acceptedUnits: Number(row.accepted_units),
      rejectedUnits: Number(row.rejected_units),
      billableUnits: Number(row.billable_units),
      // Carried through the edit. Omitting them sent undefined, and saveDelivery's upsert writes
      // `input.productiveHours ?? 0` — so correcting a single unit count silently zeroed the
      // stored hours, and any per_productive_hour / per_login_hour / per_talk_minute LOB then
      // recognised no revenue at all for that month.
      productiveHours: Number(row.productive_hours ?? 0),
      loginHours: Number(row.login_hours ?? 0),
      talkMinutes: Number(row.talk_minutes ?? 0),
      qualityScore: row.quality_score,
      slaScore: row.sla_score,
      dataSource: row.data_source,
      sourceReference: row.source_reference,
      status: row.status as SaveLobDeliveryPayload["status"],
    });
  }

  const isLoading = data.referenceQuery.isLoading || (Boolean(processId) && data.summaryQuery.isLoading);
  const processRows = summary?.rows ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Link to={`/finance/process-pnl?period=${period}`} className="inline-flex items-center gap-1 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" /> Process P&amp;L
              </Link>
              <span>/</span>
              <span>LOB workspace</span>
            </div>
            <h1 className="mt-1 text-lg font-bold text-slate-950">Process &amp; LOB Profitability</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Configure separate seats, rates and delivery for every LOB while keeping the process total reconciled.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to={`/finance/process-pnl/configuration?period=${period}`}>Master controls</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/finance/process-pnl/period-close?period=${period}`}>Period close</Link>
            </Button>
          </div>
        </div>

        {/* A disabled Save with no reason reads as a broken page. Say which roles may write. */}
        {!canWrite && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">Read-only.</span> LOB masters, plans, rate rules and delivery
            actuals are edited by Finance Head, Accounts Head or an administrator. You can review
            everything on this page; the Save buttons are disabled because the API would refuse the change.
          </div>
        )}

        <Card>
          <CardContent className="grid gap-3 p-4 md:grid-cols-[180px_minmax(260px,1fr)_auto] md:items-end">
            <Field label="Period">
              <MonthYearPicker value={period} onChange={(v) => updateSearch({ period: v })} />
            </Field>
            <Field label="Process">
              <select className={selectClass} value={processId} onChange={(event) => updateSearch({ processId: event.target.value })}>
                <option value="">Select a process</option>
                {processes.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.process_name}{process.client_name ? ` — ${process.client_name}` : ""}{process.branch_name ? ` — ${process.branch_name}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="outline"
              disabled={!processId}
              onClick={() => void Promise.all([
                data.lobsQuery.refetch(),
                data.plansQuery.refetch(),
                data.commercialQuery.refetch(),
                data.diagnosticsQuery.refetch(),
                data.summaryQuery.refetch(),
              ])}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </CardContent>
        </Card>

        {!processId ? (
          <Card className="border-dashed">
            <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
              <Layers3 className="mb-3 h-10 w-10 text-slate-400" />
              <p className="font-semibold text-slate-800">Select a process to begin</p>
              <p className="mt-1 max-w-lg text-sm text-slate-500">
                The workspace will show its LOB structure, seat plans, commercial rates, delivery evidence and reconciled P&amp;L.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {isLoading ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Card><CardContent className="p-4"><Layers3 className="h-5 w-5 text-slate-400" /><p className="mt-3 text-xs font-semibold uppercase text-slate-500">Active LOBs</p><p className="text-2xl font-bold">{diagnostics?.activeLobCount ?? lobs.length}</p></CardContent></Card>
                <Card><CardContent className="p-4"><IndianRupee className="h-5 w-5 text-slate-400" /><p className="mt-3 text-xs font-semibold uppercase text-slate-500">Recognised revenue</p><p className="text-xl font-bold">{currency(summary?.totals.recognizedRevenue)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><GitBranch className={`h-5 w-5 ${(summary?.totals.ebitda ?? 0) < 0 ? "text-rose-500" : "text-emerald-500"}`} /><p className="mt-3 text-xs font-semibold uppercase text-slate-500">EBITDA</p><p className={`text-xl font-bold ${(summary?.totals.ebitda ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{currency(summary?.totals.ebitda)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><UsersRound className="h-5 w-5 text-slate-400" /><p className="mt-3 text-xs font-semibold uppercase text-slate-500">Plan coverage</p><p className="text-2xl font-bold">{percent(diagnostics?.planCoveragePct)}</p></CardContent></Card>
                <Card><CardContent className="p-4">{diagnostics?.readyForClose ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <ShieldAlert className="h-5 w-5 text-amber-500" />}<p className="mt-3 text-xs font-semibold uppercase text-slate-500">Close readiness</p><p className="text-xl font-bold">{diagnostics?.readyForClose ? "Ready" : `${diagnostics?.blockers.length ?? 0} blocker(s)`}</p></CardContent></Card>
              </div>
            )}

            {diagnostics && !diagnostics.readyForClose ? (
              <Card className="border-amber-200 bg-amber-50/40">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-amber-600" /> Close-readiness blockers</CardTitle></CardHeader>
                <CardContent className="grid gap-2 md:grid-cols-2">
                  {diagnostics.blockers.map((blocker, index) => (
                    <div key={`${blocker.code}-${index}`} className="rounded-lg border border-amber-200 bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-700">{titleCase(blocker.code)}</p>
                      <p className="mt-1 text-sm text-slate-700">{blocker.message}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Tabs value={activeTab} onValueChange={(tab) => updateSearch({ tab })}>
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="performance">LOB performance</TabsTrigger>
                <TabsTrigger value="setup">LOB setup</TabsTrigger>
                <TabsTrigger value="plans">Seats &amp; budget</TabsTrigger>
                <TabsTrigger value="rates">Rates</TabsTrigger>
                <TabsTrigger value="delivery">Delivery</TabsTrigger>
              </TabsList>

              <TabsContent value="performance" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{selectedProcess?.process_name} — LOB P&amp;L</CardTitle>{summary ? <Badge variant={summary.reconciliation.isReconciled ? "secondary" : "destructive"}>{summary.reconciliation.isReconciled ? "Reconciled" : "Reconciliation exception"}</Badge> : null}</CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <table className="min-w-[1500px] w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>{["LOB","Seats","Billable","Fill %","Agent HC","Revenue","Agent cost","Direct vendor","Shared cost","Contribution","EBITDA","Margin","PBT","PAT","Plan status"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {processRows.map((row) => (
                          <tr key={row.processLobId ?? row.lobCode} className={row.rowType === "unallocated" ? "bg-rose-50/60" : "hover:bg-slate-50"}>
                            <td className="px-3 py-3"><p className="font-semibold text-slate-900">{row.lobName}</p><p className="text-xs text-slate-500">{row.lobCode}</p></td>
                            <td className="px-3 py-3">{row.contractedSeats}</td><td className="px-3 py-3">{row.billableSeats}</td><td className="px-3 py-3">{percent(row.seatFillPct)}</td><td className="px-3 py-3">{row.agentHeadcount}</td>
                            <td className="px-3 py-3 font-semibold">{currency(row.recognizedRevenue)}</td><td className="px-3 py-3">{currency(row.agentSalary)}</td><td className="px-3 py-3">{currency(row.directVendorCost)}</td><td className="px-3 py-3">{currency(row.sharedCost)}</td><td className="px-3 py-3">{currency(row.contribution)}</td><td className={`px-3 py-3 font-semibold ${row.ebitda < 0 ? "text-rose-600" : "text-emerald-700"}`}>{currency(row.ebitda)}</td><td className="px-3 py-3">{percent(row.ebitdaMarginPct)}</td><td className="px-3 py-3">{currency(row.pbt)}</td><td className="px-3 py-3">{currency(row.pat)}</td><td className="px-3 py-3"><StatusBadge value={row.planStatus} /></td>
                          </tr>
                        ))}
                        {!processRows.length ? <tr><td colSpan={15} className="px-4 py-12 text-center text-slate-500">No LOB P&amp;L rows are available. Complete LOB setup, plan, rate and delivery first.</td></tr> : null}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="setup" className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <Card><CardHeader><CardTitle className="text-base">LOB master</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">LOB name</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Effective</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y">{lobs.map((lob) => <tr key={lob.id}><td className="px-4 py-3 font-mono text-xs">{lob.lob_code}</td><td className="px-4 py-3"><p className="font-medium">{lob.lob_name}</p><p className="text-xs text-slate-500">{lob.description || "—"}</p></td><td className="px-4 py-3">{titleCase(lob.allocation_scope)}</td><td className="px-4 py-3 text-xs">{String(lob.effective_from).slice(0, 10)} → {lob.effective_to ? String(lob.effective_to).slice(0, 10) : "Open"}</td><td className="px-4 py-3"><StatusBadge value={lob.approval_status} /></td><td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => editLob(lob)}>Edit</Button></td></tr>)}</tbody></table></CardContent></Card>
                <Card><CardHeader><CardTitle className="flex items-center justify-between text-base">{lobForm.id ? "Edit LOB" : "Add LOB"}<Button size="sm" variant="ghost" onClick={() => setLobForm(emptyLob(processId, period))}><Plus className="mr-1 h-4 w-4" /> New</Button></CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="LOB code"><Input value={lobForm.lobCode} onChange={(e) => setLobForm((value) => ({ ...value, lobCode: e.target.value.toUpperCase() }))} /></Field><Field label="LOB name"><Input value={lobForm.lobName} onChange={(e) => setLobForm((value) => ({ ...value, lobName: e.target.value }))} /></Field></div><Field label="Description"><Textarea value={lobForm.description ?? ""} onChange={(e) => setLobForm((value) => ({ ...value, description: e.target.value }))} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Allocation scope"><select className={selectClass} value={lobForm.allocationScope} onChange={(e) => setLobForm((value) => ({ ...value, allocationScope: e.target.value as SaveLobPayload["allocationScope"] }))}><option value="direct_lob">Direct LOB</option><option value="shared_process">Shared process</option></select></Field><Field label="Approval status"><select className={selectClass} value={lobForm.approvalStatus} onChange={(e) => setLobForm((value) => ({ ...value, approvalStatus: e.target.value as SaveLobPayload["approvalStatus"] }))}><option value="draft">Draft</option><option value="approved">Approved</option><option value="inactive">Inactive</option></select></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Effective from"><Input type="date" value={lobForm.effectiveFrom} onChange={(e) => setLobForm((value) => ({ ...value, effectiveFrom: e.target.value }))} /></Field><Field label="Effective to"><Input type="date" value={lobForm.effectiveTo ?? ""} onChange={(e) => setLobForm((value) => ({ ...value, effectiveTo: e.target.value || null }))} /></Field></div><Button className="w-full" disabled={!canWrite || data.saveLob.isPending} onClick={() => void runMutation(() => data.saveLob.mutateAsync(lobForm), "LOB saved")}><Save className="mr-2 h-4 w-4" /> Save LOB</Button></CardContent></Card>
              </TabsContent>

              <TabsContent value="plans" className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <Card><CardHeader><CardTitle className="text-base">Seat and monthly plans</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[920px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["LOB","Contracted","Billable","Occupied","Revenue budget","EBITDA budget","Driver","Status",""].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{lobs.map((lob) => { const plan = planByLob.get(lob.id); return <tr key={lob.id}><td className="px-3 py-3 font-medium">{lob.lob_name}</td><td className="px-3 py-3">{plan?.contracted_seats ?? "—"}</td><td className="px-3 py-3">{plan?.billable_seats ?? "—"}</td><td className="px-3 py-3">{plan?.occupied_seats ?? "—"}</td><td className="px-3 py-3">{plan ? currency(plan.revenue_budget) : "—"}</td><td className="px-3 py-3">{plan ? currency(plan.ebitda_budget) : "—"}</td><td className="px-3 py-3">{plan ? titleCase(plan.shared_cost_driver) : "—"}</td><td className="px-3 py-3"><StatusBadge value={plan?.status ?? "missing"} /></td><td className="px-3 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => plan ? editPlan(plan) : setPlanForm(emptyPlan(lob.id, period))}>{plan ? "Edit" : "Add"}</Button></td></tr>; })}</tbody></table></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Monthly plan</CardTitle></CardHeader><CardContent className="space-y-4"><Field label="LOB"><select className={selectClass} value={planForm.processLobId} onChange={(e) => setPlanForm((value) => ({ ...value, processLobId: e.target.value }))}>{lobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.lob_code} — {lob.lob_name}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="Contracted seats"><Input type="number" min="0" value={planForm.contractedSeats ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, contractedSeats: numberOrNull(e.target.value) }))} /></Field><Field label="Billable seats"><Input type="number" min="0" value={planForm.billableSeats ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, billableSeats: numberOrNull(e.target.value) }))} /></Field><Field label="Occupied seats"><Input type="number" min="0" value={planForm.occupiedSeats ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, occupiedSeats: numberOrNull(e.target.value) }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Revenue budget"><Input type="number" min="0" value={planForm.revenueBudget ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, revenueBudget: numberOrNull(e.target.value) }))} /></Field><Field label="EBITDA budget"><Input type="number" min="0" value={planForm.ebitdaBudget ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, ebitdaBudget: numberOrNull(e.target.value) }))} /></Field><Field label="Agent cost budget"><Input type="number" min="0" value={planForm.agentCostBudget ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, agentCostBudget: numberOrNull(e.target.value) }))} /></Field><Field label="Direct vendor budget"><Input type="number" min="0" value={planForm.directVendorCostBudget ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, directVendorCostBudget: numberOrNull(e.target.value) }))} /></Field></div><Field label="Shared-cost driver"><select className={selectClass} value={planForm.sharedCostDriver} onChange={(e) => setPlanForm((value) => ({ ...value, sharedCostDriver: e.target.value }))}>{["contracted_seats","billable_seats","occupied_seats","active_hc","revenue","equal","manual"].map((driver) => <option key={driver} value={driver}>{titleCase(driver)}</option>)}</select></Field>{planForm.sharedCostDriver === "manual" ? <Field label="Manual allocation %"><Input type="number" min="0" max="100" value={planForm.manualAllocationPct ?? ""} onChange={(e) => setPlanForm((value) => ({ ...value, manualAllocationPct: numberOrNull(e.target.value) }))} /></Field> : null}<Field label="Status"><select className={selectClass} value={planForm.status} onChange={(e) => setPlanForm((value) => ({ ...value, status: e.target.value as SaveLobPlanPayload["status"] }))}><option value="draft">Draft</option><option value="approved">Approved</option><option value="locked">Locked</option></select></Field><Button className="w-full" disabled={!canWrite || !planForm.processLobId || data.savePlan.isPending} onClick={() => void runMutation(() => data.savePlan.mutateAsync({ ...planForm, periodCode: period }), "LOB plan saved")}><Save className="mr-2 h-4 w-4" /> Save plan</Button></CardContent></Card>
              </TabsContent>

              <TabsContent value="rates" className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <Card><CardHeader><CardTitle className="text-base">LOB commercial rates</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["LOB","Rule","Model","Metric","Rate","Mandated seats","Effective","Status",""].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{(commercial?.revenueRules ?? []).map((rule) => <tr key={rule.id}><td className="px-3 py-3 font-medium">{rule.lob_name}</td><td className="px-3 py-3">{rule.rule_name}</td><td className="px-3 py-3">{titleCase(rule.billing_model)}</td><td className="px-3 py-3 font-mono text-xs">{rule.metric_key}</td><td className="px-3 py-3">{rule.currency_code} {Number(rule.rate_amount).toLocaleString("en-IN")}</td><td className="px-3 py-3">{rule.mandated_seats ?? "—"}</td><td className="px-3 py-3 text-xs">{String(rule.effective_from).slice(0, 10)} → {rule.effective_to ? String(rule.effective_to).slice(0, 10) : "Open"}</td><td className="px-3 py-3"><StatusBadge value={rule.status} /></td><td className="px-3 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => editRule(rule)}>Edit</Button></td></tr>)}</tbody></table></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Revenue rule</CardTitle></CardHeader><CardContent className="space-y-4"><Field label="LOB"><select className={selectClass} value={ruleForm.processLobId} onChange={(e) => setRuleForm((value) => ({ ...value, processLobId: e.target.value }))}>{lobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.lob_code} — {lob.lob_name}</option>)}</select></Field><Field label="Rule name"><Input value={ruleForm.ruleName} onChange={(e) => setRuleForm((value) => ({ ...value, ruleName: e.target.value }))} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Billing model"><select className={selectClass} value={ruleForm.billingModel} onChange={(e) => setRuleForm((value) => ({ ...value, billingModel: e.target.value }))}>{["per_seat","per_fte","per_productive_hour","per_login_hour","per_talk_minute","per_transaction","per_mandate","per_case","fixed_monthly","outcome_based"].map((model) => <option key={model} value={model}>{titleCase(model)}</option>)}</select></Field><Field label="Metric key"><Input value={ruleForm.metricKey} onChange={(e) => setRuleForm((value) => ({ ...value, metricKey: e.target.value }))} /></Field></div><div className="grid gap-3 sm:grid-cols-3"><Field label="Rate"><Input type="number" min="0" step="0.000001" value={ruleForm.rateAmount} onChange={(e) => setRuleForm((value) => ({ ...value, rateAmount: numberValue(e.target.value) }))} /></Field><Field label="Currency"><Input maxLength={3} value={ruleForm.currencyCode} onChange={(e) => setRuleForm((value) => ({ ...value, currencyCode: e.target.value.toUpperCase() }))} /></Field><Field label="FX to INR"><Input type="number" min="0.000001" step="0.000001" value={ruleForm.fxToInr} onChange={(e) => setRuleForm((value) => ({ ...value, fxToInr: numberValue(e.target.value) }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Mandated seats"><Input type="number" min="0" value={ruleForm.mandatedSeats ?? ""} onChange={(e) => setRuleForm((value) => ({ ...value, mandatedSeats: numberOrNull(e.target.value) }))} /></Field><Field label="Minimum commitment"><Input type="number" min="0" value={ruleForm.monthlyMinimumCommitment ?? 0} onChange={(e) => setRuleForm((value) => ({ ...value, monthlyMinimumCommitment: numberValue(e.target.value) }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Effective from"><Input type="date" value={ruleForm.effectiveFrom} onChange={(e) => setRuleForm((value) => ({ ...value, effectiveFrom: e.target.value }))} /></Field><Field label="Effective to"><Input type="date" value={ruleForm.effectiveTo ?? ""} onChange={(e) => setRuleForm((value) => ({ ...value, effectiveTo: e.target.value || null }))} /></Field></div><Field label="Status"><select className={selectClass} value={ruleForm.status} onChange={(e) => setRuleForm((value) => ({ ...value, status: e.target.value as SaveLobRevenueRulePayload["status"] }))}><option value="draft">Draft</option><option value="approved">Approved</option><option value="inactive">Inactive</option></select></Field><Button className="w-full" disabled={!canWrite || !ruleForm.processLobId || data.saveRevenueRule.isPending} onClick={() => void runMutation(() => data.saveRevenueRule.mutateAsync({ ...ruleForm, processId }), "LOB revenue rule saved")}><Save className="mr-2 h-4 w-4" /> Save rate rule</Button></CardContent></Card>
              </TabsContent>

              <TabsContent value="delivery" className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <Card><CardHeader><CardTitle className="text-base">Validated LOB delivery</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["LOB","Metric","Planned","Delivered","Accepted","Billable","Quality","SLA","Source","Status",""].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{(commercial?.deliveryActuals ?? []).map((row) => <tr key={row.id}><td className="px-3 py-3 font-medium">{row.lob_name}</td><td className="px-3 py-3 font-mono text-xs">{row.metric_key}</td><td className="px-3 py-3">{row.planned_units}</td><td className="px-3 py-3">{row.delivered_units}</td><td className="px-3 py-3">{row.accepted_units}</td><td className="px-3 py-3">{row.billable_units}</td><td className="px-3 py-3">{row.quality_score ?? "—"}</td><td className="px-3 py-3">{row.sla_score ?? "—"}</td><td className="px-3 py-3 text-xs">{row.data_source}<br />{row.source_reference}</td><td className="px-3 py-3"><StatusBadge value={row.status} /></td><td className="px-3 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => editDelivery(row)}>Edit</Button></td></tr>)}</tbody></table></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Delivery actual</CardTitle></CardHeader><CardContent className="space-y-4"><Field label="LOB"><select className={selectClass} value={deliveryForm.processLobId} onChange={(e) => setDeliveryForm((value) => ({ ...value, processLobId: e.target.value }))}>{lobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.lob_code} — {lob.lob_name}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Metric key"><Input value={deliveryForm.metricKey} onChange={(e) => setDeliveryForm((value) => ({ ...value, metricKey: e.target.value }))} /></Field><Field label="Activity date"><Input type="date" value={deliveryForm.activityDate ?? ""} onChange={(e) => setDeliveryForm((value) => ({ ...value, activityDate: e.target.value || null }))} /></Field></div><div className="grid gap-3 sm:grid-cols-3"><Field label="Planned"><Input type="number" min="0" value={deliveryForm.plannedUnits ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, plannedUnits: numberValue(e.target.value) }))} /></Field><Field label="Delivered"><Input type="number" min="0" value={deliveryForm.deliveredUnits ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, deliveredUnits: numberValue(e.target.value) }))} /></Field><Field label="Accepted"><Input type="number" min="0" value={deliveryForm.acceptedUnits ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, acceptedUnits: numberValue(e.target.value) }))} /></Field><Field label="Rejected"><Input type="number" min="0" value={deliveryForm.rejectedUnits ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, rejectedUnits: numberValue(e.target.value) }))} /></Field><Field label="Billable"><Input type="number" min="0" value={deliveryForm.billableUnits ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, billableUnits: numberValue(e.target.value) }))} /></Field><Field label="Quality score"><Input type="number" min="0" max="100" value={deliveryForm.qualityScore ?? ""} onChange={(e) => setDeliveryForm((value) => ({ ...value, qualityScore: numberOrNull(e.target.value) }))} /></Field></div><div className="grid gap-3 sm:grid-cols-3"><Field label="Productive hours" hint="Billed by per_productive_hour LOBs"><Input type="number" min="0" step="0.01" value={deliveryForm.productiveHours ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, productiveHours: numberValue(e.target.value) }))} /></Field><Field label="Login hours"><Input type="number" min="0" step="0.01" value={deliveryForm.loginHours ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, loginHours: numberValue(e.target.value) }))} /></Field><Field label="Talk minutes"><Input type="number" min="0" step="0.01" value={deliveryForm.talkMinutes ?? 0} onChange={(e) => setDeliveryForm((value) => ({ ...value, talkMinutes: numberValue(e.target.value) }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Data source"><Input value={deliveryForm.dataSource} onChange={(e) => setDeliveryForm((value) => ({ ...value, dataSource: e.target.value }))} /></Field><Field label="Source reference"><Input value={deliveryForm.sourceReference} onChange={(e) => setDeliveryForm((value) => ({ ...value, sourceReference: e.target.value }))} /></Field></div><Field label="Status"><select className={selectClass} value={deliveryForm.status} onChange={(e) => setDeliveryForm((value) => ({ ...value, status: e.target.value as SaveLobDeliveryPayload["status"] }))}><option value="draft">Draft</option><option value="validated">Validated</option><option value="locked">Locked</option></select></Field><Button className="w-full" disabled={!canWrite || !deliveryForm.processLobId || data.saveDelivery.isPending} onClick={() => void runMutation(() => data.saveDelivery.mutateAsync({ ...deliveryForm, processId, periodCode: period }), "LOB delivery saved")}><Save className="mr-2 h-4 w-4" /> Save delivery</Button></CardContent></Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
