import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BadgeIndianRupee,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  Gauge,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PnlAdjustmentDrawer } from "@/components/finance/pnl/PnlAdjustmentDrawer";
import {
  usePnlConfiguration,
  type SaveContractPayload,
  type SaveMonthlyPlanPayload,
  type SaveRatePayload,
} from "@/hooks/usePnlConfiguration";
import {
  useBpoPnlConfiguration,
  type AllocationPolicyPayload,
  type ClassificationRulePayload,
  type CostComponentPayload,
  type DeliveryActualPayload,
  type RevenueComponentPayload,
  type RevenueRulePayload,
} from "@/hooks/useBpoPnlConfiguration";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function firstDay(period = currentPeriod()) {
  return `${period}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function numeric(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ProcessSelect({
  id,
  value,
  onChange,
  processes,
  allowBlank = false,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  processes: Array<{ id: string; process_name: string; branch_name?: string | null }>;
  allowBlank?: boolean;
}) {
  return (
    <select id={id} className={selectClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">{allowBlank ? "Shared / no single process" : "Select process"}</option>
      {processes.map((process) => (
        <option key={process.id} value={process.id}>
          {process.process_name}{process.branch_name ? ` — ${process.branch_name}` : ""}
        </option>
      ))}
    </select>
  );
}

function BranchSelect({
  id,
  value,
  onChange,
  branches,
  allowBlank = false,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  branches: Array<{ id: string; branch_name: string }>;
  allowBlank?: boolean;
}) {
  return (
    <select id={id} className={selectClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">{allowBlank ? "Organisation / no single branch" : "Select branch"}</option>
      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
    </select>
  );
}

function DataTable({
  columns,
  rows,
  emptyText,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right"; format?: (value: any, row: Record<string, any>) => string }>;
  rows: Array<Record<string, any>>;
  emptyText: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`whitespace-nowrap px-4 py-3 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, index) => (
              <tr key={String(row.id ?? index)} className="hover:bg-slate-50/70">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-slate-700 ${column.align === "right" ? "text-right" : "text-left"}`}>
                    {column.format ? column.format(row[column.key], row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">{emptyText}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-950">{icon}{title}</CardTitle>
        <p className="text-sm leading-6 text-slate-500">{subtitle}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ProcessPnlConfigurationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const [processFilter, setProcessFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const legacy = usePnlConfiguration(period, processFilter || undefined);
  const bpo = useBpoPnlConfiguration(period, processFilter || undefined, branchFilter || undefined);
  const references = legacy.referenceQuery.data;
  const processes = references?.processes ?? [];
  const branches = references?.branches ?? [];

  const processName = useMemo(
    () => new Map(processes.map((process) => [process.id, process.process_name])),
    [processes]
  );
  const branchName = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.branch_name])),
    [branches]
  );

  const [ruleForm, setRuleForm] = useState<RevenueRulePayload>({
    processId: "",
    contractId: null,
    ruleName: "",
    billingModel: "per_seat",
    metricKey: "billable_seats",
    rateAmount: 0,
    currencyCode: "INR",
    fxToInr: 1,
    monthlyMinimumCommitment: 0,
    includedUnits: 0,
    overageRate: 0,
    mandatedSeats: 0,
    qualityGatePct: null,
    slaGatePct: null,
    effectiveFrom: firstDay(period),
    effectiveTo: null,
    status: "approved",
    approvalReference: "",
  });
  const [deliveryForm, setDeliveryForm] = useState<DeliveryActualPayload>({
    processId: "",
    periodCode: period,
    activityDate: today(),
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
    sourceReference: "monthly-finance-upload",
    status: "validated",
  });
  const [revenueForm, setRevenueForm] = useState<RevenueComponentPayload>({
    processId: "",
    periodCode: period,
    componentType: "incentive",
    direction: "increase",
    description: "",
    amountInr: 0,
    recognitionDate: today(),
    status: "approved",
  });
  const [costForm, setCostForm] = useState<CostComponentPayload>({
    processId: null,
    branchId: null,
    periodCode: period,
    costType: "depreciation",
    description: "",
    amountInr: 0,
    allocationDriver: "direct",
    manualAllocationPct: null,
    status: "approved",
  });
  const [allocationForm, setAllocationForm] = useState<AllocationPolicyPayload>({
    branchId: "",
    processId: null,
    poolType: "bmc_people",
    allocationDriver: "active_hc",
    manualAllocationPct: null,
    effectiveFrom: firstDay(period),
    effectiveTo: null,
    status: "approved",
  });
  const [classificationForm, setClassificationForm] = useState<ClassificationRulePayload>({
    ruleName: "",
    scopeType: "designation",
    scopeKey: "",
    processId: null,
    branchId: null,
    pnlBucket: "agent_salary",
    priority: 100,
    effectiveFrom: firstDay(period),
    effectiveTo: null,
    activeStatus: true,
  });

  const [contractForm, setContractForm] = useState<SaveContractPayload>({
    process_id: "",
    client_id: "",
    contract_name: "",
    billing_type: "per_seat",
    billing_rate: 0,
    currency: "INR",
    monthly_minimum_commitment: 0,
    effective_from: firstDay(period),
    status: "active",
  });
  const [rateForm, setRateForm] = useState<SaveRatePayload>({
    process_id: "",
    contract_id: "",
    rate_type: "seat_rate",
    rate_amount: 0,
    unit: "seat",
    effective_from: firstDay(period),
    approval_reference: "",
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

  async function saveWithToast(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save configuration.");
    }
  }

  const updatePeriod = (nextPeriod: string) => {
    setSearchParams({ period: nextPeriod });
    setDeliveryForm((current) => ({ ...current, periodCode: nextPeriod }));
    setRevenueForm((current) => ({ ...current, periodCode: nextPeriod }));
    setCostForm((current) => ({ ...current, periodCode: nextPeriod }));
    setPlanForm((current) => ({ ...current, period_code: nextPeriod }));
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_22%),linear-gradient(180deg,_#f7fbff_0%,_#ffffff_40%,_#f4f7f6_100%)]">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="grid gap-8 p-6 xl:grid-cols-[1.35fr_0.65fr] xl:p-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
                  <Settings2 className="h-3.5 w-3.5" /> BPO P&amp;L Controls
                </div>
                <div>
                  <h1 className="max-w-4xl text-3xl font-black tracking-tight sm:text-4xl">
                    Configure every commercial and cost driver that determines process profitability.
                  </h1>
                  <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 sm:text-base">
                    Maintain hybrid billing rules, delivery actuals, quality and SLA gates, revenue additions or deductions, Agent/DSC/BMC classification, shared-cost allocation, monthly budgets and finance adjustments.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="bg-sky-400 text-slate-950 hover:bg-sky-300">
                    <Link to={`/finance/process-pnl?period=${period}`}>Open command centre</Link>
                  </Button>
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                    <Link to={`/finance/process-pnl/period-close?period=${period}`}>Period close &amp; sign-off</Link>
                  </Button>
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                    <Link to={`/finance/branch-budget?period=${period}`}>Branch budget control</Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Revenue rules</p><p className="mt-2 text-3xl font-black">{bpo.revenueRulesQuery.data?.length ?? 0}</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Delivery records</p><p className="mt-2 text-3xl font-black">{bpo.deliveryActualsQuery.data?.length ?? 0}</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Allocation policies</p><p className="mt-2 text-3xl font-black">{bpo.allocationPoliciesQuery.data?.length ?? 0}</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-5"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Classification rules</p><p className="mt-2 text-3xl font-black">{bpo.classificationRulesQuery.data?.length ?? 0}</p></CardContent></Card>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <SlidersHorizontal className="h-4 w-4" /> Configuration scope
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Period" htmlFor="pnl-config-period">
                <Input id="pnl-config-period" type="month" value={period} onChange={(event) => updatePeriod(event.target.value)} />
              </Field>
              <Field label="Process filter" htmlFor="pnl-config-process">
                <ProcessSelect id="pnl-config-process" value={processFilter} onChange={setProcessFilter} processes={processes} allowBlank />
              </Field>
              <Field label="Branch filter" htmlFor="pnl-config-branch">
                <BranchSelect id="pnl-config-branch" value={branchFilter} onChange={setBranchFilter} branches={branches} allowBlank />
              </Field>
            </div>
          </section>

          <Tabs defaultValue="revenue-rules" className="space-y-5">
            <TabsList className="h-auto flex-wrap justify-start rounded-2xl bg-white p-1 shadow-sm">
              <TabsTrigger value="revenue-rules">Revenue rules</TabsTrigger>
              <TabsTrigger value="delivery">Delivery actuals</TabsTrigger>
              <TabsTrigger value="revenue-components">Revenue additions/deductions</TabsTrigger>
              <TabsTrigger value="cost-components">EBITDA cost components</TabsTrigger>
              <TabsTrigger value="allocation">BMC allocation</TabsTrigger>
              <TabsTrigger value="classification">Agent / DSC / BMC classification</TabsTrigger>
              <TabsTrigger value="contracts">Contracts &amp; rates</TabsTrigger>
              <TabsTrigger value="plans">Plans &amp; adjustments</TabsTrigger>
            </TabsList>

            <TabsContent value="revenue-rules" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <WorkspaceCard title="Add commercial revenue rule" subtitle="A process may have multiple active rules for hybrid billing, such as seats plus transactions or a fixed fee plus outcome incentive." icon={<CircleDollarSign className="h-4 w-4 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="rule-process" value={ruleForm.processId} onChange={(value) => setRuleForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <Field label="Rule name"><Input value={ruleForm.ruleName} onChange={(event) => setRuleForm((current) => ({ ...current, ruleName: event.target.value }))} placeholder="Primary seat billing" /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Billing model">
                        <select className={selectClass} value={ruleForm.billingModel} onChange={(event) => setRuleForm((current) => ({ ...current, billingModel: event.target.value }))}>
                          <option value="per_seat">Per seat</option><option value="per_fte">Per FTE</option><option value="per_productive_hour">Per productive hour</option><option value="per_login_hour">Per login hour</option><option value="per_talk_minute">Per talk minute</option><option value="per_transaction">Per transaction</option><option value="per_mandate">Per mandate</option><option value="per_case">Per case</option><option value="fixed_monthly">Fixed monthly</option><option value="outcome_based">Outcome based</option>
                        </select>
                      </Field>
                      <Field label="Metric key"><Input value={ruleForm.metricKey} onChange={(event) => setRuleForm((current) => ({ ...current, metricKey: event.target.value }))} placeholder="transactions" /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Rate"><Input type="number" value={ruleForm.rateAmount} onChange={(event) => setRuleForm((current) => ({ ...current, rateAmount: numeric(event.target.value) }))} /></Field>
                      <Field label="Currency"><Input value={ruleForm.currencyCode ?? "INR"} onChange={(event) => setRuleForm((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} /></Field>
                      <Field label="FX to INR"><Input type="number" step="0.0001" value={ruleForm.fxToInr ?? 1} onChange={(event) => setRuleForm((current) => ({ ...current, fxToInr: numeric(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Monthly minimum"><Input type="number" value={ruleForm.monthlyMinimumCommitment ?? 0} onChange={(event) => setRuleForm((current) => ({ ...current, monthlyMinimumCommitment: numeric(event.target.value) }))} /></Field>
                      <Field label="Included units"><Input type="number" value={ruleForm.includedUnits ?? 0} onChange={(event) => setRuleForm((current) => ({ ...current, includedUnits: numeric(event.target.value) }))} /></Field>
                      <Field label="Overage rate"><Input type="number" value={ruleForm.overageRate ?? 0} onChange={(event) => setRuleForm((current) => ({ ...current, overageRate: numeric(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Mandated seats"><Input type="number" value={ruleForm.mandatedSeats ?? 0} onChange={(event) => setRuleForm((current) => ({ ...current, mandatedSeats: numeric(event.target.value) }))} /></Field>
                      <Field label="Quality gate %"><Input type="number" step="0.01" value={ruleForm.qualityGatePct ?? ""} onChange={(event) => setRuleForm((current) => ({ ...current, qualityGatePct: event.target.value ? numeric(event.target.value) : null }))} /></Field>
                      <Field label="SLA gate %"><Input type="number" step="0.01" value={ruleForm.slaGatePct ?? ""} onChange={(event) => setRuleForm((current) => ({ ...current, slaGatePct: event.target.value ? numeric(event.target.value) : null }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Effective from"><Input type="date" value={ruleForm.effectiveFrom} onChange={(event) => setRuleForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
                      <Field label="Approval reference"><Input value={ruleForm.approvalReference ?? ""} onChange={(event) => setRuleForm((current) => ({ ...current, approvalReference: event.target.value }))} placeholder="MSA / client email / approval ID" /></Field>
                    </div>
                    <Button disabled={!ruleForm.processId || !ruleForm.ruleName || !ruleForm.metricKey || bpo.saveRevenueRule.isPending} onClick={() => saveWithToast(() => bpo.saveRevenueRule.mutateAsync(ruleForm as RevenueRulePayload & Record<string, unknown>), "Revenue rule saved.")}>{bpo.saveRevenueRule.isPending ? "Saving..." : "Save revenue rule"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Approved revenue rules" subtitle="These rules drive earned revenue and can be combined for hybrid commercial models." icon={<ShieldCheck className="h-4 w-4 text-sky-600" />}>
                  {bpo.revenueRulesQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No BPO revenue rule is configured for the selected scope." rows={bpo.revenueRulesQuery.data ?? []} columns={[
                      { key: "process_id", label: "Process", format: (value) => processName.get(String(value)) ?? String(value) },
                      { key: "rule_name", label: "Rule" },
                      { key: "billing_model", label: "Model", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "metric_key", label: "Metric" },
                      { key: "rate_amount", label: "Rate", align: "right", format: (value) => currency(Number(value)) },
                      { key: "monthly_minimum_commitment", label: "Minimum", align: "right", format: (value) => currency(Number(value)) },
                      { key: "status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="delivery" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <WorkspaceCard title="Record validated delivery" subtitle="Capture the commercial output that is billable: seats, FTE, hours, talk minutes, transactions, mandates, cases or outcomes." icon={<FileSpreadsheet className="h-4 w-4 text-sky-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="delivery-process" value={deliveryForm.processId} onChange={(value) => setDeliveryForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Period"><Input type="month" value={deliveryForm.periodCode} onChange={(event) => setDeliveryForm((current) => ({ ...current, periodCode: event.target.value }))} /></Field>
                      <Field label="Activity date"><Input type="date" value={deliveryForm.activityDate ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, activityDate: event.target.value }))} /></Field>
                      <Field label="Metric key"><Input value={deliveryForm.metricKey} onChange={(event) => setDeliveryForm((current) => ({ ...current, metricKey: event.target.value }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-5">
                      <Field label="Planned"><Input type="number" value={deliveryForm.plannedUnits ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, plannedUnits: numeric(event.target.value) }))} /></Field>
                      <Field label="Delivered"><Input type="number" value={deliveryForm.deliveredUnits ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveredUnits: numeric(event.target.value) }))} /></Field>
                      <Field label="Accepted"><Input type="number" value={deliveryForm.acceptedUnits ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, acceptedUnits: numeric(event.target.value) }))} /></Field>
                      <Field label="Rejected"><Input type="number" value={deliveryForm.rejectedUnits ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, rejectedUnits: numeric(event.target.value) }))} /></Field>
                      <Field label="Billable"><Input type="number" value={deliveryForm.billableUnits ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, billableUnits: numeric(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Productive hours"><Input type="number" step="0.01" value={deliveryForm.productiveHours ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, productiveHours: numeric(event.target.value) }))} /></Field>
                      <Field label="Login hours"><Input type="number" step="0.01" value={deliveryForm.loginHours ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, loginHours: numeric(event.target.value) }))} /></Field>
                      <Field label="Talk minutes"><Input type="number" step="0.01" value={deliveryForm.talkMinutes ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, talkMinutes: numeric(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <Field label="Quality score %"><Input type="number" step="0.01" value={deliveryForm.qualityScore ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, qualityScore: event.target.value ? numeric(event.target.value) : null }))} /></Field>
                      <Field label="SLA score %"><Input type="number" step="0.01" value={deliveryForm.slaScore ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, slaScore: event.target.value ? numeric(event.target.value) : null }))} /></Field>
                      <Field label="Data source"><Input value={deliveryForm.dataSource ?? "manual"} onChange={(event) => setDeliveryForm((current) => ({ ...current, dataSource: event.target.value }))} /></Field>
                      <Field label="Source reference"><Input value={deliveryForm.sourceReference ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, sourceReference: event.target.value }))} /></Field>
                    </div>
                    <Button disabled={!deliveryForm.processId || !deliveryForm.metricKey || bpo.saveDeliveryActual.isPending} onClick={() => saveWithToast(() => bpo.saveDeliveryActual.mutateAsync(deliveryForm as DeliveryActualPayload & Record<string, unknown>), "Delivery actual saved and P&L refreshed.")}>{bpo.saveDeliveryActual.isPending ? "Saving..." : "Save validated delivery"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Delivery register" subtitle="Validated and locked delivery records are aggregated into the selected process P&L." icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}>
                  {bpo.deliveryActualsQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No delivery actual is available for the selected period." rows={bpo.deliveryActualsQuery.data ?? []} columns={[
                      { key: "process_id", label: "Process", format: (value) => processName.get(String(value)) ?? String(value) },
                      { key: "metric_key", label: "Metric" },
                      { key: "planned_units", label: "Plan", align: "right" },
                      { key: "delivered_units", label: "Delivered", align: "right" },
                      { key: "billable_units", label: "Billable", align: "right" },
                      { key: "quality_score", label: "Quality", align: "right", format: (value) => value == null ? "-" : `${Number(value).toFixed(2)}%` },
                      { key: "sla_score", label: "SLA", align: "right", format: (value) => value == null ? "-" : `${Number(value).toFixed(2)}%` },
                      { key: "status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="revenue-components" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="Add revenue component" subtitle="Record incentives, rewards, SLA deductions, penalties, credit notes, FX adjustments, ramp-up revenue or one-time commercial items." icon={<Banknote className="h-4 w-4 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="revenue-component-process" value={revenueForm.processId} onChange={(value) => setRevenueForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Component type">
                        <select className={selectClass} value={revenueForm.componentType} onChange={(event) => setRevenueForm((current) => ({ ...current, componentType: event.target.value }))}>
                          <option value="incentive">Incentive</option><option value="reward">Reward</option><option value="penalty">Penalty</option><option value="sla_deduction">SLA deduction</option><option value="credit_note">Credit note</option><option value="rate_true_up">Rate true-up</option><option value="fx_adjustment">FX adjustment</option><option value="ramp_up">Ramp-up</option><option value="training_revenue">Training revenue</option><option value="one_time">One-time</option><option value="other">Other</option>
                        </select>
                      </Field>
                      <Field label="Direction"><select className={selectClass} value={revenueForm.direction} onChange={(event) => setRevenueForm((current) => ({ ...current, direction: event.target.value as "increase" | "decrease" }))}><option value="increase">Increase revenue</option><option value="decrease">Decrease revenue</option></select></Field>
                    </div>
                    <Field label="Description"><Textarea rows={3} value={revenueForm.description} onChange={(event) => setRevenueForm((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Amount INR"><Input type="number" value={revenueForm.amountInr} onChange={(event) => setRevenueForm((current) => ({ ...current, amountInr: numeric(event.target.value) }))} /></Field>
                      <Field label="Recognition date"><Input type="date" value={revenueForm.recognitionDate ?? ""} onChange={(event) => setRevenueForm((current) => ({ ...current, recognitionDate: event.target.value }))} /></Field>
                      <Field label="Invoice reference"><Input value={revenueForm.invoiceReference ?? ""} onChange={(event) => setRevenueForm((current) => ({ ...current, invoiceReference: event.target.value }))} /></Field>
                    </div>
                    <Button disabled={!revenueForm.processId || !revenueForm.description || bpo.saveRevenueComponent.isPending} onClick={() => saveWithToast(() => bpo.saveRevenueComponent.mutateAsync(revenueForm as RevenueComponentPayload & Record<string, unknown>), "Revenue component saved.")}>{bpo.saveRevenueComponent.isPending ? "Saving..." : "Save revenue component"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Revenue component register" subtitle="Only approved, non-reversed items affect earned revenue." icon={<BadgeIndianRupee className="h-4 w-4 text-violet-600" />}>
                  {bpo.revenueComponentsQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No revenue addition or deduction is recorded for the selected period." rows={bpo.revenueComponentsQuery.data ?? []} columns={[
                      { key: "process_id", label: "Process", format: (value) => processName.get(String(value)) ?? String(value) },
                      { key: "component_type", label: "Type", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "direction", label: "Direction" },
                      { key: "description", label: "Description" },
                      { key: "amount_inr", label: "Amount", align: "right", format: (value, row) => `${row.direction === "decrease" ? "-" : "+"}${currency(Number(value))}` },
                      { key: "status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="cost-components" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="Add EBITDA-to-PAT cost component" subtitle="Use for depreciation, amortization, finance cost, tax, exceptional items, or operating costs not already captured through payroll, expenses, GRNs or vendor payments." icon={<Calculator className="h-4 w-4 text-violet-600" />}>
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Process"><ProcessSelect id="cost-component-process" value={costForm.processId} onChange={(value) => setCostForm((current) => ({ ...current, processId: value || null }))} processes={processes} allowBlank /></Field>
                      <Field label="Branch"><BranchSelect id="cost-component-branch" value={costForm.branchId} onChange={(value) => setCostForm((current) => ({ ...current, branchId: value || null }))} branches={branches} allowBlank /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Cost type"><select className={selectClass} value={costForm.costType} onChange={(event) => setCostForm((current) => ({ ...current, costType: event.target.value }))}><option value="depreciation">Depreciation</option><option value="amortization">Amortization</option><option value="finance_cost">Finance cost</option><option value="tax">Tax</option><option value="other_operating_cost">Other operating cost</option><option value="other_operating_income">Other operating income</option><option value="non_operating_income">Non-operating income</option><option value="exceptional_cost">Exceptional cost</option><option value="exceptional_income">Exceptional income</option></select></Field>
                      <Field label="Allocation driver"><select className={selectClass} value={costForm.allocationDriver} onChange={(event) => setCostForm((current) => ({ ...current, allocationDriver: event.target.value }))}><option value="direct">Direct</option><option value="active_hc">Active HC</option><option value="billable_hc">Billable HC</option><option value="contracted_seats">Contracted seats</option><option value="revenue">Revenue</option><option value="equal">Equal</option><option value="manual">Manual</option></select></Field>
                    </div>
                    <Field label="Description"><Textarea rows={3} value={costForm.description} onChange={(event) => setCostForm((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Amount INR"><Input type="number" value={costForm.amountInr} onChange={(event) => setCostForm((current) => ({ ...current, amountInr: numeric(event.target.value) }))} /></Field>
                      <Field label="Source reference"><Input value={costForm.sourceReference ?? ""} onChange={(event) => setCostForm((current) => ({ ...current, sourceReference: event.target.value }))} /></Field>
                    </div>
                    <Button disabled={(!costForm.processId && !costForm.branchId) || !costForm.description || bpo.saveCostComponent.isPending} onClick={() => saveWithToast(() => bpo.saveCostComponent.mutateAsync(costForm as CostComponentPayload & Record<string, unknown>), "Cost component saved.")}>{bpo.saveCostComponent.isPending ? "Saving..." : "Save cost component"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Cost component register" subtitle="Process costs apply directly; branch pools are allocated using the approved policy." icon={<Gauge className="h-4 w-4 text-amber-600" />}>
                  {bpo.costComponentsQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No additional EBITDA, EBIT, PBT or PAT component is recorded." rows={bpo.costComponentsQuery.data ?? []} columns={[
                      { key: "process_id", label: "Process", format: (value) => value ? processName.get(String(value)) ?? String(value) : "Shared" },
                      { key: "branch_id", label: "Branch", format: (value) => value ? branchName.get(String(value)) ?? String(value) : "-" },
                      { key: "cost_type", label: "Type", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "description", label: "Description" },
                      { key: "amount_inr", label: "Amount", align: "right", format: (value) => currency(Number(value)) },
                      { key: "allocation_driver", label: "Driver", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="allocation" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <WorkspaceCard title="BMC and shared-service allocation policy" subtitle="Define how branch-shared HR, IT, Admin, Finance, Facilities and other pools are allocated across processes." icon={<Building2 className="h-4 w-4 text-indigo-600" />}>
                  <div className="grid gap-4">
                    <Field label="Branch"><BranchSelect id="allocation-branch" value={allocationForm.branchId} onChange={(value) => setAllocationForm((current) => ({ ...current, branchId: value }))} branches={branches} /></Field>
                    <Field label="Process override"><ProcessSelect id="allocation-process" value={allocationForm.processId} onChange={(value) => setAllocationForm((current) => ({ ...current, processId: value || null }))} processes={processes.filter((process) => !allocationForm.branchId || process.branch_id === allocationForm.branchId)} allowBlank /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Pool type"><select className={selectClass} value={allocationForm.poolType} onChange={(event) => setAllocationForm((current) => ({ ...current, poolType: event.target.value }))}><option value="bmc_people">BMC people</option><option value="bmc_non_people">BMC non-people</option><option value="shared_service">Shared service</option><option value="corporate_overhead">Corporate overhead</option></select></Field>
                      <Field label="Allocation driver"><select className={selectClass} value={allocationForm.allocationDriver} onChange={(event) => setAllocationForm((current) => ({ ...current, allocationDriver: event.target.value }))}><option value="active_hc">Active HC</option><option value="billable_hc">Billable HC</option><option value="contracted_seats">Contracted seats</option><option value="revenue">Revenue</option><option value="floor_area">Floor area</option><option value="device_count">Device count</option><option value="equal">Equal</option><option value="manual">Manual percentage</option></select></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Manual allocation %"><Input type="number" step="0.01" value={allocationForm.manualAllocationPct ?? ""} onChange={(event) => setAllocationForm((current) => ({ ...current, manualAllocationPct: event.target.value ? numeric(event.target.value) : null }))} /></Field>
                      <Field label="Effective from"><Input type="date" value={allocationForm.effectiveFrom} onChange={(event) => setAllocationForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
                    </div>
                    <Button disabled={!allocationForm.branchId || bpo.saveAllocationPolicy.isPending} onClick={() => saveWithToast(() => bpo.saveAllocationPolicy.mutateAsync(allocationForm as AllocationPolicyPayload & Record<string, unknown>), "Allocation policy saved.")}>{bpo.saveAllocationPolicy.isPending ? "Saving..." : "Save allocation policy"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Approved allocation policies" subtitle="Process-specific manual policies override the branch default for the same cost pool." icon={<SlidersHorizontal className="h-4 w-4 text-sky-600" />}>
                  {bpo.allocationPoliciesQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No allocation policy is configured for the selected branch." rows={bpo.allocationPoliciesQuery.data ?? []} columns={[
                      { key: "branch_id", label: "Branch", format: (value) => branchName.get(String(value)) ?? String(value) },
                      { key: "process_id", label: "Process", format: (value) => value ? processName.get(String(value)) ?? String(value) : "Branch default" },
                      { key: "pool_type", label: "Pool", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "allocation_driver", label: "Driver", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "manual_allocation_pct", label: "Manual %", align: "right", format: (value) => value == null ? "-" : `${Number(value).toFixed(2)}%` },
                      { key: "status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="classification" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <WorkspaceCard title="Agent / DSC / BMC classification rule" subtitle="Map employees, designations, departments, cost centres or expense heads into the correct BPO P&L bucket. Lower priority numbers are applied first." icon={<UsersRound className="h-4 w-4 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Rule name"><Input value={classificationForm.ruleName} onChange={(event) => setClassificationForm((current) => ({ ...current, ruleName: event.target.value }))} placeholder="Operations executives as Agent Salary" /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Scope type"><select className={selectClass} value={classificationForm.scopeType} onChange={(event) => setClassificationForm((current) => ({ ...current, scopeType: event.target.value }))}><option value="employee">Employee ID/code</option><option value="designation">Designation ID/name</option><option value="department">Department ID/name</option><option value="cost_centre">Cost centre</option><option value="expense_head">Expense head</option><option value="expense_sub_head">Expense sub-head</option></select></Field>
                      <Field label="Exact scope key" hint="Enter the exact ID, code or name stored in HRMS."><Input value={classificationForm.scopeKey} onChange={(event) => setClassificationForm((current) => ({ ...current, scopeKey: event.target.value }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Process"><ProcessSelect id="classification-process" value={classificationForm.processId} onChange={(value) => setClassificationForm((current) => ({ ...current, processId: value || null }))} processes={processes} allowBlank /></Field>
                      <Field label="Branch"><BranchSelect id="classification-branch" value={classificationForm.branchId} onChange={(value) => setClassificationForm((current) => ({ ...current, branchId: value || null }))} branches={branches} allowBlank /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="P&L bucket"><select className={selectClass} value={classificationForm.pnlBucket} onChange={(event) => setClassificationForm((current) => ({ ...current, pnlBucket: event.target.value }))}><option value="agent_salary">Agent Salary</option><option value="dsc_people">DSC people</option><option value="dsc_non_people">DSC non-people</option><option value="bmc_people">BMC people</option><option value="bmc_non_people">BMC non-people</option><option value="depreciation">Depreciation</option><option value="amortization">Amortization</option><option value="finance_cost">Finance cost</option><option value="tax">Tax</option><option value="capex">Capex</option><option value="excluded">Excluded</option></select></Field>
                      <Field label="Priority"><Input type="number" value={classificationForm.priority ?? 100} onChange={(event) => setClassificationForm((current) => ({ ...current, priority: numeric(event.target.value) }))} /></Field>
                      <Field label="Effective from"><Input type="date" value={classificationForm.effectiveFrom} onChange={(event) => setClassificationForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field>
                    </div>
                    <Button disabled={!classificationForm.ruleName || !classificationForm.scopeKey || bpo.saveClassificationRule.isPending} onClick={() => saveWithToast(() => bpo.saveClassificationRule.mutateAsync(classificationForm as ClassificationRulePayload & Record<string, unknown>), "Classification rule saved.")}>{bpo.saveClassificationRule.isPending ? "Saving..." : "Save classification rule"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Classification rule register" subtitle="Configured rules override the default operational/support role classifier." icon={<ShieldCheck className="h-4 w-4 text-violet-600" />}>
                  {bpo.classificationRulesQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No explicit classification rule is configured; HRMS will use the default BPO role classifier." rows={bpo.classificationRulesQuery.data ?? []} columns={[
                      { key: "rule_name", label: "Rule" },
                      { key: "scope_type", label: "Scope" },
                      { key: "scope_key", label: "Key" },
                      { key: "process_id", label: "Process", format: (value) => value ? processName.get(String(value)) ?? String(value) : "All" },
                      { key: "branch_id", label: "Branch", format: (value) => value ? branchName.get(String(value)) ?? String(value) : "All" },
                      { key: "pnl_bucket", label: "Bucket", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "priority", label: "Priority", align: "right" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="contracts" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-3">
                <WorkspaceCard title="Client contract" subtitle="Maintain the master commercial agreement used by invoices and fallback revenue calculations." icon={<BriefcaseBusiness className="h-4 w-4 text-sky-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="contract-process" value={contractForm.process_id} onChange={(value) => { const selected = processes.find((item) => item.id === value); setContractForm((current) => ({ ...current, process_id: value, client_id: selected?.client_id ?? null })); }} processes={processes} /></Field>
                    <Field label="Contract name"><Input value={contractForm.contract_name} onChange={(event) => setContractForm((current) => ({ ...current, contract_name: event.target.value }))} /></Field>
                    <Field label="Billing type"><select className={selectClass} value={contractForm.billing_type} onChange={(event) => setContractForm((current) => ({ ...current, billing_type: event.target.value }))}><option value="per_seat">Per seat</option><option value="per_hour">Per hour</option><option value="per_transaction">Per transaction</option><option value="fixed_monthly">Fixed monthly</option><option value="hybrid">Hybrid</option></select></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Billing rate"><Input type="number" value={contractForm.billing_rate ?? 0} onChange={(event) => setContractForm((current) => ({ ...current, billing_rate: numeric(event.target.value) }))} /></Field><Field label="Monthly minimum"><Input type="number" value={contractForm.monthly_minimum_commitment ?? 0} onChange={(event) => setContractForm((current) => ({ ...current, monthly_minimum_commitment: numeric(event.target.value) }))} /></Field></div>
                    <Field label="Effective from"><Input type="date" value={contractForm.effective_from ?? firstDay(period)} onChange={(event) => setContractForm((current) => ({ ...current, effective_from: event.target.value }))} /></Field>
                    <Button disabled={!contractForm.process_id || !contractForm.contract_name || legacy.saveContract.isPending} onClick={() => saveWithToast(() => legacy.saveContract.mutateAsync(contractForm), "Contract saved.")}>{legacy.saveContract.isPending ? "Saving..." : "Save contract"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Approved rate card" subtitle="The most specific approved rate takes precedence over the contract fallback." icon={<BadgeIndianRupee className="h-4 w-4 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="rate-process" value={rateForm.process_id} onChange={(value) => setRateForm((current) => ({ ...current, process_id: value }))} processes={processes} /></Field>
                    <Field label="Contract"><select className={selectClass} value={rateForm.contract_id ?? ""} onChange={(event) => setRateForm((current) => ({ ...current, contract_id: event.target.value || null }))}><option value="">No contract reference</option>{(legacy.contractsQuery.data ?? []).filter((contract) => !rateForm.process_id || contract.process_id === rateForm.process_id).map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_name}</option>)}</select></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Rate type"><Input value={rateForm.rate_type} onChange={(event) => setRateForm((current) => ({ ...current, rate_type: event.target.value }))} /></Field><Field label="Unit"><Input value={rateForm.unit ?? ""} onChange={(event) => setRateForm((current) => ({ ...current, unit: event.target.value }))} /></Field></div>
                    <Field label="Rate amount"><Input type="number" value={rateForm.rate_amount} onChange={(event) => setRateForm((current) => ({ ...current, rate_amount: numeric(event.target.value) }))} /></Field>
                    <Field label="Approval reference"><Input value={rateForm.approval_reference ?? ""} onChange={(event) => setRateForm((current) => ({ ...current, approval_reference: event.target.value }))} /></Field>
                    <Field label="Effective from"><Input type="date" value={rateForm.effective_from} onChange={(event) => setRateForm((current) => ({ ...current, effective_from: event.target.value }))} /></Field>
                    <Button disabled={!rateForm.process_id || !rateForm.rate_type || legacy.saveRate.isPending} onClick={() => saveWithToast(() => legacy.saveRate.mutateAsync(rateForm), "Rate card saved.")}>{legacy.saveRate.isPending ? "Saving..." : "Save rate"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Commercial master status" subtitle="Review the master records that support BPO rules, invoice recognition and fallback calculations." icon={<CircleDollarSign className="h-4 w-4 text-violet-600" />}>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-500">Contracts</p><p className="mt-2 text-3xl font-black text-slate-950">{legacy.contractsQuery.data?.length ?? 0}</p></div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.14em] text-slate-500">Rate cards</p><p className="mt-2 text-3xl font-black text-slate-950">{legacy.ratesQuery.data?.length ?? 0}</p></div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">Use Revenue Rules for complex or hybrid billing. Contract and rate-card records remain the accounting fallback and invoice master.</div>
                  </div>
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="plans" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <WorkspaceCard title="Monthly process plan and budget" subtitle="Lock the mandate, workforce requirement, revenue plan, direct cost, indirect cost and profit target for variance reporting." icon={<Gauge className="h-4 w-4 text-sky-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect id="plan-process" value={planForm.process_id} onChange={(value) => setPlanForm((current) => ({ ...current, process_id: value }))} processes={processes} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Period"><Input type="month" value={planForm.period_code} onChange={(event) => setPlanForm((current) => ({ ...current, period_code: event.target.value }))} /></Field><Field label="Status"><select className={selectClass} value={planForm.status} onChange={(event) => setPlanForm((current) => ({ ...current, status: event.target.value }))}><option value="draft">Draft</option><option value="approved">Approved</option><option value="locked">Locked</option></select></Field></div>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Contracted seats"><Input type="number" value={planForm.contracted_seats ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, contracted_seats: numeric(event.target.value) }))} /></Field><Field label="Productive HC"><Input type="number" value={planForm.required_productive_hc ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, required_productive_hc: numeric(event.target.value) }))} /></Field><Field label="Roster HC"><Input type="number" value={planForm.required_roster_hc ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, required_roster_hc: numeric(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Shrinkage %"><Input type="number" value={planForm.planned_shrinkage_pct ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, planned_shrinkage_pct: numeric(event.target.value) }))} /></Field><Field label="Buffer %"><Input type="number" value={planForm.buffer_target_pct ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, buffer_target_pct: numeric(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Revenue budget"><Input type="number" value={planForm.revenue_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, revenue_budget: numeric(event.target.value) }))} /></Field><Field label="Direct cost budget"><Input type="number" value={planForm.direct_cost_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, direct_cost_budget: numeric(event.target.value) }))} /></Field><Field label="Indirect cost budget"><Input type="number" value={planForm.indirect_cost_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, indirect_cost_budget: numeric(event.target.value) }))} /></Field><Field label="Profit budget"><Input type="number" value={planForm.profit_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, profit_budget: numeric(event.target.value) }))} /></Field></div>
                    <Button disabled={!planForm.process_id || legacy.saveMonthlyPlan.isPending} onClick={() => saveWithToast(() => legacy.saveMonthlyPlan.mutateAsync(planForm), "Monthly plan saved.")}>{legacy.saveMonthlyPlan.isPending ? "Saving..." : "Save monthly plan"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Finance adjustment journal" subtitle="Approved journals are auditable overlays; source payroll, invoices, expenses and GRN records remain unchanged." icon={<ShieldCheck className="h-4 w-4 text-violet-600" />}>
                  <div className="mb-4 flex justify-end">
                    <PnlAdjustmentDrawer referenceData={references} defaultPeriod={period} onSubmit={async (payload) => { await legacy.createAdjustment.mutateAsync(payload); toast.success("Adjustment submitted."); }} />
                  </div>
                  {legacy.adjustmentsQuery.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : (
                    <DataTable emptyText="No finance adjustment is recorded for the selected scope." rows={legacy.adjustmentsQuery.data ?? []} columns={[
                      { key: "process_id", label: "Process", format: (value) => processName.get(String(value)) ?? String(value) },
                      { key: "metric_key", label: "Metric", format: (value) => String(value).replaceAll("_", " ") },
                      { key: "adjustment_amount", label: "Adjustment", align: "right", format: (value) => currency(Number(value)) },
                      { key: "revised_value", label: "Revised value", align: "right", format: (value) => currency(Number(value)) },
                      { key: "reason", label: "Reason" },
                      { key: "approval_status", label: "Status" },
                    ]} />
                  )}
                </WorkspaceCard>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
