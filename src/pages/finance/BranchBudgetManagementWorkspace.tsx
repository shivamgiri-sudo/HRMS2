import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
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
  type BudgetAttributionScope,
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
  useFinanceExpenseMasters,
} from "@/hooks/useFinanceExpenseMasters";
import { hrmsApi } from "@/lib/hrmsApi";

const UNITS = [
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

type WorkspaceTab = "plan" | "coverage" | "approval" | "master";
type CoverageDraft = Record<string, { status: BudgetPlanningStatus | ""; reason: string }>;
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

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function financialYear(period: string) {
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
  }).format(Number(value || 0));
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

function blankLine(preset: Partial<BranchBudgetLineInput> = {}): BranchBudgetLineInput {
  return {
    attributionScope: "branch_common",
    costCentreId: null,
    processId: null,
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
    preferredVendorId: null,
    allocationDriver: "agent_headcount",
    justification: "",
    ...preset,
  };
}

function scopeOf(line: BranchBudgetLineInput): BudgetAttributionScope {
  return line.attributionScope
    ?? (line.costCentreId ? "cost_centre" : line.processId ? "process" : "branch_common");
}

function Metric({ label, value, tone = "slate" }: {
  label: string;
  value: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    amber: "border-amber-200 bg-amber-50/80",
    rose: "border-rose-200 bg-rose-50/80",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function CoverageDecision({
  item,
  draft,
  editable,
  onChange,
  onAddLine,
}: {
  item: BudgetCoverageItem;
  draft: { status: BudgetPlanningStatus | ""; reason: string };
  editable: boolean;
  onChange: (value: { status: BudgetPlanningStatus | ""; reason: string }) => void;
  onAddLine: () => void;
}) {
  const lineConflict = draft.status !== "planned" && item.budget_line_count > 0;
  const plannedWithoutLine = draft.status === "planned" && item.budget_line_count <= 0;
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[1.25fr_0.9fr_1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-950">{item.sub_head_name}</p>
          <Badge variant="outline">{item.default_unit}</Badge>
          <Badge variant="outline">{item.budget_line_count} line(s)</Badge>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {item.default_tax_treatment.replaceAll("_", " ")} · {item.default_gst_rate}% · {item.default_allocation_driver?.replaceAll("_", " ") ?? "No default allocation"}
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700">{money(item.gross_budget_amount)}</p>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(["planned", "not_planned", "not_applicable"] as BudgetPlanningStatus[]).map((status) => (
          <button
            type="button"
            key={status}
            disabled={!editable}
            onClick={() => onChange({ status, reason: status === "planned" ? "" : draft.reason })}
            className={`rounded-xl border px-2 py-2 text-[10px] font-semibold transition ${
              draft.status === status
                ? status === "planned"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : status === "not_planned"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-slate-300 bg-slate-100 text-slate-700"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {status === "planned" ? "Planned" : status === "not_planned" ? "Not Planned" : "N/A"}
          </button>
        ))}
      </div>
      <div>
        {draft.status === "planned" ? (
          <div className={`rounded-xl border p-3 text-xs ${plannedWithoutLine ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {plannedWithoutLine ? "A detailed budget line is mandatory." : "Detailed line is linked."}
          </div>
        ) : (
          <>
            <Input
              disabled={!editable}
              value={draft.reason}
              onChange={(event) => onChange({ ...draft, reason: event.target.value })}
              placeholder="Mandatory reason"
            />
            {lineConflict && <p className="mt-1 text-[10px] text-rose-600">Remove linked lines before excluding this Sub-head.</p>}
          </>
        )}
      </div>
      <div className="flex items-center justify-end">
        {plannedWithoutLine && editable && (
          <Button size="sm" variant="outline" onClick={onAddLine}>
            <Plus className="mr-1 h-3.5 w-3.5" />Add line
          </Button>
        )}
      </div>
    </div>
  );
}

export default function BranchBudgetManagementWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [period, setPeriod] = useState(currentPeriod());
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<BranchBudgetLineInput[]>([blankLine()]);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [coverageDraft, setCoverageDraft] = useState<CoverageDraft>({});
  const [coverageSearch, setCoverageSearch] = useState("");
  const [expandedHeads, setExpandedHeads] = useState<Set<string>>(new Set());
  const [reviewRemarks, setReviewRemarks] = useState("");

  const capabilitiesQuery = useQuery({
    queryKey: ["branch-budget-capabilities"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: BudgetCapabilities }>(
        "/api/finance/pnl/budgets/capabilities"
      );
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
  const editableBudget = ["draft", "revision_required"].includes(currentBudget?.status ?? "")
    ? currentBudget
    : undefined;
  const detailId = savedBudgetId ?? editableBudget?.id ?? null;
  const detailQuery = useBranchBudgetDetail(detailId);
  const { coverageQuery, saveCoverage } = useBudgetCoverage(detailId);
  const { mastersQuery, saveHead, saveSubHead } = useFinanceExpenseMasters(
    Boolean(capabilities?.canManageExpenseMaster)
  );
  const masters = mastersQuery.data ?? [];
  const activeMasters = masters.filter((head) => head.activeStatus);

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

  const allBranches = unwrapList(branchResponse).filter((item) => Number(item.active_status ?? 1) === 1);
  const branches = capabilities?.branchLocked && capabilities.scopedBranchId
    ? allBranches.filter((item) => item.id === capabilities.scopedBranchId)
    : allBranches;
  const processes = unwrapList(processResponse).filter(
    (item) => Number(item.active_status ?? 1) === 1 && (!branchId || !item.branch_id || item.branch_id === branchId)
  );
  const costCentres = unwrapList(costCentreResponse).filter(
    (item) => !branchId || !item.branch_id || item.branch_id === branchId
  );
  const vendors = unwrapList(vendorResponse).filter(
    (item) => Number(item.is_active ?? item.active_status ?? 1) === 1
  );

  useEffect(() => {
    if (!detailQuery.data || loadedDetailId === detailQuery.data.id) return;
    setSavedBudgetId(detailQuery.data.id);
    setLines(
      detailQuery.data.lines.length
        ? detailQuery.data.lines.map(budgetLineRecordToInput)
        : [blankLine()]
    );
    setLoadedDetailId(detailQuery.data.id);
  }, [detailQuery.data, loadedDetailId]);

  useEffect(() => {
    const items = coverageQuery.data?.items ?? [];
    if (!items.length) return;
    setCoverageDraft(
      Object.fromEntries(
        items.map((item) => [
          item.expense_sub_head_id,
          { status: item.planning_status ?? "", reason: item.reason ?? "" },
        ])
      )
    );
    setExpandedHeads((current) => current.size ? current : new Set(items.map((item) => item.expense_head_id)));
  }, [coverageQuery.data]);

  const totals = useMemo(
    () => lines.reduce((sum, line) => {
      const amount = calculateBudgetLine(line);
      sum.base += amount.base;
      sum.tax += amount.tax;
      sum.gross += amount.gross;
      sum.pnl += amount.pnlCost;
      return sum;
    }, { base: 0, tax: 0, gross: 0, pnl: 0 }),
    [lines]
  );

  const locked = Boolean(currentBudget && !editableBudget && !savedBudgetId);
  const canEdit = Boolean(capabilities?.canCreate) && !locked;
  const coverageItems = coverageQuery.data?.items ?? [];
  const filteredCoverage = coverageItems.filter((item) =>
    `${item.head_name} ${item.sub_head_name}`.toLowerCase().includes(coverageSearch.toLowerCase())
  );
  const coverageGroups = Array.from(
    filteredCoverage.reduce((map, item) => {
      const group = map.get(item.expense_head_id) ?? { id: item.expense_head_id, name: item.head_name, items: [] as BudgetCoverageItem[] };
      group.items.push(item);
      map.set(item.expense_head_id, group);
      return map;
    }, new Map<string, { id: string; name: string; items: BudgetCoverageItem[] }>()).values()
  );

  function updateLine(index: number, patch: Partial<BranchBudgetLineInput>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function setScope(index: number, scope: BudgetAttributionScope) {
    updateLine(index, {
      attributionScope: scope,
      costCentreId: scope === "cost_centre" ? lines[index].costCentreId : null,
      processId: scope === "process" ? lines[index].processId : null,
    });
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
    const subHead = activeMasters
      .find((head) => head.headName === line.head)
      ?.subHeads.find((item) => item.subHeadName === subHeadName);
    updateLine(index, {
      subHead: subHeadName,
      unit: subHead?.defaultUnit ?? line.unit,
      taxTreatment: subHead?.defaultTaxTreatment ?? line.taxTreatment,
      gstRate: Number(subHead?.defaultGstRate ?? line.gstRate),
      gstType: subHead?.defaultGstType ?? line.gstType,
      recoverableTaxPct: Number(subHead?.defaultRecoverableTaxPct ?? line.recoverableTaxPct),
      allocationDriver: subHead?.defaultAllocationDriver ?? line.allocationDriver,
    });
  }

  function validateLines() {
    if (!branchId) throw new Error("Branch is mandatory");
    if (!lines.length) throw new Error("At least one detailed budget line is mandatory");
    lines.forEach((line, index) => {
      const label = `Budget line ${index + 1}`;
      const scope = scopeOf(line);
      if (!line.head || !line.subHead) throw new Error(`${label}: Head and Sub-head are mandatory`);
      if (!line.itemName.trim()) throw new Error(`${label}: Item / service is mandatory`);
      if (!line.itemDescription?.trim()) throw new Error(`${label}: Description / specification is mandatory`);
      if (!line.unit.trim()) throw new Error(`${label}: Unit is mandatory`);
      if (!line.allocationDriver) throw new Error(`${label}: Allocation driver is mandatory`);
      if (!line.justification.trim()) throw new Error(`${label}: Business justification and rate basis are mandatory`);
      if (Number(line.quantity) <= 0) throw new Error(`${label}: Quantity must be greater than zero`);
      if (Number(line.unitRate) < 0) throw new Error(`${label}: Unit rate cannot be negative`);
      if (scope === "cost_centre" && !line.costCentreId) throw new Error(`${label}: Cost centre is mandatory`);
      if (scope === "process" && !line.processId) throw new Error(`${label}: Process is mandatory`);
    });
  }

  async function save(submit: boolean) {
    try {
      validateLines();
      if (locked) throw new Error(`The budget is already ${statusLabel(currentBudget!.status)}`);
      const result = await saveBudget.mutateAsync({
        id: savedBudgetId ?? editableBudget?.id,
        branchId,
        periodCode: period,
        financialYear: financialYear(period),
        lines,
      });
      setSavedBudgetId(result.id);
      setLoadedDetailId(result.id);
      const response = await hrmsApi.get<{ success: boolean; data: typeof coverageQuery.data }>(
        `/api/finance/pnl/budgets/${result.id}/coverage`
      );
      if (submit && !response.data?.summary.readyToSubmit) {
        setTab("coverage");
        throw new Error(`${response.data?.summary.incomplete ?? 0} Head/Sub-head decision(s) remain incomplete`);
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
      const entries = coverageItems
        .map((item) => {
          const draft = coverageDraft[item.expense_sub_head_id];
          return draft?.status
            ? {
                expenseHeadId: item.expense_head_id,
                expenseSubHeadId: item.expense_sub_head_id,
                planningStatus: draft.status,
                reason: draft.reason || null,
              } satisfies BudgetCoverageEntry
            : null;
        })
        .filter((entry): entry is BudgetCoverageEntry => Boolean(entry));
      await saveCoverage.mutateAsync(entries);
      toast.success("Head/Sub-head decisions saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Coverage could not be saved");
    }
  }

  function addFromCoverage(item: BudgetCoverageItem) {
    const subHead = activeMasters
      .find((head) => head.headName === item.head_name)
      ?.subHeads.find((entry) => entry.subHeadName === item.sub_head_name);
    setLines((current) => [...current, blankLine({
      head: item.head_name,
      subHead: item.sub_head_name,
      unit: subHead?.defaultUnit ?? item.default_unit,
      taxTreatment: subHead?.defaultTaxTreatment ?? item.default_tax_treatment as BranchBudgetLineInput["taxTreatment"],
      gstRate: Number(subHead?.defaultGstRate ?? item.default_gst_rate),
      gstType: subHead?.defaultGstType ?? item.default_gst_type as BranchBudgetLineInput["gstType"],
      recoverableTaxPct: Number(subHead?.defaultRecoverableTaxPct ?? item.default_recoverable_tax_pct),
      allocationDriver: subHead?.defaultAllocationDriver ?? item.default_allocation_driver,
    })]);
    setCoverageDraft((current) => ({ ...current, [item.expense_sub_head_id]: { status: "planned", reason: "" } }));
    setTab("plan");
    toast.success(`${item.sub_head_name} added to Plan Builder`);
  }

  async function review(budget: BranchBudgetSummary, decision: "approve" | "reject" | "revision") {
    try {
      if (decision !== "approve" && !reviewRemarks.trim()) throw new Error("Remarks are mandatory");
      await reviewBudget.mutateAsync({ id: budget.id, decision, remarks: reviewRemarks.trim() || undefined });
      toast.success(decision === "approve" ? "Budget advanced" : "Budget decision recorded");
      setReviewRemarks("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Budget review failed");
    }
  }

  function canReview(budget: BranchBudgetSummary) {
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
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Controlled monthly planning</Badge>
                  <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/10"><Sparkles className="mr-1 h-3.5 w-3.5" />100% catalogue review</Badge>
                </div>
                <h1 className="mt-5 max-w-4xl text-3xl font-black tracking-tight sm:text-4xl">Branch Budget Control Room</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Create detailed tax-aware lines, classify every active Sub-head and control all downstream GRNs and P&L costs from one approved source.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {capabilities?.canCreate && <><Button onClick={() => void save(false)} disabled={saveBudget.isPending || locked}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => void save(true)} disabled={saveBudget.isPending || locked}><Send className="mr-2 h-4 w-4" />Submit to Branch Head</Button></>}
                  <Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10"><Link to="/finance/grn">Open Smart GRN</Link></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3"><Metric label="Without tax" value={money(totals.base)} /><Metric label="Tax" value={money(totals.tax)} tone="blue" /><Metric label="With tax" value={money(totals.gross)} tone="emerald" /><Metric label="P&L cost" value={money(totals.pnl)} tone="amber" /></div>
            </div>
          </section>

          <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)} className="space-y-5">
            <TabsList className="h-auto w-full flex-wrap justify-start rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              <TabsTrigger value="plan"><Layers3 className="mr-2 h-4 w-4" />Plan Builder</TabsTrigger>
              <TabsTrigger value="coverage"><ClipboardCheck className="mr-2 h-4 w-4" />Head/Sub-head Coverage</TabsTrigger>
              <TabsTrigger value="approval"><ShieldCheck className="mr-2 h-4 w-4" />Approval & Utilization</TabsTrigger>
              <TabsTrigger value="master"><Settings2 className="mr-2 h-4 w-4" />Expense Master</TabsTrigger>
            </TabsList>

            <TabsContent value="plan" className="space-y-5">
              <Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-3"><div className="space-y-2"><Label>Period *</Label><Input type="month" value={period} disabled={!capabilities?.canCreate || locked} onChange={(event) => { setPeriod(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }} /></div><div className="space-y-2"><Label>{capabilities?.branchLocked ? "Assigned branch" : "Branch *"}</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:bg-slate-100" value={branchId} disabled={Boolean(capabilities?.branchLocked) || !capabilities?.canCreate || locked} onChange={(event) => { setBranchId(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}</select></div><div className="space-y-2"><Label>Financial year</Label><Input value={financialYear(period)} readOnly /></div></CardContent></Card>
              {locked && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{currentBudget?.budget_number} is {statusLabel(currentBudget?.status ?? "locked")}. It is read-only until revision is requested.</div>}
              {detailQuery.isLoading && detailId ? <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : lines.map((line, index) => {
                const scope = scopeOf(line);
                const head = activeMasters.find((entry) => entry.headName === line.head);
                const subHeads = head?.subHeads.filter((entry) => entry.activeStatus) ?? [];
                const amount = calculateBudgetLine(line);
                return (
                  <Card key={line.id ?? index} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 bg-slate-50/70"><div><CardTitle className="text-base">Budget line {index + 1}</CardTitle><p className="mt-1 text-xs text-slate-500">All factual, commercial, allocation and tax fields are mandatory.</p></div><Button variant="ghost" size="icon" disabled={!canEdit || lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4 text-rose-500" /></Button></CardHeader>
                    <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Attribution scope *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={scope} disabled={!canEdit} onChange={(event) => setScope(index, event.target.value as BudgetAttributionScope)}><option value="branch_common">Branch common</option><option value="cost_centre">Direct to cost centre</option><option value="process">Direct to process</option></select></Field>
                      <Field label={`Cost centre ${scope === "cost_centre" ? "*" : ""}`}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.costCentreId ?? ""} disabled={!canEdit || scope !== "cost_centre"} onChange={(event) => { const selected = costCentres.find((item) => item.id === event.target.value); updateLine(index, { attributionScope: "cost_centre", costCentreId: event.target.value || null, processId: selected?.process_id ?? null }); }}><option value="">Select cost centre</option>{costCentres.map((item) => <option key={item.id} value={item.id}>{item.cost_centre_name ?? item.name}</option>)}</select></Field>
                      <Field label={`Process ${scope === "process" ? "*" : ""}`}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.processId ?? ""} disabled={!canEdit || scope !== "process"} onChange={(event) => updateLine(index, { attributionScope: "process", processId: event.target.value || null, costCentreId: null })}><option value="">Select process</option>{processes.map((item) => <option key={item.id} value={item.id}>{item.process_name ?? item.name}</option>)}</select></Field>
                      <Field label="Allocation driver *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.allocationDriver ?? ""} disabled={!canEdit} onChange={(event) => updateLine(index, { allocationDriver: event.target.value })}>{ALLOCATION_DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                      <Field label="Head *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.head} disabled={!canEdit || mastersQuery.isLoading} onChange={(event) => applyHead(index, event.target.value)}><option value="">Select Head</option>{activeMasters.map((entry) => <option key={entry.id} value={entry.headName}>{entry.headName}</option>)}</select></Field>
                      <Field label="Sub-head *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.subHead ?? ""} disabled={!canEdit || !line.head} onChange={(event) => applySubHead(index, event.target.value)}><option value="">Select Sub-head</option>{subHeads.map((entry) => <option key={entry.id} value={entry.subHeadName}>{entry.subHeadName}</option>)}</select></Field>
                      <Field label="Item / service *" span={2}><Input value={line.itemName} disabled={!canEdit} onChange={(event) => updateLine(index, { itemName: event.target.value })} /></Field>
                      <Field label="Description / specification *" span={2}><Textarea value={line.itemDescription ?? ""} disabled={!canEdit} onChange={(event) => updateLine(index, { itemDescription: event.target.value })} /></Field>
                      <Field label="Preferred vendor decision *" span={2}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.preferredVendorId ?? "_tbd"} disabled={!canEdit} onChange={(event) => updateLine(index, { preferredVendorId: event.target.value === "_tbd" ? null : event.target.value })}><option value="_tbd">Vendor to be finalized through approved Vendor Master</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}{vendor.vendor_name ?? vendor.name}</option>)}</select></Field>
                      <Field label="Quantity *"><Input type="number" min="0.0001" step="0.0001" value={line.quantity} disabled={!canEdit} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></Field>
                      <Field label="Unit *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.unit} disabled={!canEdit} onChange={(event) => updateLine(index, { unit: event.target.value })}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></Field>
                      <Field label="Unit rate *"><Input type="number" min="0" step="0.01" value={line.unitRate} disabled={!canEdit} onChange={(event) => updateLine(index, { unitRate: Number(event.target.value) })} /></Field>
                      <Field label="Tax treatment *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.taxTreatment} disabled={!canEdit} onChange={(event) => { const treatment = event.target.value as BranchBudgetLineInput["taxTreatment"]; updateLine(index, { taxTreatment: treatment, gstRate: ["exempt", "non_gst"].includes(treatment) ? 0 : line.gstRate, gstType: ["exempt", "non_gst"].includes(treatment) ? "none" : line.gstType, recoverableTaxPct: ["exempt", "non_gst"].includes(treatment) ? 0 : line.recoverableTaxPct }); }}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="exempt">Exempt</option><option value="reverse_charge">Reverse charge</option><option value="non_gst">Non-GST</option></select></Field>
                      <Field label="GST rate *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstRate} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { gstRate: Number(event.target.value) })}>{GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select></Field>
                      <Field label="GST type *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstType} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { gstType: event.target.value as BranchBudgetLineInput["gstType"] })}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="none">None</option></select></Field>
                      <Field label="Recoverable GST % *"><Input type="number" min="0" max="100" value={line.recoverableTaxPct} disabled={!canEdit || ["exempt", "non_gst"].includes(line.taxTreatment)} onChange={(event) => updateLine(index, { recoverableTaxPct: Number(event.target.value) })} /></Field>
                      <Field label="Business justification and quantity/rate basis *" span={4}><Textarea value={line.justification} disabled={!canEdit} onChange={(event) => updateLine(index, { justification: event.target.value })} /></Field>
                      <div className="grid gap-3 md:col-span-2 sm:grid-cols-4 xl:col-span-4"><Metric label="Without tax" value={money(amount.base)} /><Metric label="Tax" value={money(amount.tax)} tone="blue" /><Metric label="With tax" value={money(amount.gross)} tone="emerald" /><Metric label="P&L cost" value={money(amount.pnlCost)} tone="amber" /></div>
                    </CardContent>
                  </Card>
                );
              })}
              {capabilities?.canCreate && <Button variant="outline" className="w-full rounded-2xl border-dashed py-6" disabled={locked} onClick={() => setLines((current) => [...current, blankLine()])}><Plus className="mr-2 h-4 w-4" />Add budget line</Button>}
            </TabsContent>

            <TabsContent value="coverage" className="space-y-5">
              {!detailId ? <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><ClipboardCheck className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Save the budget draft first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div> : coverageQuery.isLoading ? <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="Completion" value={`${coverageQuery.data?.summary.completionPct ?? 0}%`} tone={coverageQuery.data?.summary.readyToSubmit ? "emerald" : "amber"} /><Metric label="All Sub-heads" value={String(coverageQuery.data?.summary.total ?? 0)} /><Metric label="Planned" value={String(coverageQuery.data?.summary.planned ?? 0)} tone="emerald" /><Metric label="Not planned" value={String(coverageQuery.data?.summary.notPlanned ?? 0)} tone="amber" /><Metric label="Not applicable" value={String(coverageQuery.data?.summary.notApplicable ?? 0)} /><Metric label="Incomplete" value={String(coverageQuery.data?.summary.incomplete ?? 0)} tone={(coverageQuery.data?.summary.incomplete ?? 0) ? "rose" : "emerald"} /></div>
                <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader className="border-b border-slate-100"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Complete Expense Catalogue</CardTitle><p className="mt-1 text-xs text-slate-500">Every active Sub-head requires a valid decision.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" value={coverageSearch} onChange={(event) => setCoverageSearch(event.target.value)} /></div>{capabilities?.canCreate && <Button onClick={() => void saveCoverageDecisions()} disabled={saveCoverage.isPending}><Save className="mr-2 h-4 w-4" />Save decisions</Button>}</div></div></CardHeader><CardContent className="space-y-3 p-4">{coverageGroups.map((group) => { const expanded = expandedHeads.has(group.id); const complete = group.items.every((item) => coverageDraft[item.expense_sub_head_id]?.status); return <div key={group.id} className="overflow-hidden rounded-2xl border border-slate-200"><button type="button" className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-left" onClick={() => setExpandedHeads((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><span className={`flex h-8 w-8 items-center justify-center rounded-full ${complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}</span><div className="flex-1"><p className="text-sm font-bold">{group.name}</p><p className="text-[10px] text-slate-500">{group.items.length} Sub-head(s)</p></div>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>{expanded && <div className="divide-y divide-slate-100">{group.items.map((item) => <CoverageDecision key={item.expense_sub_head_id} item={item} draft={coverageDraft[item.expense_sub_head_id] ?? { status: "", reason: "" }} editable={canEdit} onChange={(value) => setCoverageDraft((current) => ({ ...current, [item.expense_sub_head_id]: value }))} onAddLine={() => addFromCoverage(item)} />)}</div>}</div>; })}</CardContent></Card>
              </>}
            </TabsContent>

            <TabsContent value="approval"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Approval and utilization</CardTitle></CardHeader><CardContent className="space-y-4"><Input value={reviewRemarks} onChange={(event) => setReviewRemarks(event.target.value)} placeholder="Mandatory for rejection or revision" />{budgets.map((budget) => { const available = Number(budget.gross_budget_amount) - Number(budget.reserved_amount) - Number(budget.consumed_amount); return <div key={budget.id} className="grid gap-4 rounded-2xl border border-slate-200 p-4 xl:grid-cols-[1.2fr_1fr_1fr_auto]"><div><div className="flex gap-2"><p className="font-semibold">{budget.budget_number}</p><Badge variant="outline">{statusLabel(budget.status)}</Badge></div><p className="mt-1 text-xs text-slate-500">{budget.branch_name} · {budget.period_code} · Revision {budget.revision_no}</p></div><Metric label="Gross / P&L" value={`${money(Number(budget.gross_budget_amount))} / ${money(Number(budget.pnl_budget_amount))}`} /><Metric label="Reserved / Consumed / Available" value={`${money(Number(budget.reserved_amount))} / ${money(Number(budget.consumed_amount))} / ${money(available)}`} />{canReview(budget) && <div className="flex flex-wrap justify-end gap-2"><Button size="sm" onClick={() => void review(budget, "approve")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => void review(budget, "revision")}><Settings2 className="mr-1 h-3.5 w-3.5" />Revision</Button><Button size="sm" variant="destructive" onClick={() => void review(budget, "reject")}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></div>}</div>; })}{!budgets.length && <div className="py-12 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10" />No budget found.</div>}</CardContent></Card></TabsContent>

            <TabsContent value="master"><ExpenseMasterPanel masters={masters} canManage={Boolean(capabilities?.canManageExpenseMaster)} loading={mastersQuery.isLoading} onSaveHead={async (payload) => { await saveHead.mutateAsync(payload); toast.success("Expense Head saved"); }} onSaveSubHead={async (payload) => { await saveSubHead.mutateAsync(payload); toast.success("Expense Sub-head saved"); }} /></TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  const spanClass = span === 4 ? "md:col-span-2 xl:col-span-4" : span === 2 ? "xl:col-span-2" : "";
  return <div className={`space-y-2 ${spanClass}`}><Label>{label}</Label>{children}</div>;
}

function ExpenseMasterPanel({
  masters,
  canManage,
  loading,
  onSaveHead,
  onSaveSubHead,
}: {
  masters: FinanceExpenseHead[];
  canManage: boolean;
  loading: boolean;
  onSaveHead: (payload: { headName: string; headCode?: string; description?: string }) => Promise<void>;
  onSaveSubHead: (payload: { headId: string; subHeadName: string; defaultUnit: string; defaultTaxTreatment: BranchBudgetLineInput["taxTreatment"]; defaultGstRate: number; defaultGstType: NonNullable<BranchBudgetLineInput["gstType"]>; defaultRecoverableTaxPct: number; defaultAllocationDriver?: string | null; pnlTreatment: "operating_expense" }) => Promise<void>;
}) {
  const [headName, setHeadName] = useState("");
  const [headCode, setHeadCode] = useState("");
  const [subHead, setSubHead] = useState({
    headId: "",
    subHeadName: "",
    defaultUnit: "Unit",
    defaultTaxTreatment: "exclusive" as BranchBudgetLineInput["taxTreatment"],
    defaultGstRate: 18,
    defaultGstType: "cgst_sgst" as NonNullable<BranchBudgetLineInput["gstType"]>,
    defaultRecoverableTaxPct: 100,
    defaultAllocationDriver: "agent_headcount",
  });
  return (
    <div className={`grid gap-5 ${canManage ? "xl:grid-cols-[0.8fr_1.2fr]" : ""}`}>
      {canManage && <div className="space-y-5"><Card className="rounded-3xl"><CardHeader><CardTitle className="text-base">Add Expense Head</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={headName} onChange={(event) => setHeadName(event.target.value)} placeholder="Head name" /><Input value={headCode} onChange={(event) => setHeadCode(event.target.value)} placeholder="Head code" /><Button className="w-full" disabled={!headName.trim()} onClick={async () => { await onSaveHead({ headName, headCode: headCode || undefined }); setHeadName(""); setHeadCode(""); }}><Plus className="mr-2 h-4 w-4" />Save Head</Button></CardContent></Card><Card className="rounded-3xl"><CardHeader><CardTitle className="text-base">Add Expense Sub-head</CardTitle></CardHeader><CardContent className="space-y-3"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={subHead.headId} onChange={(event) => setSubHead((current) => ({ ...current, headId: event.target.value }))}><option value="">Select Head</option>{masters.map((head) => <option key={head.id} value={head.id}>{head.headName}</option>)}</select><Input value={subHead.subHeadName} onChange={(event) => setSubHead((current) => ({ ...current, subHeadName: event.target.value }))} placeholder="Sub-head name" /><Button className="w-full" disabled={!subHead.headId || !subHead.subHeadName.trim()} onClick={async () => { await onSaveSubHead({ ...subHead, pnlTreatment: "operating_expense" }); setSubHead((current) => ({ ...current, subHeadName: "" })); }}><Plus className="mr-2 h-4 w-4" />Save Sub-head</Button></CardContent></Card></div>}
      <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Current Head/Sub-head Master</CardTitle><p className="text-xs text-slate-500">{canManage ? "Editing enabled for Finance Head / Super Admin." : "Read-only directory."}</p></CardHeader><CardContent className="space-y-4">{loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div> : masters.map((head) => <div key={head.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between"><div><p className="font-semibold">{head.headName}</p><p className="text-xs text-slate-500">{head.headCode}</p></div><Badge>{head.activeStatus ? "Active" : "Inactive"}</Badge></div><div className="mt-3 grid gap-2 md:grid-cols-2">{head.subHeads.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-medium">{item.subHeadName}</p><p className="mt-1 text-xs text-slate-500">{item.defaultUnit} · {item.defaultTaxTreatment.replaceAll("_", " ")} · {item.defaultGstRate}%</p></div>)}</div></div>)}</CardContent></Card>
    </div>
  );
}
