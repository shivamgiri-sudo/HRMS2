import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Building2,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Database,
  FileClock,
  FileSpreadsheet,
  Gauge,
  GitCompareArrows,
  Landmark,
  LockKeyhole,
  Network,
  ReceiptIndianRupee,
  RefreshCw,
  Scale,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UsersRound,
  Workflow,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useBpoPnlConfiguration,
  type AllocationPolicyPayload,
  type ClassificationRulePayload,
  type CostComponentPayload,
  type DeliveryActualPayload,
  type RevenueComponentPayload,
  type RevenueRulePayload,
} from "@/hooks/useBpoPnlConfiguration";
import {
  usePnlConfiguration,
  type SaveContractPayload,
  type SaveMonthlyPlanPayload,
  type SaveRatePayload,
} from "@/hooks/usePnlConfiguration";

type AnyRow = Record<string, any>;

type Column = {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (value: any, row: AnyRow) => ReactNode;
};

const selectClass =
  "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

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
  const parsed = Number(value ?? 0);
  return `${Number.isFinite(parsed) ? parsed.toFixed(1) : "0.0"}%`;
}

function titleCase(value: unknown) {
  return String(value ?? "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ProcessSelect({
  value,
  onChange,
  processes,
  allowBlank = false,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  processes: Array<{ id: string; process_name: string; branch_name?: string | null }>;
  allowBlank?: boolean;
}) {
  return (
    <select className={selectClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">{allowBlank ? "Shared / organisation level" : "Select process"}</option>
      {processes.map((process) => (
        <option key={process.id} value={process.id}>
          {process.process_name}{process.branch_name ? ` — ${process.branch_name}` : ""}
        </option>
      ))}
    </select>
  );
}

function BranchSelect({
  value,
  onChange,
  branches,
  allowBlank = false,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  branches: Array<{ id: string; branch_name: string }>;
  allowBlank?: boolean;
}) {
  return (
    <select className={selectClass} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">{allowBlank ? "Organisation / no single branch" : "Select branch"}</option>
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>{branch.branch_name}</option>
      ))}
    </select>
  );
}

