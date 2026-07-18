import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  IndianRupee,
  Layers3,
  Loader2,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  budgetLineRecordToInput,
  calculateBudgetLine,
  type BranchBudgetLineInput,
  type BranchBudgetSummary,
  useBranchBudgetDetail,
  useBranchBudgets,
} from "@/hooks/useBranchBudget";
import {
  type BudgetCoverageEntry,
  type BudgetCoverageItem,
  type BudgetPlanningStatus,
  useBudgetCoverage,
} from "@/hooks/useBudgetCoverage";
import {
  type FinanceExpenseHead,
  type FinanceExpenseSubHead,
  useFinanceExpenseMasters,
} from "@/hooks/useFinanceExpenseMasters";
import { hrmsApi } from "@/lib/hrmsApi";

const FALLBACK_UNITS = [
  "Nos",
  "Unit",
  "Seat",
  "User",
  "Employee",
  "Month",
  "Year",
  "Candidate",
  "Service",
  "Sq. Ft.",
  "Connection",
  "Device",
  "Litre",
  "Trip",
  "Shipment",
  "Campaign",
  "Event",
];
const GST_RATES = [0, 5, 12, 18, 28];
const ALLOCATION_DRIVERS = [
  ["agent_headcount", "Agent headcount"],
  ["total_manpower", "Total manpower"],
  ["revenue_share", "Revenue share"],
  ["seat_count", "Seat count"],
  ["device_count", "Device count"],
  ["floor_area", "Floor area"],
  ["usage_units", "Usage units"],
  ["hiring_volume", "Hiring volume"],
  ["direct_tagging", "Direct tagging"],
] as const;

type WorkspaceTab = "create" | "coverage" | "queue" | "masters";
type CoverageDraft = Record<
  string,
  { status: BudgetPlanningStatus | ""; reason: string }
>;

type BudgetCapabilities = {
  roles: string[];
  scopedBranchId: string | null;
  branchLocked: boolean;
  canCreate: boolean;
  canManageExpenseMaster: boolean;
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
  canReviewAccountsStage: boolean;
};

function periodNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

function blankLine(
  preset?: Partial<BranchBudgetLineInput>
): BranchBudgetLineInput {
  return {
    head: "",
    subHead: "",
    itemName: "",
    itemDescription: "",
    quantity: 1,
    unit: "Unit",
    unitRate: 0,
    taxTreatment: "exclusive",
    gstRate: 18,
    gstType: "cgst_sgst",
    recoverableTaxPct: 100,
    allocationDriver: "agent_headcount",
    preferredVendorId: null,
    justification: "",
    ...preset,
  };
}

function selectedHead(
  masters: FinanceExpenseHead[],
  headName: string
) {
  return masters.find((head) => head.headName === headName);
}

function selectedSubHead(
  masters: FinanceExpenseHead[],
  headName: string,
  subHeadName?: string | null
) {
  return selectedHead(masters, headName)?.subHeads.find(
    (subHead) => subHead.subHeadName === subHeadName
  );
}

function lineScope(line: BranchBudgetLineInput) {
  if (line.costCentreId) return "cost_centre";
  if (line.processId) return "process";
  return "branch_common";
}

function groupCoverage(items: BudgetCoverageItem[]) {
  const groups = new Map<
    string,
    { headId: string; headName: string; items: BudgetCoverageItem[] }
  >();
  for (const item of items) {
    const current = groups.get(item.expense_head_id) ?? {
      headId: item.expense_head_id,
      headName: item.head_name,
      items: [],
    };
    current.items.push(item);
    groups.set(item.expense_head_id, current);
  }
  return Array.from(groups.values());
}

function decisionTone(status: BudgetPlanningStatus | "") {
  if (status === "planned") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "not_planned") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "not_applicable") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function MetricCard({
  label,
  value,
  helper,
  tone = "slate",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const styles = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
  };
  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
      {helper && <p className="mt-1 text-[10px] text-slate-500">{helper}</p>}
    </div>
  );
}