function StatusPill({ value }: { value: unknown }) {
  const status = String(value ?? "unknown").toLowerCase();
  const className = status.includes("approved") || status.includes("active") || status.includes("validated") || status.includes("locked")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status.includes("reject") || status.includes("reverse") || status.includes("inactive")
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${className}`}>{titleCase(status)}</span>;
}

function MasterTable({ columns, rows, emptyText, maxHeight = 420 }: { columns: Column[]; rows: AnyRow[]; emptyText: string; maxHeight?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`whitespace-nowrap px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500 ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, rowIndex) => (
              <tr key={String(row.id ?? `${rowIndex}-${row[columns[0]?.key]}`)} className="transition hover:bg-sky-50/40">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-slate-700 ${column.align === "right" ? "text-right" : "text-left"}`}>
                    {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500">{emptyText}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceCard({ title, subtitle, icon, children, actions }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="overflow-hidden rounded-[26px] border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">{icon}</div>
            <div>
              <CardTitle className="text-base font-black text-slate-950">{title}</CardTitle>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
            </div>
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function MetricCard({ label, value, detail, icon, tone = "sky" }: { label: string; value: ReactNode; detail: string; icon: ReactNode; tone?: "sky" | "emerald" | "amber" | "rose" | "violet" }) {
  const tones = {
    sky: "border-sky-100 bg-sky-50 text-sky-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    violet: "border-violet-100 bg-violet-50 text-violet-700",
  } as const;
  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
            <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
          </div>
          <div className={`rounded-2xl border p-3 ${tones[tone]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthLine({ label, value, detail }: { label: string; value: number; detail: string }) {
  const normalized = Math.max(0, Math.min(100, value));
  const tone = normalized >= 90 ? "bg-emerald-500" : normalized >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">{label}</p>
          <p className="text-xs text-slate-500">{detail}</p>
        </div>
        <span className="text-sm font-black text-slate-950">{normalized.toFixed(0)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

export default function PnlMasterControlCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") ?? currentPeriod();
  const activeTab = searchParams.get("tab") ?? "overview";
  const [processFilter, setProcessFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [impactProcessId, setImpactProcessId] = useState("");
  const [impactRateChange, setImpactRateChange] = useState(5);

  const legacy = usePnlConfiguration(period, processFilter || undefined);
  const bpo = useBpoPnlConfiguration(period, processFilter || undefined, branchFilter || undefined);
  const references = legacy.referenceQuery.data;
  const processes = references?.processes ?? [];
  const branches = references?.branches ?? [];
  const clients = references?.clients ?? [];

  const processName = useMemo(() => new Map(processes.map((process) => [process.id, process.process_name])), [processes]);
  const branchName = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.branch_name])), [branches]);
  const clientName = useMemo(() => new Map(clients.map((client) => [client.id, client.client_name])), [clients]);

  const contracts = legacy.contractsQuery.data ?? [];
  const rates = legacy.ratesQuery.data ?? [];
  const plans = legacy.monthlyPlansQuery.data ?? [];
  const periods = legacy.periodsQuery.data ?? [];
  const adjustments = legacy.adjustmentsQuery.data ?? [];
  const revenueRules = bpo.revenueRulesQuery.data ?? [];
  const deliveryActuals = bpo.deliveryActualsQuery.data ?? [];
  const revenueComponents = bpo.revenueComponentsQuery.data ?? [];
  const costComponents = bpo.costComponentsQuery.data ?? [];
  const allocationPolicies = bpo.allocationPoliciesQuery.data ?? [];
  const classificationRules = bpo.classificationRulesQuery.data ?? [];

  const health = useMemo(() => {
    const total = Math.max(processes.length, 1);
    const mapped = processes.filter((process) => process.client_id && process.branch_id).length;
    const contractProcessIds = new Set(contracts.map((row) => String(row.process_id ?? "")).filter(Boolean));
    const ruleProcessIds = new Set(revenueRules.map((row) => String(row.process_id ?? "")).filter(Boolean));
    const planProcessIds = new Set(plans.map((row) => String(row.process_id ?? "")).filter(Boolean));
    const classificationCoverage = classificationRules.length > 0 ? 100 : 0;
    const mappingPct = (mapped / total) * 100;
    const contractPct = (processes.filter((process) => contractProcessIds.has(process.id)).length / total) * 100;
    const rulePct = (processes.filter((process) => ruleProcessIds.has(process.id)).length / total) * 100;
    const planPct = (processes.filter((process) => planProcessIds.has(process.id)).length / total) * 100;
    const score = Math.round((mappingPct + contractPct + rulePct + planPct + classificationCoverage) / 5);

    const manualGroups = new Map<string, number>();
    allocationPolicies
      .filter((row) => String(row.allocation_driver) === "manual")
      .forEach((row) => {
        const key = `${row.branch_id ?? "org"}|${row.pool_type ?? "unknown"}`;
        manualGroups.set(key, (manualGroups.get(key) ?? 0) + Number(row.manual_allocation_pct ?? 0));
      });
    const allocationIssues = [...manualGroups.entries()].filter(([, totalPct]) => Math.abs(totalPct - 100) > 0.01);

    return {
      score,
      mappingPct,
      contractPct,
      rulePct,
      planPct,
      classificationCoverage,
      unmappedProcesses: processes.filter((process) => !process.client_id || !process.branch_id),
      withoutContract: processes.filter((process) => !contractProcessIds.has(process.id)),
      withoutRule: processes.filter((process) => !ruleProcessIds.has(process.id)),
      withoutPlan: processes.filter((process) => !planProcessIds.has(process.id)),
      allocationIssues,
    };
  }, [allocationPolicies, classificationRules.length, contracts, plans, processes, revenueRules]);

  const impactPreview = useMemo(() => {
    const rules = revenueRules.filter((row) => String(row.process_id) === impactProcessId);
    const currentMonthlyRevenue = rules.reduce((sum, row) => {
      const base = Math.max(Number(row.monthly_minimum_commitment ?? 0), Number(row.rate_amount ?? 0) * Number(row.mandated_seats ?? row.included_units ?? 0));
      return sum + base * Number(row.fx_to_inr ?? 1);
    }, 0);
    const delta = currentMonthlyRevenue * (impactRateChange / 100);
    return { currentMonthlyRevenue, delta, revised: currentMonthlyRevenue + delta, ruleCount: rules.length };
  }, [impactProcessId, impactRateChange, revenueRules]);

  const [revenueRuleForm, setRevenueRuleForm] = useState<RevenueRulePayload>({
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
    sourceReference: "finance-master",
    status: "validated",
  });

  const [revenueComponentForm, setRevenueComponentForm] = useState<RevenueComponentPayload>({
    processId: "",
    periodCode: period,
    componentType: "incentive",
    direction: "increase",
    description: "",
    amountInr: 0,
    recognitionDate: today(),
    invoiceReference: "",
    sourceReference: "finance-master",
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
    sourceReference: "finance-master",
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

  async function saveWithToast(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save P&L master data.");
    }
  }

  function updatePeriod(nextPeriod: string) {
    setSearchParams({ period: nextPeriod, tab: activeTab });
    setDeliveryForm((current) => ({ ...current, periodCode: nextPeriod }));
    setRevenueComponentForm((current) => ({ ...current, periodCode: nextPeriod }));
    setCostForm((current) => ({ ...current, periodCode: nextPeriod }));
    setPlanForm((current) => ({ ...current, period_code: nextPeriod }));
  }

  const loading = legacy.referenceQuery.isLoading || legacy.contractsQuery.isLoading || bpo.revenueRulesQuery.isLoading;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_24%),radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent_20%),linear-gradient(180deg,_#f7fbff_0%,_#ffffff_44%,_#f4f7f6_100%)]">
        <div className="mx-auto max-w-[1700px] space-y-6">
          <section className="overflow-hidden rounded-[34px] border border-slate-800 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
            <div className="relative grid gap-8 p-6 xl:grid-cols-[1.35fr_0.65fr] xl:p-9">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(56,189,248,0.20),transparent_30%),radial-gradient(circle_at_20%_95%,rgba(16,185,129,0.13),transparent_28%)]" />
              <div className="relative space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.24em] text-sky-200">
                  <Settings2 className="h-3.5 w-3.5" /> Finance Governance Workspace
                </div>
                <div>
                  <h1 className="max-w-5xl text-3xl font-black tracking-tight sm:text-5xl">P&amp;L Master &amp; Control Center</h1>
                  <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300 sm:text-base">
                    Govern process mappings, contracts, hybrid billing, delivery evidence, cost classification, shared allocations, monthly plans and financial adjustments from one controlled HRMS workspace.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="rounded-xl bg-sky-400 font-bold text-slate-950 hover:bg-sky-300">
                    <Link to={`/finance/process-pnl?period=${period}`}><BarChart3 className="mr-2 h-4 w-4" />Open P&amp;L command centre</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-xl border-white/15 bg-white/5 font-bold text-white hover:bg-white/10">
                    <Link to={`/finance/process-pnl/period-close?period=${period}`}><LockKeyhole className="mr-2 h-4 w-4" />Period close &amp; sign-off</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-xl border-white/15 bg-white/5 font-bold text-white hover:bg-white/10">
                    <Link to={`/finance/branch-budget?period=${period}`}><Landmark className="mr-2 h-4 w-4" />Branch budget control</Link>
                  </Button>
                </div>
              </div>

              <div className="relative grid gap-4 sm:grid-cols-2">
                <Card className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur"><CardContent className="p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Master health</p><div className="mt-3 flex items-end gap-2"><span className="text-4xl font-black">{health.score}</span><span className="pb-1 text-sm text-slate-400">/100</span></div><p className="mt-2 text-xs text-slate-400">Commercial, mapping, plan and classification coverage</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur"><CardContent className="p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Active processes</p><p className="mt-3 text-4xl font-black">{processes.length}</p><p className="mt-2 text-xs text-slate-400">{health.unmappedProcesses.length} require organisation mapping</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur"><CardContent className="p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Commercial rules</p><p className="mt-3 text-4xl font-black">{revenueRules.length}</p><p className="mt-2 text-xs text-slate-400">Across {new Set(revenueRules.map((row) => row.process_id)).size} configured processes</p></CardContent></Card>
                <Card className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur"><CardContent className="p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Control exceptions</p><p className="mt-3 text-4xl font-black">{health.withoutRule.length + health.allocationIssues.length}</p><p className="mt-2 text-xs text-slate-400">Missing rules and allocation imbalances</p></CardContent></Card>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-700"><SlidersHorizontal className="h-4 w-4" />Master scope</div>
            <div className="grid gap-4 lg:grid-cols-[220px_1fr_1fr_auto]">
              <Field label="Financial period"><Input className="rounded-xl" type="month" value={period} onChange={(event) => updatePeriod(event.target.value)} /></Field>
              <Field label="Process filter"><ProcessSelect value={processFilter} onChange={setProcessFilter} processes={processes} allowBlank /></Field>
              <Field label="Branch filter"><BranchSelect value={branchFilter} onChange={setBranchFilter} branches={branches} allowBlank /></Field>
              <div className="flex items-end"><Button variant="outline" className="w-full rounded-xl" onClick={() => { legacy.referenceQuery.refetch(); legacy.contractsQuery.refetch(); bpo.revenueRulesQuery.refetch(); bpo.classificationRulesQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Refresh masters</Button></div>
            </div>
          </section>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-36 rounded-3xl" /><Skeleton className="h-36 rounded-3xl" /><Skeleton className="h-36 rounded-3xl" /><Skeleton className="h-36 rounded-3xl" /></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Contracts" value={contracts.length} detail={`${health.withoutContract.length} processes without active contract coverage`} icon={<FileClock className="h-5 w-5" />} tone={health.withoutContract.length ? "amber" : "emerald"} />
              <MetricCard label="Revenue rules" value={revenueRules.length} detail={`${health.withoutRule.length} processes require a billing rule`} icon={<CircleDollarSign className="h-5 w-5" />} tone={health.withoutRule.length ? "rose" : "emerald"} />
              <MetricCard label="Classification rules" value={classificationRules.length} detail="Employee, designation, department and expense treatment rules" icon={<Network className="h-5 w-5" />} tone="violet" />
              <MetricCard label="Allocation policies" value={allocationPolicies.length} detail={`${health.allocationIssues.length} manual pools are not balanced to 100%`} icon={<Scale className="h-5 w-5" />} tone={health.allocationIssues.length ? "rose" : "sky"} />
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ period, tab })} className="space-y-5">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <TabsTrigger className="rounded-xl" value="overview">Control overview</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="commercial">Revenue &amp; contracts</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="delivery">Delivery &amp; adjustments</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="costs">Cost master</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="allocation">Allocation master</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="classification">Classification</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="plans">Plans &amp; periods</TabsTrigger>
              <TabsTrigger className="rounded-xl" value="governance">Governance &amp; history</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <WorkspaceCard title="Configuration health" subtitle="Coverage is calculated from active HRMS process mappings, commercial masters, monthly plans and classification controls." icon={<Gauge className="h-5 w-5 text-sky-600" />}>
                  <div className="space-y-5">
                    <HealthLine label="Organisation mapping" value={health.mappingPct} detail={`${health.unmappedProcesses.length} processes missing client or branch`} />
                    <HealthLine label="Contract coverage" value={health.contractPct} detail={`${health.withoutContract.length} processes without contract`} />
                    <HealthLine label="Revenue-rule coverage" value={health.rulePct} detail={`${health.withoutRule.length} processes without approved commercial rule`} />
                    <HealthLine label="Monthly-plan coverage" value={health.planPct} detail={`${health.withoutPlan.length} processes without ${period} plan`} />
                    <HealthLine label="Classification readiness" value={health.classificationCoverage} detail={`${classificationRules.length} active classification records`} />
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Master impact simulator" subtitle="Preview the directional impact of a rate-card change before changing the approved commercial master." icon={<GitCompareArrows className="h-5 w-5 text-violet-600" />}>
                  <div className="space-y-4">
                    <Field label="Process"><ProcessSelect value={impactProcessId} onChange={setImpactProcessId} processes={processes} /></Field>
                    <Field label="Proposed rate change %"><Input className="rounded-xl" type="number" value={impactRateChange} onChange={(event) => setImpactRateChange(numberValue(event.target.value))} /></Field>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current proxy</p><p className="mt-2 text-xl font-black text-slate-950">{currency(impactPreview.currentMonthlyRevenue)}</p></div>
                      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-sky-700">Impact</p><p className="mt-2 text-xl font-black text-sky-950">{currency(impactPreview.delta)}</p></div>
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Revised proxy</p><p className="mt-2 text-xl font-black text-emerald-950">{currency(impactPreview.revised)}</p></div>
                    </div>
                    <p className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">Preview uses {impactPreview.ruleCount} configured rule(s), monthly minimums, mandated seats and FX. The live P&amp;L remains unchanged until the approved master is saved.</p>
                  </div>
                </WorkspaceCard>
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <WorkspaceCard title="Unmapped process queue" subtitle="Every P&L process requires a client and branch mapping." icon={<Building2 className="h-5 w-5 text-rose-600" />}>
                  <div className="space-y-2">
                    {health.unmappedProcesses.slice(0, 8).map((process) => <div key={process.id} className="flex items-center justify-between rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3"><div><p className="text-sm font-bold text-slate-900">{process.process_name}</p><p className="text-xs text-slate-500">{!process.client_id ? "Client missing" : ""}{!process.client_id && !process.branch_id ? " · " : ""}{!process.branch_id ? "Branch missing" : ""}</p></div><AlertTriangle className="h-4 w-4 text-rose-500" /></div>)}
                    {health.unmappedProcesses.length === 0 ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">All process mappings are complete.</div> : null}
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Commercial gaps" subtitle="Processes without an approved BPO revenue rule fall back to accounting data." icon={<ReceiptIndianRupee className="h-5 w-5 text-amber-600" />}>
                  <div className="space-y-2">
                    {health.withoutRule.slice(0, 8).map((process) => <button type="button" key={process.id} onClick={() => { setRevenueRuleForm((current) => ({ ...current, processId: process.id })); setSearchParams({ period, tab: "commercial" }); }} className="flex w-full items-center justify-between rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-left transition hover:border-amber-300"><div><p className="text-sm font-bold text-slate-900">{process.process_name}</p><p className="text-xs text-slate-500">Create commercial billing rule</p></div><ArrowRight className="h-4 w-4 text-amber-600" /></button>)}
                    {health.withoutRule.length === 0 ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">All processes have commercial rules.</div> : null}
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Allocation exceptions" subtitle="Manual allocation pools must equal exactly 100% before period close." icon={<Scale className="h-5 w-5 text-violet-600" />}>
                  <div className="space-y-2">
                    {health.allocationIssues.map(([key, totalPct]) => <div key={key} className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3"><div className="flex items-center justify-between"><p className="text-sm font-bold text-slate-900">{titleCase(key.replace("|", " / "))}</p><span className="text-sm font-black text-rose-700">{percent(totalPct)}</span></div><p className="mt-1 text-xs text-slate-500">Difference from 100%: {percent(Math.abs(100 - totalPct))}</p></div>)}
                    {health.allocationIssues.length === 0 ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">All manual allocation pools are balanced.</div> : null}
                  </div>
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="commercial" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <WorkspaceCard title="Create commercial revenue rule" subtitle="Configure hybrid billing, minimum commitments, included units, overages, FX, mandated seats and quality/SLA gates." icon={<CircleDollarSign className="h-5 w-5 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect value={revenueRuleForm.processId} onChange={(value) => setRevenueRuleForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <Field label="Rule name"><Input className="rounded-xl" value={revenueRuleForm.ruleName} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, ruleName: event.target.value }))} placeholder="Primary seat billing" /></Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Billing model"><select className={selectClass} value={revenueRuleForm.billingModel} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, billingModel: event.target.value }))}><option value="per_seat">Per seat</option><option value="per_fte">Per FTE</option><option value="per_productive_hour">Per productive hour</option><option value="per_login_hour">Per login hour</option><option value="per_talk_minute">Per talk minute</option><option value="per_transaction">Per transaction</option><option value="per_mandate">Per mandate</option><option value="per_case">Per case</option><option value="fixed_monthly">Fixed monthly</option><option value="outcome_based">Outcome based</option></select></Field>
                      <Field label="Metric key"><Input className="rounded-xl" value={revenueRuleForm.metricKey} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, metricKey: event.target.value }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Rate"><Input className="rounded-xl" type="number" value={revenueRuleForm.rateAmount} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, rateAmount: numberValue(event.target.value) }))} /></Field>
                      <Field label="Currency"><Input className="rounded-xl" value={revenueRuleForm.currencyCode ?? "INR"} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} /></Field>
                      <Field label="FX to INR"><Input className="rounded-xl" type="number" step="0.0001" value={revenueRuleForm.fxToInr ?? 1} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, fxToInr: numberValue(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Monthly minimum"><Input className="rounded-xl" type="number" value={revenueRuleForm.monthlyMinimumCommitment ?? 0} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, monthlyMinimumCommitment: numberValue(event.target.value) }))} /></Field>
                      <Field label="Included units"><Input className="rounded-xl" type="number" value={revenueRuleForm.includedUnits ?? 0} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, includedUnits: numberValue(event.target.value) }))} /></Field>
                      <Field label="Overage rate"><Input className="rounded-xl" type="number" value={revenueRuleForm.overageRate ?? 0} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, overageRate: numberValue(event.target.value) }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Mandated seats"><Input className="rounded-xl" type="number" value={revenueRuleForm.mandatedSeats ?? 0} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, mandatedSeats: numberValue(event.target.value) }))} /></Field>
                      <Field label="Quality gate %"><Input className="rounded-xl" type="number" value={revenueRuleForm.qualityGatePct ?? ""} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, qualityGatePct: event.target.value ? numberValue(event.target.value) : null }))} /></Field>
                      <Field label="SLA gate %"><Input className="rounded-xl" type="number" value={revenueRuleForm.slaGatePct ?? ""} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, slaGatePct: event.target.value ? numberValue(event.target.value) : null }))} /></Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective from"><Input className="rounded-xl" type="date" value={revenueRuleForm.effectiveFrom} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="Approval reference"><Input className="rounded-xl" value={revenueRuleForm.approvalReference ?? ""} onChange={(event) => setRevenueRuleForm((current) => ({ ...current, approvalReference: event.target.value }))} placeholder="MSA / approval email / amendment ID" /></Field></div>
                    <Button className="rounded-xl" disabled={!revenueRuleForm.processId || !revenueRuleForm.ruleName || !revenueRuleForm.metricKey || bpo.saveRevenueRule.isPending} onClick={() => saveWithToast(() => bpo.saveRevenueRule.mutateAsync(revenueRuleForm as RevenueRulePayload & Record<string, unknown>), "Commercial revenue rule saved.")}>{bpo.saveRevenueRule.isPending ? "Saving..." : "Save commercial rule"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Approved commercial rules" subtitle="These effective-dated rules drive earned revenue and hybrid billing calculations." icon={<ShieldCheck className="h-5 w-5 text-sky-600" />}>
                  <MasterTable emptyText="No revenue rule is configured for this scope." rows={revenueRules} columns={[{ key: "process_id", label: "Process", render: (value) => processName.get(String(value)) ?? String(value) }, { key: "rule_name", label: "Rule" }, { key: "billing_model", label: "Model", render: titleCase }, { key: "rate_amount", label: "Rate", align: "right", render: currency }, { key: "monthly_minimum_commitment", label: "Minimum", align: "right", render: currency }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} />
                </WorkspaceCard>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <WorkspaceCard title="Contract master" subtitle="Create effective-dated client/process agreements used by commercial rules and rate cards." icon={<BookOpenCheck className="h-5 w-5 text-violet-600" />}>
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Process"><ProcessSelect value={contractForm.process_id} onChange={(value) => { const process = processes.find((item) => item.id === value); setContractForm((current) => ({ ...current, process_id: value, client_id: process?.client_id ?? current.client_id })); }} processes={processes} /></Field><Field label="Client"><select className={selectClass} value={contractForm.client_id ?? ""} onChange={(event) => setContractForm((current) => ({ ...current, client_id: event.target.value }))}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.client_name}</option>)}</select></Field></div>
                    <Field label="Contract name"><Input className="rounded-xl" value={contractForm.contract_name} onChange={(event) => setContractForm((current) => ({ ...current, contract_name: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Billing type"><select className={selectClass} value={contractForm.billing_type ?? "per_seat"} onChange={(event) => setContractForm((current) => ({ ...current, billing_type: event.target.value }))}><option value="per_seat">Per seat</option><option value="per_fte">Per FTE</option><option value="transaction">Transaction</option><option value="fixed">Fixed</option><option value="hybrid">Hybrid</option></select></Field><Field label="Base rate"><Input className="rounded-xl" type="number" value={contractForm.billing_rate ?? 0} onChange={(event) => setContractForm((current) => ({ ...current, billing_rate: numberValue(event.target.value) }))} /></Field><Field label="Currency"><Input className="rounded-xl" value={contractForm.currency ?? "INR"} onChange={(event) => setContractForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Monthly minimum"><Input className="rounded-xl" type="number" value={contractForm.monthly_minimum_commitment ?? 0} onChange={(event) => setContractForm((current) => ({ ...current, monthly_minimum_commitment: numberValue(event.target.value) }))} /></Field><Field label="Effective from"><Input className="rounded-xl" type="date" value={contractForm.effective_from ?? firstDay(period)} onChange={(event) => setContractForm((current) => ({ ...current, effective_from: event.target.value }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!contractForm.process_id || !contractForm.contract_name || legacy.saveContract.isPending} onClick={() => saveWithToast(() => legacy.saveContract.mutateAsync(contractForm), "Contract master saved.")}>{legacy.saveContract.isPending ? "Saving..." : "Save contract master"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Rate card master" subtitle="Maintain approved unit rates without changing historical effective periods." icon={<BadgeIndianRupee className="h-5 w-5 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect value={rateForm.process_id} onChange={(value) => setRateForm((current) => ({ ...current, process_id: value }))} processes={processes} /></Field>
                    <Field label="Contract"><select className={selectClass} value={rateForm.contract_id ?? ""} onChange={(event) => setRateForm((current) => ({ ...current, contract_id: event.target.value }))}><option value="">Select contract</option>{contracts.filter((row) => !rateForm.process_id || row.process_id === rateForm.process_id).map((row) => <option key={row.id} value={row.id}>{row.contract_name}</option>)}</select></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Rate type"><Input className="rounded-xl" value={rateForm.rate_type} onChange={(event) => setRateForm((current) => ({ ...current, rate_type: event.target.value }))} /></Field><Field label="Amount"><Input className="rounded-xl" type="number" value={rateForm.rate_amount} onChange={(event) => setRateForm((current) => ({ ...current, rate_amount: numberValue(event.target.value) }))} /></Field><Field label="Unit"><Input className="rounded-xl" value={rateForm.unit ?? "seat"} onChange={(event) => setRateForm((current) => ({ ...current, unit: event.target.value }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective from"><Input className="rounded-xl" type="date" value={rateForm.effective_from} onChange={(event) => setRateForm((current) => ({ ...current, effective_from: event.target.value }))} /></Field><Field label="Approval reference"><Input className="rounded-xl" value={rateForm.approval_reference ?? ""} onChange={(event) => setRateForm((current) => ({ ...current, approval_reference: event.target.value }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!rateForm.process_id || !rateForm.rate_type || legacy.saveRate.isPending} onClick={() => saveWithToast(() => legacy.saveRate.mutateAsync(rateForm), "Rate card saved.")}>{legacy.saveRate.isPending ? "Saving..." : "Save rate card"}</Button>
                  </div>
                </WorkspaceCard>
              </div>

              <WorkspaceCard title="Contract and rate register" subtitle="A combined view of effective commercial agreements and approved billing rates." icon={<Boxes className="h-5 w-5 text-slate-600" />}>
                <div className="grid gap-5 xl:grid-cols-2"><MasterTable rows={contracts as AnyRow[]} emptyText="No contract configured." columns={[{ key: "process_name", label: "Process" }, { key: "contract_name", label: "Contract" }, { key: "billing_type", label: "Type", render: titleCase }, { key: "billing_rate", label: "Base rate", align: "right", render: currency }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} /><MasterTable rows={rates as AnyRow[]} emptyText="No rate card configured." columns={[{ key: "process_name", label: "Process" }, { key: "rate_type", label: "Rate type", render: titleCase }, { key: "rate_amount", label: "Amount", align: "right", render: currency }, { key: "unit", label: "Unit" }, { key: "effective_from", label: "Effective" }]} /></div>
              </WorkspaceCard>
            </TabsContent>

            <TabsContent value="delivery" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <WorkspaceCard title="Validated delivery master" subtitle="Record the commercial output used for seat, FTE, hours, transactions, mandates, cases and outcome billing." icon={<FileSpreadsheet className="h-5 w-5 text-sky-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect value={deliveryForm.processId} onChange={(value) => setDeliveryForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Period"><Input className="rounded-xl" type="month" value={deliveryForm.periodCode} onChange={(event) => setDeliveryForm((current) => ({ ...current, periodCode: event.target.value }))} /></Field><Field label="Activity date"><Input className="rounded-xl" type="date" value={deliveryForm.activityDate ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, activityDate: event.target.value }))} /></Field><Field label="Metric key"><Input className="rounded-xl" value={deliveryForm.metricKey} onChange={(event) => setDeliveryForm((current) => ({ ...current, metricKey: event.target.value }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-5">{(["plannedUnits", "deliveredUnits", "acceptedUnits", "rejectedUnits", "billableUnits"] as const).map((key) => <Field key={key} label={titleCase(key)}><Input className="rounded-xl" type="number" value={deliveryForm[key] ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, [key]: numberValue(event.target.value) }))} /></Field>)}</div>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Productive hours"><Input className="rounded-xl" type="number" value={deliveryForm.productiveHours ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, productiveHours: numberValue(event.target.value) }))} /></Field><Field label="Login hours"><Input className="rounded-xl" type="number" value={deliveryForm.loginHours ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, loginHours: numberValue(event.target.value) }))} /></Field><Field label="Talk minutes"><Input className="rounded-xl" type="number" value={deliveryForm.talkMinutes ?? 0} onChange={(event) => setDeliveryForm((current) => ({ ...current, talkMinutes: numberValue(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-4"><Field label="Quality %"><Input className="rounded-xl" type="number" value={deliveryForm.qualityScore ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, qualityScore: event.target.value ? numberValue(event.target.value) : null }))} /></Field><Field label="SLA %"><Input className="rounded-xl" type="number" value={deliveryForm.slaScore ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, slaScore: event.target.value ? numberValue(event.target.value) : null }))} /></Field><Field label="Data source"><Input className="rounded-xl" value={deliveryForm.dataSource ?? "manual"} onChange={(event) => setDeliveryForm((current) => ({ ...current, dataSource: event.target.value }))} /></Field><Field label="Source reference"><Input className="rounded-xl" value={deliveryForm.sourceReference ?? ""} onChange={(event) => setDeliveryForm((current) => ({ ...current, sourceReference: event.target.value }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!deliveryForm.processId || !deliveryForm.metricKey || bpo.saveDeliveryActual.isPending} onClick={() => saveWithToast(() => bpo.saveDeliveryActual.mutateAsync(deliveryForm as DeliveryActualPayload & Record<string, unknown>), "Validated delivery saved.")}>{bpo.saveDeliveryActual.isPending ? "Saving..." : "Save delivery actual"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Revenue addition or deduction" subtitle="Record incentives, rewards, SLA deductions, penalties, credit notes, rate true-ups and one-time commercial items." icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect value={revenueComponentForm.processId} onChange={(value) => setRevenueComponentForm((current) => ({ ...current, processId: value }))} processes={processes} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Component type"><select className={selectClass} value={revenueComponentForm.componentType} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, componentType: event.target.value }))}><option value="incentive">Incentive</option><option value="reward">Reward</option><option value="penalty">Penalty</option><option value="sla_deduction">SLA deduction</option><option value="credit_note">Credit note</option><option value="rate_true_up">Rate true-up</option><option value="fx_adjustment">FX adjustment</option><option value="ramp_up">Ramp-up</option><option value="training_revenue">Training revenue</option><option value="one_time">One-time</option><option value="other">Other</option></select></Field><Field label="Direction"><select className={selectClass} value={revenueComponentForm.direction} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, direction: event.target.value as "increase" | "decrease" }))}><option value="increase">Increase revenue</option><option value="decrease">Decrease revenue</option></select></Field></div>
                    <Field label="Description"><Textarea className="rounded-xl" rows={4} value={revenueComponentForm.description} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Amount INR"><Input className="rounded-xl" type="number" value={revenueComponentForm.amountInr} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, amountInr: numberValue(event.target.value) }))} /></Field><Field label="Recognition date"><Input className="rounded-xl" type="date" value={revenueComponentForm.recognitionDate ?? ""} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, recognitionDate: event.target.value }))} /></Field><Field label="Invoice reference"><Input className="rounded-xl" value={revenueComponentForm.invoiceReference ?? ""} onChange={(event) => setRevenueComponentForm((current) => ({ ...current, invoiceReference: event.target.value }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!revenueComponentForm.processId || !revenueComponentForm.description || bpo.saveRevenueComponent.isPending} onClick={() => saveWithToast(() => bpo.saveRevenueComponent.mutateAsync(revenueComponentForm as RevenueComponentPayload & Record<string, unknown>), "Revenue component saved.")}>{bpo.saveRevenueComponent.isPending ? "Saving..." : "Save revenue component"}</Button>
                  </div>
                </WorkspaceCard>
              </div>

              <div className="grid gap-5 xl:grid-cols-2"><WorkspaceCard title="Delivery register" subtitle="Validated and locked delivery records included in the selected period." icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}><MasterTable rows={deliveryActuals} emptyText="No delivery records for the selected period." columns={[{ key: "process_id", label: "Process", render: (value) => processName.get(String(value)) ?? String(value) }, { key: "metric_key", label: "Metric" }, { key: "delivered_units", label: "Delivered", align: "right" }, { key: "billable_units", label: "Billable", align: "right" }, { key: "quality_score", label: "Quality", align: "right", render: percent }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} /></WorkspaceCard><WorkspaceCard title="Revenue component ledger" subtitle="Only approved, non-reversed items affect earned revenue." icon={<ReceiptIndianRupee className="h-5 w-5 text-violet-600" />}><MasterTable rows={revenueComponents} emptyText="No revenue components for the selected period." columns={[{ key: "process_id", label: "Process", render: (value) => processName.get(String(value)) ?? String(value) }, { key: "component_type", label: "Type", render: titleCase }, { key: "direction", label: "Direction", render: titleCase }, { key: "amount_inr", label: "Amount", align: "right", render: (value, row) => `${row.direction === "decrease" ? "-" : "+"}${currency(value)}` }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} /></WorkspaceCard></div>
            </TabsContent>

            <TabsContent value="costs" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="EBITDA-to-PAT cost master" subtitle="Add depreciation, amortisation, finance cost, tax, exceptional or operating components not already captured from payroll, expenses or GRNs." icon={<Calculator className="h-5 w-5 text-violet-600" />}>
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Process"><ProcessSelect value={costForm.processId} onChange={(value) => setCostForm((current) => ({ ...current, processId: value || null }))} processes={processes} allowBlank /></Field><Field label="Branch"><BranchSelect value={costForm.branchId} onChange={(value) => setCostForm((current) => ({ ...current, branchId: value || null }))} branches={branches} allowBlank /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Cost type"><select className={selectClass} value={costForm.costType} onChange={(event) => setCostForm((current) => ({ ...current, costType: event.target.value }))}><option value="depreciation">Depreciation</option><option value="amortization">Amortisation</option><option value="finance_cost">Finance cost</option><option value="tax">Tax</option><option value="other_operating_cost">Other operating cost</option><option value="exceptional_item">Exceptional item</option></select></Field><Field label="Period"><Input className="rounded-xl" type="month" value={costForm.periodCode} onChange={(event) => setCostForm((current) => ({ ...current, periodCode: event.target.value }))} /></Field></div>
                    <Field label="Description"><Textarea className="rounded-xl" rows={3} value={costForm.description} onChange={(event) => setCostForm((current) => ({ ...current, description: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Amount INR"><Input className="rounded-xl" type="number" value={costForm.amountInr} onChange={(event) => setCostForm((current) => ({ ...current, amountInr: numberValue(event.target.value) }))} /></Field><Field label="Allocation driver"><select className={selectClass} value={costForm.allocationDriver ?? "direct"} onChange={(event) => setCostForm((current) => ({ ...current, allocationDriver: event.target.value }))}><option value="direct">Direct</option><option value="active_hc">Active HC</option><option value="billable_hc">Billable HC</option><option value="contracted_seats">Contracted seats</option><option value="revenue">Revenue</option><option value="equal">Equal</option><option value="manual">Manual</option></select></Field><Field label="Manual allocation %"><Input className="rounded-xl" type="number" value={costForm.manualAllocationPct ?? ""} onChange={(event) => setCostForm((current) => ({ ...current, manualAllocationPct: event.target.value ? numberValue(event.target.value) : null }))} /></Field></div>
                    <Field label="Source reference"><Input className="rounded-xl" value={costForm.sourceReference ?? ""} onChange={(event) => setCostForm((current) => ({ ...current, sourceReference: event.target.value }))} /></Field>
                    <Button className="rounded-xl" disabled={!costForm.description || bpo.saveCostComponent.isPending} onClick={() => saveWithToast(() => bpo.saveCostComponent.mutateAsync(costForm as CostComponentPayload & Record<string, unknown>), "Cost master component saved.")}>{bpo.saveCostComponent.isPending ? "Saving..." : "Save cost component"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Cost component register" subtitle="Approved operating and non-operating components used from EBITDA through PAT." icon={<BadgeIndianRupee className="h-5 w-5 text-sky-600" />}>
                  <MasterTable rows={costComponents} emptyText="No cost components for the selected period." columns={[{ key: "process_id", label: "Process", render: (value) => value ? processName.get(String(value)) ?? String(value) : "Shared" }, { key: "branch_id", label: "Branch", render: (value) => value ? branchName.get(String(value)) ?? String(value) : "Organisation" }, { key: "cost_type", label: "Cost type", render: titleCase }, { key: "description", label: "Description" }, { key: "amount_inr", label: "Amount", align: "right", render: currency }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} />
                </WorkspaceCard>
              </div>

              <WorkspaceCard title="P&L line hierarchy" subtitle="Controlled presentation of the financial waterfall used across command centre, process detail and period close." icon={<Workflow className="h-5 w-5 text-emerald-600" />}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[
                  ["Revenue", "Gross potential → earned → recognised → invoiced → collected"],
                  ["Direct service cost", "Agent Salary + DSC People + DSC Non-People"],
                  ["Contribution", "Recognised Revenue − Direct Service Cost"],
                  ["EBITDA", "Contribution − BMC People − BMC Non-People − other operating cost"],
                  ["EBIT", "EBITDA − Depreciation − Amortisation"],
                  ["PBT", "EBIT − Finance Cost ± Non-operating items"],
                  ["PAT", "PBT − Tax"],
                  ["Excluded", "Capex and explicitly excluded non-P&L items"],
                ].map(([label, detail], index) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">{index + 1}</span><p className="font-black text-slate-950">{label}</p></div><p className="mt-3 text-xs leading-5 text-slate-500">{detail}</p></div>)}</div>
              </WorkspaceCard>
            </TabsContent>

            <TabsContent value="allocation" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="Shared-cost allocation policy" subtitle="Configure how branch and organisation pools flow to individual processes. Manual pools should total exactly 100%." icon={<Scale className="h-5 w-5 text-violet-600" />}>
                  <div className="grid gap-4">
                    <Field label="Branch"><BranchSelect value={allocationForm.branchId} onChange={(value) => setAllocationForm((current) => ({ ...current, branchId: value }))} branches={branches} /></Field>
                    <Field label="Process"><ProcessSelect value={allocationForm.processId} onChange={(value) => setAllocationForm((current) => ({ ...current, processId: value || null }))} processes={processes.filter((process) => !allocationForm.branchId || process.branch_id === allocationForm.branchId)} allowBlank /></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Pool type"><select className={selectClass} value={allocationForm.poolType} onChange={(event) => setAllocationForm((current) => ({ ...current, poolType: event.target.value }))}><option value="bmc_people">BMC People</option><option value="bmc_non_people">BMC Non-People</option><option value="shared_service">Shared service</option><option value="corporate_overhead">Corporate overhead</option></select></Field><Field label="Allocation driver"><select className={selectClass} value={allocationForm.allocationDriver} onChange={(event) => setAllocationForm((current) => ({ ...current, allocationDriver: event.target.value }))}><option value="active_hc">Active HC</option><option value="billable_hc">Billable HC</option><option value="contracted_seats">Contracted seats</option><option value="revenue">Revenue</option><option value="floor_area">Floor area</option><option value="device_count">Device count</option><option value="equal">Equal</option><option value="manual">Manual %</option></select></Field></div>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Manual %"><Input className="rounded-xl" type="number" disabled={allocationForm.allocationDriver !== "manual"} value={allocationForm.manualAllocationPct ?? ""} onChange={(event) => setAllocationForm((current) => ({ ...current, manualAllocationPct: event.target.value ? numberValue(event.target.value) : null }))} /></Field><Field label="Effective from"><Input className="rounded-xl" type="date" value={allocationForm.effectiveFrom} onChange={(event) => setAllocationForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="Effective to"><Input className="rounded-xl" type="date" value={allocationForm.effectiveTo ?? ""} onChange={(event) => setAllocationForm((current) => ({ ...current, effectiveTo: event.target.value || null }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!allocationForm.branchId || bpo.saveAllocationPolicy.isPending} onClick={() => saveWithToast(() => bpo.saveAllocationPolicy.mutateAsync(allocationForm as AllocationPolicyPayload & Record<string, unknown>), "Allocation policy saved.")}>{bpo.saveAllocationPolicy.isPending ? "Saving..." : "Save allocation policy"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Allocation policy register" subtitle="Effective-dated policies applied to BMC and shared-service pools." icon={<Network className="h-5 w-5 text-sky-600" />}>
                  <MasterTable rows={allocationPolicies} emptyText="No allocation policy configured." columns={[{ key: "branch_id", label: "Branch", render: (value) => branchName.get(String(value)) ?? String(value) }, { key: "process_id", label: "Process", render: (value) => value ? processName.get(String(value)) ?? String(value) : "Branch pool" }, { key: "pool_type", label: "Pool", render: titleCase }, { key: "allocation_driver", label: "Driver", render: titleCase }, { key: "manual_allocation_pct", label: "Manual %", align: "right", render: (value) => value == null ? "-" : percent(value) }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} />
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="classification" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="P&L classification rule" subtitle="Classify people by employee, designation or department; classify expenses by Finance Head/Sub-Head master." icon={<UsersRound className="h-5 w-5 text-emerald-600" />}>
                  <div className="grid gap-4">
                    <Field label="Rule name"><Input className="rounded-xl" value={classificationForm.ruleName} onChange={(event) => setClassificationForm((current) => ({ ...current, ruleName: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Scope type"><select className={selectClass} value={classificationForm.scopeType} onChange={(event) => setClassificationForm((current) => ({ ...current, scopeType: event.target.value, pnlBucket: ["expense_head", "expense_sub_head"].includes(event.target.value) ? "dsc_non_people" : "agent_salary" }))}><option value="employee">Employee</option><option value="designation">Designation</option><option value="department">Department</option><option value="expense_head">Expense Head</option><option value="expense_sub_head">Expense Sub-Head</option></select></Field><Field label="Exact scope key"><Input className="rounded-xl" value={classificationForm.scopeKey} onChange={(event) => setClassificationForm((current) => ({ ...current, scopeKey: event.target.value }))} placeholder="Employee ID, designation, department or master code" /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Process"><ProcessSelect value={classificationForm.processId} onChange={(value) => setClassificationForm((current) => ({ ...current, processId: value || null }))} processes={processes} allowBlank /></Field><Field label="Branch"><BranchSelect value={classificationForm.branchId} onChange={(value) => setClassificationForm((current) => ({ ...current, branchId: value || null }))} branches={branches} allowBlank /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="P&L bucket"><select className={selectClass} value={classificationForm.pnlBucket} onChange={(event) => setClassificationForm((current) => ({ ...current, pnlBucket: event.target.value }))}>{["employee", "designation", "department"].includes(classificationForm.scopeType) ? <><option value="agent_salary">Agent Salary</option><option value="dsc_people">DSC People</option><option value="bmc_people">BMC People</option><option value="excluded">Excluded</option></> : <><option value="dsc_non_people">DSC Non-People</option><option value="bmc_non_people">BMC Non-People</option><option value="depreciation">Depreciation</option><option value="amortization">Amortisation</option><option value="finance_cost">Finance Cost</option><option value="tax">Tax</option><option value="capex">Capex</option><option value="excluded">Excluded</option></>}</select></Field><Field label="Priority"><Input className="rounded-xl" type="number" value={classificationForm.priority ?? 100} onChange={(event) => setClassificationForm((current) => ({ ...current, priority: numberValue(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective from"><Input className="rounded-xl" type="date" value={classificationForm.effectiveFrom} onChange={(event) => setClassificationForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="Effective to"><Input className="rounded-xl" type="date" value={classificationForm.effectiveTo ?? ""} onChange={(event) => setClassificationForm((current) => ({ ...current, effectiveTo: event.target.value || null }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!classificationForm.ruleName || !classificationForm.scopeKey || bpo.saveClassificationRule.isPending} onClick={() => saveWithToast(() => bpo.saveClassificationRule.mutateAsync(classificationForm as ClassificationRulePayload & Record<string, unknown>), "Classification rule saved.")}>{bpo.saveClassificationRule.isPending ? "Saving..." : "Save classification rule"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title="Classification register" subtitle="Priority-ordered treatment used by payroll, expense, GRN and shared-cost calculations." icon={<Database className="h-5 w-5 text-violet-600" />}>
                  <MasterTable rows={classificationRules} emptyText="No classification rule configured." columns={[{ key: "rule_name", label: "Rule" }, { key: "scope_type", label: "Scope", render: titleCase }, { key: "scope_key", label: "Key" }, { key: "pnl_bucket", label: "P&L bucket", render: titleCase }, { key: "priority", label: "Priority", align: "right" }, { key: "active_status", label: "Status", render: (value) => <StatusPill value={Number(value) === 0 ? "inactive" : "active"} /> }]} />
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="plans" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <WorkspaceCard title="Monthly operating plan" subtitle="Set contracted seats, workforce requirement, shrinkage, buffer and revenue/cost/profit budgets for the selected month." icon={<TrendingUp className="h-5 w-5 text-sky-600" />}>
                  <div className="grid gap-4">
                    <Field label="Process"><ProcessSelect value={planForm.process_id} onChange={(value) => setPlanForm((current) => ({ ...current, process_id: value }))} processes={processes} /></Field>
                    <Field label="Period"><Input className="rounded-xl" type="month" value={planForm.period_code} onChange={(event) => setPlanForm((current) => ({ ...current, period_code: event.target.value }))} /></Field>
                    <div className="grid gap-4 sm:grid-cols-3"><Field label="Contracted seats"><Input className="rounded-xl" type="number" value={planForm.contracted_seats ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, contracted_seats: numberValue(event.target.value) }))} /></Field><Field label="Productive HC"><Input className="rounded-xl" type="number" value={planForm.required_productive_hc ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, required_productive_hc: numberValue(event.target.value) }))} /></Field><Field label="Roster HC"><Input className="rounded-xl" type="number" value={planForm.required_roster_hc ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, required_roster_hc: numberValue(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Shrinkage %"><Input className="rounded-xl" type="number" value={planForm.planned_shrinkage_pct ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, planned_shrinkage_pct: numberValue(event.target.value) }))} /></Field><Field label="Buffer target %"><Input className="rounded-xl" type="number" value={planForm.buffer_target_pct ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, buffer_target_pct: numberValue(event.target.value) }))} /></Field></div>
                    <div className="grid gap-4 sm:grid-cols-2"><Field label="Revenue budget"><Input className="rounded-xl" type="number" value={planForm.revenue_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, revenue_budget: numberValue(event.target.value) }))} /></Field><Field label="Direct cost budget"><Input className="rounded-xl" type="number" value={planForm.direct_cost_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, direct_cost_budget: numberValue(event.target.value) }))} /></Field><Field label="Indirect cost budget"><Input className="rounded-xl" type="number" value={planForm.indirect_cost_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, indirect_cost_budget: numberValue(event.target.value) }))} /></Field><Field label="Profit budget"><Input className="rounded-xl" type="number" value={planForm.profit_budget ?? 0} onChange={(event) => setPlanForm((current) => ({ ...current, profit_budget: numberValue(event.target.value) }))} /></Field></div>
                    <Button className="rounded-xl" disabled={!planForm.process_id || legacy.saveMonthlyPlan.isPending} onClick={() => saveWithToast(() => legacy.saveMonthlyPlan.mutateAsync(planForm), "Monthly operating plan saved.")}>{legacy.saveMonthlyPlan.isPending ? "Saving..." : "Save monthly plan"}</Button>
                  </div>
                </WorkspaceCard>

                <WorkspaceCard title={`${period} plan register`} subtitle="Plan coverage, staffing assumptions and budget targets used for variance analysis." icon={<FileSpreadsheet className="h-5 w-5 text-emerald-600" />}>
                  <MasterTable rows={plans as AnyRow[]} emptyText="No monthly plan configured for this period." columns={[{ key: "process_name", label: "Process" }, { key: "contracted_seats", label: "Seats", align: "right" }, { key: "required_roster_hc", label: "Roster HC", align: "right" }, { key: "revenue_budget", label: "Revenue", align: "right", render: currency }, { key: "profit_budget", label: "Profit", align: "right", render: currency }, { key: "status", label: "Status", render: (value) => <StatusPill value={value} /> }]} />
                </WorkspaceCard>
              </div>
            </TabsContent>

            <TabsContent value="governance" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-3">
                <WorkspaceCard title="Maker-checker control" subtitle="Financial masters should be prepared, reviewed and approved by separate authorised users." icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}><div className="space-y-3">{[["1", "Finance Preparer", "Create and edit master drafts"], ["2", "Finance Head", "Approve commercial and classification changes"], ["3", "Accounts Head", "Approve accounting-impact changes"], ["4", "CEO / COO", "Final period sign-off where configured"]].map(([step, role, detail]) => <div key={step} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">{step}</span><div><p className="text-sm font-black text-slate-900">{role}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div></div>)}</div></WorkspaceCard>
                <WorkspaceCard title="Period governance" subtitle="Open, sign-off and lock status available from the finance period master." icon={<LockKeyhole className="h-5 w-5 text-amber-600" />}><div className="space-y-2">{periods.slice(0, 8).map((row) => <div key={row.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"><div><p className="text-sm font-black text-slate-900">{row.period_code}</p><p className="text-xs text-slate-500">{row.locked_at ? `Locked ${new Date(row.locked_at).toLocaleString("en-IN")}` : "Available for governance"}</p></div><StatusPill value={row.status} /></div>)}</div></WorkspaceCard>
                <WorkspaceCard title="Data-source readiness" subtitle="Operational sources feeding process profitability and reconciliation." icon={<Database className="h-5 w-5 text-sky-600" />}><div className="space-y-2">{[["Payroll", classificationRules.length > 0], ["Commercial rules", revenueRules.length > 0], ["Delivery actuals", deliveryActuals.length > 0], ["GRN allocations", true], ["Vendor payments", true], ["Monthly plans", plans.length > 0]].map(([label, ready]) => <div key={String(label)} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"><span className="text-sm font-bold text-slate-800">{label}</span>{ready ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-rose-500" />}</div>)}</div></WorkspaceCard>
              </div>

              <WorkspaceCard title="Adjustment and master-change history" subtitle="Approved, rejected and reversed financial adjustments retained for period governance and audit review." icon={<FileClock className="h-5 w-5 text-violet-600" />} actions={<Button asChild variant="outline" className="rounded-xl"><Link to={`/finance/process-pnl/period-close?period=${period}`}>Open period close<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}>
                <MasterTable rows={adjustments as AnyRow[]} emptyText="No adjustment history for the selected period." maxHeight={520} columns={[{ key: "process_name", label: "Process" }, { key: "metric_key", label: "Metric", render: titleCase }, { key: "previous_value", label: "Previous", align: "right", render: currency }, { key: "adjustment_amount", label: "Adjustment", align: "right", render: currency }, { key: "revised_value", label: "Revised", align: "right", render: currency }, { key: "reason", label: "Reason" }, { key: "approval_status", label: "Status", render: (value) => <StatusPill value={value} /> }]} />
              </WorkspaceCard>
            </TabsContent>
          </Tabs>

          <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-start gap-4"><div className="rounded-2xl bg-sky-400/15 p-3 text-sky-300"><Sparkles className="h-6 w-6" /></div><div><h2 className="text-xl font-black">One governed source of truth</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">Every master saved here refreshes the same P&amp;L APIs used by the command centre and process drill-down. Closed-period control remains in the separate sign-off workspace.</p></div></div>
              <Button asChild className="rounded-xl bg-white font-bold text-slate-950 hover:bg-slate-100"><Link to={`/finance/process-pnl?period=${period}`}>Review calculated impact<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