export default function BranchBudgetManagementPage() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("create");
  const [period, setPeriod] = useState(periodNow());
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<BranchBudgetLineInput[]>([blankLine()]);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [expandedHeads, setExpandedHeads] = useState<Set<string>>(new Set());
  const [coverageDraft, setCoverageDraft] = useState<CoverageDraft>({});

  const capabilitiesQuery = useQuery({
    queryKey: ["branch-budget-capabilities"],
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: BudgetCapabilities;
      }>("/api/finance/pnl/budgets/capabilities");
      return response.data;
    },
  });
  const capabilities = capabilitiesQuery.data;

  useEffect(() => {
    if (capabilities?.scopedBranchId) setBranchId(capabilities.scopedBranchId);
  }, [capabilities?.scopedBranchId]);

  const { budgetsQuery, saveBudget, submitBudget, reviewBudget } = useBranchBudgets({
    period,
    branchId: branchId || undefined,
  });
  const budgets = budgetsQuery.data ?? [];
  const currentBudget = budgets[0];
  const editableBudget = ["draft", "revision_required"].includes(
    currentBudget?.status ?? ""
  )
    ? currentBudget
    : undefined;
  const detailId = savedBudgetId ?? editableBudget?.id ?? null;
  const detailQuery = useBranchBudgetDetail(detailId);
  const { coverageQuery, saveCoverage } = useBudgetCoverage(detailId);

  const { mastersQuery, saveHead, saveSubHead } = useFinanceExpenseMasters(
    Boolean(capabilities?.canManageExpenseMaster)
  );
  const expenseMasters = mastersQuery.data ?? [];
  const activeExpenseMasters = expenseMasters.filter((head) => head.activeStatus);

  const { data: branchResponse } = useQuery({
    queryKey: ["budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const { data: processResponse } = useQuery({
    queryKey: ["budget-processes"],
    queryFn: () => hrmsApi.get<any>("/api/org/processes?limit=500"),
  });
  const { data: costCentreResponse } = useQuery({
    queryKey: ["budget-cost-centres"],
    queryFn: () => hrmsApi.get<any>("/api/org/cost-centres?limit=500"),
  });
  const { data: vendorResponse } = useQuery({
    queryKey: ["budget-vendors"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });

  const allBranches = unwrapList(branchResponse).filter(
    (branch) => Number(branch.active_status ?? 1) === 1
  );
  const branches = capabilities?.branchLocked && capabilities.scopedBranchId
    ? allBranches.filter((branch) => branch.id === capabilities.scopedBranchId)
    : allBranches;
  const processes = unwrapList(processResponse).filter(
    (process) =>
      Number(process.active_status ?? 1) === 1
      && (!branchId || !process.branch_id || process.branch_id === branchId)
  );
  const costCentres = unwrapList(costCentreResponse).filter(
    (costCentre) => !branchId || !costCentre.branch_id || costCentre.branch_id === branchId
  );
  const vendors = unwrapList(vendorResponse).filter(
    (vendor) => Number(vendor.is_active ?? vendor.active_status ?? 1) === 1
  );

  useEffect(() => {
    if (!branchId) {
      setLines([blankLine()]);
      setSavedBudgetId(null);
      setLoadedDetailId(null);
      return;
    }
    if (!detailId) {
      setLines([blankLine()]);
      setLoadedDetailId(null);
    }
  }, [branchId, period, detailId]);

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || loadedDetailId === detail.id) return;
    setSavedBudgetId(detail.id);
    setLines(
      detail.lines.length
        ? detail.lines.map(budgetLineRecordToInput)
        : [blankLine()]
    );
    setLoadedDetailId(detail.id);
  }, [detailQuery.data, loadedDetailId]);

  useEffect(() => {
    const items = coverageQuery.data?.items ?? [];
    if (!items.length) return;
    const next: CoverageDraft = {};
    for (const item of items) {
      next[item.expense_sub_head_id] = {
        status: item.planning_status ?? "",
        reason: item.reason ?? "",
      };
    }
    setCoverageDraft(next);
    setExpandedHeads((current) =>
      current.size
        ? current
        : new Set(groupCoverage(items).map((group) => group.headId))
    );
  }, [coverageQuery.data]);

  const totals = useMemo(
    () =>
      lines.reduce(
        (aggregate, line) => {
          const calculated = calculateBudgetLine(line);
          aggregate.base += calculated.base;
          aggregate.tax += calculated.tax;
          aggregate.gross += calculated.gross;
          aggregate.pnl += calculated.pnlCost;
          return aggregate;
        },
        { base: 0, tax: 0, gross: 0, pnl: 0 }
      ),
    [lines]
  );

  const coverageItems = coverageQuery.data?.items ?? [];
  const filteredCoverage = coverageItems.filter((item) =>
    `${item.head_name} ${item.sub_head_name}`
      .toLowerCase()
      .includes(coverageSearch.trim().toLowerCase())
  );
  const coverageGroups = groupCoverage(filteredCoverage);
  const lockedBudget = currentBudget && !editableBudget && !savedBudgetId;
  const canEdit = Boolean(capabilities?.canCreate) && !lockedBudget;
  const isSaving = saveBudget.isPending || submitBudget.isPending;

  function updateLine(index: number, patch: Partial<BranchBudgetLineInput>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line
      )
    );
  }

  function applyHead(index: number, headName: string) {
    updateLine(index, {
      head: headName,
      subHead: "",
      unit: "Unit",
      taxTreatment: "exclusive",
      gstRate: 18,
      gstType: "cgst_sgst",
      recoverableTaxPct: 100,
      allocationDriver: "agent_headcount",
    });
  }

  function applySubHead(index: number, subHeadName: string) {
    const line = lines[index];
    const subHead = selectedSubHead(activeExpenseMasters, line.head, subHeadName);
    updateLine(index, {
      subHead: subHeadName,
      unit: subHead?.defaultUnit ?? line.unit,
      taxTreatment: subHead?.defaultTaxTreatment ?? line.taxTreatment,
      gstRate: subHead?.defaultGstRate ?? line.gstRate,
      gstType: subHead?.defaultGstType ?? line.gstType,
      recoverableTaxPct:
        subHead?.defaultRecoverableTaxPct ?? line.recoverableTaxPct,
      allocationDriver:
        subHead?.defaultAllocationDriver ?? line.allocationDriver,
    });
  }

  function validateLines() {
    if (!branchId) throw new Error("Branch is mandatory");
    if (!lines.length) throw new Error("At least one detailed budget line is mandatory");
    lines.forEach((line, index) => {
      const label = `Budget line ${index + 1}`;
      if (!line.head || !line.subHead) throw new Error(`${label}: Head and Sub-head are mandatory`);
      if (!line.itemName.trim()) throw new Error(`${label}: Item / service is mandatory`);
      if (!line.itemDescription?.trim()) throw new Error(`${label}: Description / specification is mandatory`);
      if (!line.unit.trim()) throw new Error(`${label}: Unit is mandatory`);
      if (!line.allocationDriver) throw new Error(`${label}: Allocation driver is mandatory`);
      if (!line.justification.trim()) throw new Error(`${label}: Business justification and rate basis are mandatory`);
      if (Number(line.quantity) <= 0) throw new Error(`${label}: Quantity must be greater than zero`);
      if (Number(line.unitRate) < 0) throw new Error(`${label}: Unit rate cannot be negative`);
      if (lineScope(line) === "cost_centre" && !line.costCentreId) throw new Error(`${label}: Cost centre is mandatory for the selected scope`);
      if (lineScope(line) === "process" && !line.processId) throw new Error(`${label}: Process is mandatory for the selected scope`);
    });
  }

  async function save(submit = false) {
    try {
      validateLines();
      if (lockedBudget) {
        throw new Error(`The ${period} budget is already ${statusLabel(currentBudget.status)}`);
      }
      const result = await saveBudget.mutateAsync({
        id: savedBudgetId ?? editableBudget?.id,
        branchId,
        periodCode: period,
        financialYear: financialYearFromPeriod(period),
        lines,
      });
      setSavedBudgetId(result.id);
      setLoadedDetailId(result.id);
      const coverageResponse = await hrmsApi.get<{
        success: boolean;
        data: typeof coverageQuery.data;
      }>(`/api/finance/pnl/budgets/${result.id}/coverage`);
      if (submit && !coverageResponse.data?.summary.readyToSubmit) {
        setActiveTab("coverage");
        throw new Error(
          `Review every active Head/Sub-head before submission. ${coverageResponse.data?.summary.incomplete ?? 0} decision(s) remain incomplete.`
        );
      }
      if (submit) await submitBudget.mutateAsync(result.id);
      await coverageQuery.refetch();
      toast.success(submit ? "Budget submitted to Branch Head" : "Budget draft saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Budget could not be saved");
    }
  }

  async function saveCoverageDecisions() {
    try {
      const entries: BudgetCoverageEntry[] = coverageItems
        .map((item) => {
          const draft = coverageDraft[item.expense_sub_head_id];
          if (!draft?.status) return null;
          return {
            expenseHeadId: item.expense_head_id,
            expenseSubHeadId: item.expense_sub_head_id,
            planningStatus: draft.status,
            reason: draft.reason || null,
          } satisfies BudgetCoverageEntry;
        })
        .filter((item): item is BudgetCoverageEntry => Boolean(item));
      await saveCoverage.mutateAsync(entries);
      toast.success("Head/Sub-head review saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Coverage could not be saved");
    }
  }

  function addLineFromCoverage(item: BudgetCoverageItem) {
    const subHead = selectedSubHead(
      activeExpenseMasters,
      item.head_name,
      item.sub_head_name
    );
    setLines((current) => [
      ...current,
      blankLine({
        head: item.head_name,
        subHead: item.sub_head_name,
        unit: subHead?.defaultUnit ?? item.default_unit,
        taxTreatment:
          subHead?.defaultTaxTreatment
          ?? (item.default_tax_treatment as BranchBudgetLineInput["taxTreatment"]),
        gstRate: Number(subHead?.defaultGstRate ?? item.default_gst_rate),
        gstType:
          subHead?.defaultGstType
          ?? (item.default_gst_type as BranchBudgetLineInput["gstType"]),
        recoverableTaxPct: Number(
          subHead?.defaultRecoverableTaxPct
          ?? item.default_recoverable_tax_pct
        ),
        allocationDriver:
          subHead?.defaultAllocationDriver
          ?? item.default_allocation_driver,
      }),
    ]);
    setCoverageDraft((current) => ({
      ...current,
      [item.expense_sub_head_id]: { status: "planned", reason: "" },
    }));
    setActiveTab("create");
    toast.success(`${item.sub_head_name} added to the Plan Builder`);
  }

  async function review(
    budget: BranchBudgetSummary,
    decision: "approve" | "reject" | "revision"
  ) {
    try {
      if (decision !== "approve" && !remarks.trim()) {
        throw new Error("Remarks are mandatory for rejection or revision");
      }
      await reviewBudget.mutateAsync({
        id: budget.id,
        decision,
        remarks: remarks.trim() || undefined,
      });
      toast.success(
        decision === "approve"
          ? "Budget advanced to the next approval stage"
          : "Budget decision recorded"
      );
      setRemarks("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Budget review failed");
    }
  }

  function canReviewBudget(budget: BranchBudgetSummary) {
    if (budget.status === "submitted") return Boolean(capabilities?.canReviewBranchStage);
    if (budget.status === "branch_head_approved") return Boolean(capabilities?.canReviewFinanceStage);
    if (budget.status === "finance_head_approved") return Boolean(capabilities?.canReviewAccountsStage);
    return false;
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_44%,_#f5f7fb_100%)]">
        <div className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="relative overflow-hidden rounded-[32px] border border-slate-800 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.25)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.28),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.20),_transparent_30%)]" />
            <div className="relative grid gap-8 p-6 lg:grid-cols-[1.35fr_0.9fr] lg:p-8">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Controlled monthly planning
                  </Badge>
                  <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/10">
                    <Sparkles className="mr-1 h-3.5 w-3.5" /> Complete Head/Sub-head coverage
                  </Badge>
                </div>
                <h1 className="mt-5 max-w-4xl text-3xl font-black tracking-tight sm:text-4xl">
                  Build the branch budget once, then control every GRN and P&L cost from it.
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Every active Sub-head must be deliberately planned, excluded or marked not applicable before the budget can move to approval.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {capabilities?.canCreate && (
                    <>
                      <Button onClick={() => void save(false)} disabled={isSaving || Boolean(lockedBudget)}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save draft
                      </Button>
                      <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => void save(true)} disabled={isSaving || Boolean(lockedBudget)}>
                        <Send className="mr-2 h-4 w-4" /> Submit to Branch Head
                      </Button>
                    </>
                  )}
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                    <Link to="/finance/grn">Open Smart GRN</Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Without tax" value={money(totals.base)} />
                <MetricCard label="Tax budget" value={money(totals.tax)} tone="blue" />
                <MetricCard label="With tax" value={money(totals.gross)} tone="emerald" />
                <MetricCard label="P&L cost" value={money(totals.pnl)} tone="amber" />
              </div>
            </div>
          </section>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WorkspaceTab)} className="space-y-5">
            <TabsList className="h-auto w-full flex-wrap justify-start rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              <TabsTrigger value="create"><Layers3 className="mr-2 h-4 w-4" />Plan Builder</TabsTrigger>
              <TabsTrigger value="coverage"><ClipboardCheck className="mr-2 h-4 w-4" />Head/Sub-head Coverage</TabsTrigger>
              <TabsTrigger value="queue"><ShieldCheck className="mr-2 h-4 w-4" />Approval & Utilization</TabsTrigger>
              <TabsTrigger value="masters"><Settings2 className="mr-2 h-4 w-4" />Expense Master</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-5">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardContent className="grid gap-4 p-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Period *</Label>
                    <Input type="month" value={period} disabled={!capabilities?.canCreate || Boolean(lockedBudget)} onChange={(event) => { setPeriod(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }} />
                  </div>
                  <div className="space-y-2">
                    <Label>{capabilities?.branchLocked ? "Assigned branch" : "Branch *"}</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:bg-slate-100" value={branchId} disabled={Boolean(capabilities?.branchLocked) || !capabilities?.canCreate || Boolean(lockedBudget)} onChange={(event) => { setBranchId(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }}>
                      <option value="">Select branch</option>
                      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Financial year</Label>
                    <Input value={financialYearFromPeriod(period)} readOnly />
                  </div>
                </CardContent>
              </Card>

              {lockedBudget && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <div><p className="font-semibold">{currentBudget.budget_number} is {statusLabel(currentBudget.status)}</p><p className="mt-1 text-amber-700">The budget is read-only unless a revision is requested.</p></div>
                </div>
              )}

              {detailQuery.isLoading && detailId ? (
                <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : (
                <div className="space-y-4">
                  {lines.map((line, index) => {
                    const calculation = calculateBudgetLine(line);
                    const head = selectedHead(activeExpenseMasters, line.head);
                    const subHeads = head?.subHeads.filter((item) => item.activeStatus) ?? [];
                    const units = Array.from(new Set([line.unit, ...subHeads.map((item) => item.defaultUnit), ...FALLBACK_UNITS])).filter(Boolean);
                    const scope = lineScope(line);
                    return (
                      <Card key={line.id ?? index} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
                        <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 bg-slate-50/70">
                          <div><CardTitle className="text-base">Budget line {index + 1}</CardTitle><p className="mt-1 text-xs text-slate-500">Every factual and financial field is mandatory for planned expenses.</p></div>
                          <Button variant="ghost" size="icon" disabled={!canEdit || lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                        </CardHeader>
                        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                          <div className="space-y-2">
                            <Label>Attribution scope *</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={scope} disabled={!canEdit} onChange={(event) => { const value = event.target.value; updateLine(index, { costCentreId: value === "cost_centre" ? line.costCentreId : null, processId: value === "process" ? line.processId : null }); }}>
                              <option value="branch_common">Branch common</option><option value="cost_centre">Direct to cost centre</option><option value="process">Direct to process</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>Cost centre {scope === "cost_centre" ? "*" : ""}</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.costCentreId ?? ""} disabled={!canEdit || scope !== "cost_centre"} onChange={(event) => { const costCentre = costCentres.find((item) => item.id === event.target.value); updateLine(index, { costCentreId: event.target.value || null, processId: costCentre?.process_id ?? null }); }}><option value="">Select cost centre</option>{costCentres.map((item) => <option key={item.id} value={item.id}>{item.cost_centre_name ?? item.name}</option>)}</select>
                          </div>
                          <div className="space-y-2">
                            <Label>Process {scope === "process" ? "*" : ""}</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.processId ?? ""} disabled={!canEdit || scope !== "process"} onChange={(event) => updateLine(index, { processId: event.target.value || null })}><option value="">Select process</option>{processes.map((item) => <option key={item.id} value={item.id}>{item.process_name ?? item.name}</option>)}</select>
                          </div>
                          <div className="space-y-2">
                            <Label>Allocation driver *</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.allocationDriver ?? ""} disabled={!canEdit} onChange={(event) => updateLine(index, { allocationDriver: event.target.value })}>{ALLOCATION_DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                          </div>
                          <div className="space-y-2">
                            <Label>Head *</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.head} disabled={!canEdit || mastersQuery.isLoading} onChange={(event) => applyHead(index, event.target.value)}><option value="">Select Head</option>{activeExpenseMasters.map((item) => <option key={item.id} value={item.headName}>{item.headName}</option>)}</select>
                          </div>
                          <div className="space-y-2">
                            <Label>Sub-head *</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.subHead ?? ""} disabled={!canEdit || !line.head} onChange={(event) => applySubHead(index, event.target.value)}><option value="">Select Sub-head</option>{subHeads.map((item) => <option key={item.id} value={item.subHeadName}>{item.subHeadName}</option>)}</select>
                          </div>
                          <div className="space-y-2 xl:col-span-2">
                            <Label>Item / service *</Label>
                            <Input value={line.itemName} disabled={!canEdit} onChange={(event) => updateLine(index, { itemName: event.target.value })} placeholder="Exact item or service" />
                          </div>
                          <div className="space-y-2 xl:col-span-2">
                            <Label>Description / specification *</Label>
                            <Textarea value={line.itemDescription ?? ""} disabled={!canEdit} onChange={(event) => updateLine(index, { itemDescription: event.target.value })} placeholder="Specification, scope, service period and commercial context" />
                          </div>
                          <div className="space-y-2 xl:col-span-2">
                            <Label>Preferred vendor decision *</Label>
                            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.preferredVendorId ?? "_tbd"} disabled={!canEdit} onChange={(event) => updateLine(index, { preferredVendorId: event.target.value === "_tbd" ? null : event.target.value })}><option value="_tbd">Vendor to be finalized through approved Vendor Master</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}{vendor.vendor_name ?? vendor.name}</option>)}</select>
                          </div>
                          <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0.0001" step="0.0001" value={line.quantity} disabled={!canEdit} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div>
                          <div className="space-y-2"><Label>Unit *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.unit} disabled={!canEdit} onChange={(event) => updateLine(index, { unit: event.target.value })}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div>
                          <div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" step="0.01" value={line.unitRate} disabled={!canEdit} onChange={(event) => updateLine(index, { unitRate: Number(event.target.value) })} /></div>
                          <div className="space-y-2"><Label>Tax treatment *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.taxTreatment} disabled={!canEdit} onChange={(event) => { const treatment = event.target.value as BranchBudgetLineInput["taxTreatment"]; updateLine(index, { taxTreatment: treatment, gstRate: ["exempt", "non_gst"].includes(treatment) ? 0 : line.gstRate, gstType: ["exempt", "non_gst"].includes(treatment) ? "none" : line.gstType, recoverableTaxPct: ["exempt", "non_gst"].includes(treatment) ? 0 : line.recoverableTaxPct }); }}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="exempt">Exempt</option><option value="reverse_charge">Reverse charge</option><option value="non_gst">Non-GST</option></select></div>
                          <div className="space-y-2"><Label>GST rate *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstRate} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { gstRate: Number(event.target.value) })}>{GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select></div>
                          <div className="space-y-2"><Label>GST type *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstType} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { gstType: event.target.value as BranchBudgetLineInput["gstType"] })}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="none">None</option></select></div>
                          <div className="space-y-2"><Label>Recoverable GST % *</Label><Input type="number" min="0" max="100" value={line.recoverableTaxPct} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { recoverableTaxPct: Number(event.target.value) })} /></div>
                          <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label>Business justification and quantity/rate basis *</Label><Textarea value={line.justification} disabled={!canEdit} onChange={(event) => updateLine(index, { justification: event.target.value })} placeholder="Explain the requirement, quantity derivation, rate source and expected business benefit" /></div>
                          <div className="grid gap-3 md:col-span-2 sm:grid-cols-4 xl:col-span-4">{[["Without tax", calculation.base], ["Tax", calculation.tax], ["With tax", calculation.gross], ["P&L cost", calculation.pnlCost]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-bold">{money(Number(value))}</p></div>)}</div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              {capabilities?.canCreate && (
                <Button variant="outline" className="w-full rounded-2xl border-dashed py-6" disabled={Boolean(lockedBudget)} onClick={() => setLines((current) => [...current, blankLine()])}><Plus className="mr-2 h-4 w-4" />Add budget line</Button>
              )}
            </TabsContent>

            <TabsContent value="coverage" className="space-y-5">
              {!detailId ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-8 text-center"><ClipboardCheck className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Save the budget draft first</p><p className="mt-2 text-sm text-blue-800">The complete active Head/Sub-head catalogue will then be linked to this month.</p><Button className="mt-4" onClick={() => setActiveTab("create")}>Open Plan Builder</Button></div>
              ) : coverageQuery.isLoading ? (
                <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <MetricCard label="Completion" value={`${coverageQuery.data?.summary.completionPct ?? 0}%`} tone={coverageQuery.data?.summary.readyToSubmit ? "emerald" : "amber"} />
                    <MetricCard label="All Sub-heads" value={String(coverageQuery.data?.summary.total ?? 0)} />
                    <MetricCard label="Planned" value={String(coverageQuery.data?.summary.planned ?? 0)} tone="emerald" />
                    <MetricCard label="Not planned" value={String(coverageQuery.data?.summary.notPlanned ?? 0)} tone="amber" />
                    <MetricCard label="Not applicable" value={String(coverageQuery.data?.summary.notApplicable ?? 0)} />
                    <MetricCard label="Incomplete" value={String(coverageQuery.data?.summary.incomplete ?? 0)} tone={(coverageQuery.data?.summary.incomplete ?? 0) ? "rose" : "emerald"} />
                  </div>
                  <Card className="rounded-3xl border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100">
                      <div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Complete Expense Catalogue</CardTitle><p className="mt-1 text-xs text-slate-500">Every active Sub-head must receive an explicit planning decision.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" value={coverageSearch} onChange={(event) => setCoverageSearch(event.target.value)} placeholder="Search Head or Sub-head" /></div>{capabilities?.canCreate && <Button onClick={() => void saveCoverageDecisions()} disabled={saveCoverage.isPending}>{saveCoverage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save decisions</Button>}</div></div>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4">
                      {coverageGroups.map((group) => {
                        const expanded = expandedHeads.has(group.headId);
                        const complete = group.items.every((item) => coverageDraft[item.expense_sub_head_id]?.status);
                        return (
                          <div key={group.headId} className="overflow-hidden rounded-2xl border border-slate-200">
                            <button type="button" onClick={() => setExpandedHeads((current) => { const next = new Set(current); if (next.has(group.headId)) next.delete(group.headId); else next.add(group.headId); return next; })} className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-left"><span className={`flex h-8 w-8 items-center justify-center rounded-full ${complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}</span><div className="flex-1"><p className="text-sm font-bold text-slate-900">{group.headName}</p><p className="text-[10px] text-slate-500">{group.items.length} active Sub-head(s)</p></div>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                            {expanded && <div className="divide-y divide-slate-100">{group.items.map((item) => { const draft = coverageDraft[item.expense_sub_head_id] ?? { status: "", reason: "" }; const invalidPlanned = draft.status === "planned" && item.budget_line_count <= 0; const needsReason = ["not_planned", "not_applicable"].includes(draft.status) && !draft.reason.trim(); return <div key={item.expense_sub_head_id} className="grid gap-4 p-4 xl:grid-cols-[1.2fr_0.85fr_1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{item.sub_head_name}</p><Badge variant="outline">{item.default_unit}</Badge><Badge className={`border ${decisionTone(draft.status)}`}>{draft.status ? statusLabel(draft.status) : "Decision pending"}</Badge></div><p className="mt-2 text-[11px] text-slate-500">Default: {item.default_tax_treatment.replaceAll("_", " ")} · {item.default_gst_rate}% · {item.default_allocation_driver?.replaceAll("_", " ") ?? "No driver"}</p><p className="mt-1 text-[11px] font-medium text-slate-700">{item.budget_line_count} line(s) · {money(item.gross_budget_amount)}</p></div><div className="grid grid-cols-3 gap-1">{(["planned", "not_planned", "not_applicable"] as BudgetPlanningStatus[]).map((status) => <button key={status} type="button" disabled={!capabilities?.canCreate || Boolean(lockedBudget)} onClick={() => setCoverageDraft((current) => ({ ...current, [item.expense_sub_head_id]: { status, reason: status === "planned" ? "" : current[item.expense_sub_head_id]?.reason ?? "" } }))} className={`rounded-xl border px-2 py-2 text-[10px] font-semibold ${draft.status === status ? decisionTone(status) : "border-slate-200 bg-white text-slate-500"}`}>{status === "planned" ? "Planned" : status === "not_planned" ? "Not Planned" : "N/A"}</button>)}</div><div>{draft.status !== "planned" ? <Input disabled={!capabilities?.canCreate || Boolean(lockedBudget)} value={draft.reason} onChange={(event) => setCoverageDraft((current) => ({ ...current, [item.expense_sub_head_id]: { ...draft, reason: event.target.value } }))} placeholder="Mandatory reason" /> : <div className={`rounded-xl border p-3 text-xs ${invalidPlanned ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{invalidPlanned ? "Planned, but no detailed budget line exists." : "Detailed line is linked and ready."}</div>}{needsReason && <p className="mt-1 text-[10px] text-rose-600">Reason is mandatory.</p>}</div><div className="flex items-center justify-end">{draft.status === "planned" && item.budget_line_count <= 0 && capabilities?.canCreate && <Button size="sm" variant="outline" onClick={() => addLineFromCoverage(item)}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>}</div></div>; })}</div>}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="queue" className="space-y-4">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader><CardTitle>Approval and utilization</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Input placeholder="Mandatory remarks for rejection or revision" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
                  {budgets.map((budget) => { const available = Number(budget.gross_budget_amount) - Number(budget.reserved_amount) - Number(budget.consumed_amount); const canReview = canReviewBudget(budget); return <div key={budget.id} className="grid gap-4 rounded-2xl border border-slate-200 p-4 xl:grid-cols-[1.3fr_1fr_1fr_1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{budget.budget_number}</p><Badge variant="outline">{statusLabel(budget.status)}</Badge></div><p className="mt-1 text-xs text-slate-500">{budget.branch_name} · {budget.period_code} · Revision {budget.revision_no} · {budget.line_count} lines</p></div><MetricCell label="Without tax / Tax" value={`${money(Number(budget.base_budget_amount))} / ${money(Number(budget.tax_budget_amount))}`} /><MetricCell label="With tax / P&L" value={`${money(Number(budget.gross_budget_amount))} / ${money(Number(budget.pnl_budget_amount))}`} /><MetricCell label="Reserved / Consumed / Available" value={`${money(Number(budget.reserved_amount))} / ${money(Number(budget.consumed_amount))} / ${money(available)}`} /><div className="flex flex-wrap justify-end gap-2">{canReview && <><Button size="sm" onClick={() => void review(budget, "approve")} disabled={reviewBudget.isPending}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => void review(budget, "revision")} disabled={reviewBudget.isPending}><Settings2 className="mr-1 h-3.5 w-3.5" />Revision</Button><Button size="sm" variant="destructive" onClick={() => void review(budget, "reject")} disabled={reviewBudget.isPending}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></>}</div></div>; })}
                  {!budgetsQuery.isLoading && !budgets.length && <div className="py-12 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10" />No budget found for the selected branch and period.</div>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="masters">
              <ExpenseMasterPanel masters={expenseMasters} isLoading={mastersQuery.isLoading} canManage={Boolean(capabilities?.canManageExpenseMaster)} isSaving={saveHead.isPending || saveSubHead.isPending} onSaveHead={async (payload) => { try { await saveHead.mutateAsync(payload); toast.success("Expense Head saved"); } catch (error) { toast.error(error instanceof Error ? error.message : "Expense Head could not be saved"); } }} onSaveSubHead={async (payload) => { try { await saveSubHead.mutateAsync(payload); toast.success("Expense Sub-head saved"); } catch (error) { toast.error(error instanceof Error ? error.message : "Expense Sub-head could not be saved"); } }} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function ExpenseMasterPanel({
  masters,
  isLoading,
  canManage,
  isSaving,
  onSaveHead,
  onSaveSubHead,
}: {
  masters: FinanceExpenseHead[];
  isLoading: boolean;
  canManage: boolean;
  isSaving: boolean;
  onSaveHead: (payload: { headName: string; headCode?: string; description?: string }) => Promise<void>;
  onSaveSubHead: (payload: { headId: string; subHeadName: string; subHeadCode?: string; defaultUnit: string; defaultTaxTreatment: BranchBudgetLineInput["taxTreatment"]; defaultGstRate: number; defaultGstType: NonNullable<BranchBudgetLineInput["gstType"]>; defaultRecoverableTaxPct: number; defaultAllocationDriver?: string | null; pnlTreatment: "operating_expense" }) => Promise<void>;
}) {
  const [headForm, setHeadForm] = useState({ headName: "", headCode: "", description: "" });
  const [subHeadForm, setSubHeadForm] = useState({ headId: "", subHeadName: "", subHeadCode: "", defaultUnit: "Unit", defaultTaxTreatment: "exclusive" as BranchBudgetLineInput["taxTreatment"], defaultGstRate: 18, defaultGstType: "cgst_sgst" as NonNullable<BranchBudgetLineInput["gstType"]>, defaultRecoverableTaxPct: 100, defaultAllocationDriver: "agent_headcount" });

  return (
    <div className={`grid gap-5 ${canManage ? "xl:grid-cols-[0.85fr_1.15fr]" : ""}`}>
      {canManage && <div className="space-y-5">
        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle className="text-base">Add Expense Head</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label>Head name *</Label><Input value={headForm.headName} onChange={(event) => setHeadForm((current) => ({ ...current, headName: event.target.value }))} /></div><div className="space-y-2"><Label>Head code</Label><Input value={headForm.headCode} onChange={(event) => setHeadForm((current) => ({ ...current, headCode: event.target.value }))} /></div><div className="space-y-2"><Label>Description</Label><Textarea value={headForm.description} onChange={(event) => setHeadForm((current) => ({ ...current, description: event.target.value }))} /></div><Button className="w-full" disabled={isSaving || !headForm.headName.trim()} onClick={async () => { await onSaveHead({ headName: headForm.headName, headCode: headForm.headCode || undefined, description: headForm.description || undefined }); setHeadForm({ headName: "", headCode: "", description: "" }); }}><Plus className="mr-2 h-4 w-4" />Save Head</Button></CardContent></Card>
        <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle className="text-base">Add Expense Sub-head</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label>Parent Head *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.headId} onChange={(event) => setSubHeadForm((current) => ({ ...current, headId: event.target.value }))}><option value="">Select Head</option>{masters.map((head) => <option key={head.id} value={head.id}>{head.headName}</option>)}</select></div><div className="space-y-2 md:col-span-2"><Label>Sub-head name *</Label><Input value={subHeadForm.subHeadName} onChange={(event) => setSubHeadForm((current) => ({ ...current, subHeadName: event.target.value }))} /></div><div className="space-y-2"><Label>Default unit *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.defaultUnit} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultUnit: event.target.value }))}>{FALLBACK_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="space-y-2"><Label>Allocation driver *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.defaultAllocationDriver} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultAllocationDriver: event.target.value }))}>{ALLOCATION_DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="space-y-2"><Label>Tax treatment *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.defaultTaxTreatment} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultTaxTreatment: event.target.value as BranchBudgetLineInput["taxTreatment"] }))}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="exempt">Exempt</option><option value="reverse_charge">Reverse charge</option><option value="non_gst">Non-GST</option></select></div><div className="space-y-2"><Label>GST rate *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.defaultGstRate} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultGstRate: Number(event.target.value) }))}>{GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select></div><div className="space-y-2"><Label>GST type *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHeadForm.defaultGstType} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultGstType: event.target.value as NonNullable<BranchBudgetLineInput["gstType"]> }))}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="none">None</option></select></div><div className="space-y-2"><Label>Recoverable GST % *</Label><Input type="number" min="0" max="100" value={subHeadForm.defaultRecoverableTaxPct} onChange={(event) => setSubHeadForm((current) => ({ ...current, defaultRecoverableTaxPct: Number(event.target.value) }))} /></div><Button className="md:col-span-2" disabled={isSaving || !subHeadForm.headId || !subHeadForm.subHeadName.trim()} onClick={async () => { await onSaveSubHead({ ...subHeadForm, subHeadCode: subHeadForm.subHeadCode || undefined, pnlTreatment: "operating_expense" }); setSubHeadForm((current) => ({ ...current, subHeadName: "", subHeadCode: "" })); }}><Plus className="mr-2 h-4 w-4" />Save Sub-head</Button></CardContent></Card>
      </div>}
      <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-4 w-4 text-blue-700" />Current Head/Sub-head Master</CardTitle><p className="text-xs text-slate-500">{canManage ? "Finance Head / Super Admin editing enabled." : "Read-only directory. Only Finance Head or Super Admin can modify it."}</p></CardHeader><CardContent className="space-y-4">{isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div> : masters.map((head) => <div key={head.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><div><p className="font-semibold">{head.headName}</p><p className="text-xs text-slate-500">{head.headCode}</p></div><Badge variant={head.activeStatus ? "default" : "outline"}>{head.activeStatus ? "Active" : "Inactive"}</Badge></div><div className="mt-3 grid gap-2 md:grid-cols-2">{head.subHeads.map((subHead) => <div key={subHead.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="flex items-center justify-between gap-2"><p className="font-medium">{subHead.subHeadName}</p><span className="text-xs text-slate-500">{subHead.defaultUnit}</span></div><p className="mt-1 text-xs text-slate-500">{subHead.defaultTaxTreatment.replaceAll("_", " ")} · {subHead.defaultGstRate}% · {subHead.defaultAllocationDriver?.replaceAll("_", " ") ?? "No default allocation"}</p></div>)}</div></div>)}</CardContent></Card>
    </div>
  );
}
