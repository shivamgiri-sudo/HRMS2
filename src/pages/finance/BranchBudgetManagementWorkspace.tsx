import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  Grid3x3,
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
  TrendingUp,
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
  BRANCH_SHARING_METHODS,
  budgetLineRecordToInput,
  calculateBudgetLine,
  type BranchBudgetLineInput,
  type BranchBudgetSummary,
  type BudgetAttributionScope,
  type BudgetLineCorrectionInput,
  type BudgetLineCorrectionRecord,
  type CostCentreOption,
  type MonthlyDriverInput,
  useBranchBudgetAllocations,
  useBranchBudgetDetail,
  useBranchBudgetGradeDrivers,
  useBranchBudgetMeters,
  useBranchBudgets,
  useBudgetReadiness,
  useMeterReadings,
} from "@/hooks/useBranchBudget";
import {
  type BudgetCoverageEntry,
  type BudgetCoverageItem,
  type BudgetPlanningStatus,
  useBudgetCoverage,
} from "@/hooks/useBudgetCoverage";
import {
  type DeleteExpenseMasterResult,
  type FinanceExpenseHead,
  type FinanceExpenseSubHead,
  type SaveExpenseHeadPayload,
  type SaveExpenseSubHeadPayload,
  useFinanceExpenseMasters,
} from "@/hooks/useFinanceExpenseMasters";
import { hrmsApi } from "@/lib/hrmsApi";
import { BranchBudgetMatrixPanel } from "@/components/finance/pnl/BranchBudgetMatrixPanel";
import { BudgetTopupPanel } from "@/components/finance/budget/BudgetTopupPanel";
import { BranchBudgetImportDialog } from "@/components/finance/pnl/BranchBudgetImportDialog";
import { BranchBudgetPlannerGrid } from "@/components/finance/pnl/BranchBudgetPlannerGrid";

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

type WorkspaceTab = "plan" | "coverage" | "rollup" | "matrix" | "meters" | "readiness" | "approval" | "topups" | "master";
type CoverageDraft = Record<string, { status: BudgetPlanningStatus | ""; reason: string }>;
type BudgetCapabilities = {
  roles: string[];
  scopedBranchId: string | null;
  branchLocked: boolean;
  canCreate: boolean;
  canManageExpenseMaster: boolean;
  /** Super Admin only: rename, retire or delete an existing head/sub-head. */
  canEditExpenseMaster: boolean;
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
  canReviewAccountsStage: boolean;
};

/** The only statuses in which the plan builder may be edited; every later status is read-only
 *  until a reviewer sends the budget back for revision. Mirrors the backend guard in
 *  branch-budget.service.ts saveDraft() — 'submitted' is included because a branch admin
 *  correcting a mistake before Branch Head has actually acted on it should not have to wait for
 *  a reject/revision round trip first; saving pulls the budget back to 'draft' for
 *  re-submission rather than rewriting the version Branch Head may already be reviewing. */
const EDITABLE_BUDGET_STATUSES = ["draft", "revision_required", "submitted"];

/** Per-status copy for the banner above the Plan Builder — shown for every non-draft status so
 *  the branch admin always has a visible answer to "what state is this budget in right now,"
 *  not just once it becomes read-only. */
function budgetStatusBanner(status: string, budgetNumber: string | undefined) {
  switch (status) {
    case "submitted":
      return {
        tone: "border-blue-200 bg-blue-50 text-blue-900",
        message: `${budgetNumber} is Submitted — pending Branch Head review. You can still edit it; `
          + `saving will pull it back to Draft for re-submission.`,
      };
    case "revision_required":
      return {
        tone: "border-amber-200 bg-amber-50 text-amber-900",
        message: `${budgetNumber} was sent back for revision. Editing and saving will resubmit it.`,
      };
    case "branch_head_approved":
    case "finance_head_approved":
    case "accounts_head_approved":
    case "active":
      return {
        tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
        message: `${budgetNumber} is ${statusLabel(status)}. It is read-only until revision is requested.`,
      };
    default:
      return null;
  }
}

/** Whether a branch-common line spans the whole branch. An empty selection means "all", and so
 *  does an explicit selection naming every active cost centre — which is how a saved
 *  whole-branch line comes back, since its scope is derived from its allocation rows. */
function coversAllCostCentres(
  line: { includedCostCentreIds?: string[] | null },
  activeCount: number
) {
  const n = line.includedCostCentreIds?.length ?? 0;
  return n === 0 || n >= activeCount;
}

/** Identity a correction note is anchored to. Deliberately head/sub-head/item rather than line id:
 *  saving a draft replaces the whole line set with fresh ids, so a note keyed by id would come
 *  unstuck from its line the moment the branch admin saved the very fix it asked for. */
function correctionKey(line: { head?: string | null; subHead?: string | null; itemName?: string | null }) {
  return [line.head ?? "", line.subHead ?? "", line.itemName ?? ""]
    .map((part) => part.trim().toLowerCase())
    .join("||");
}

/** Same key from a persisted correction row, whose columns are snake_case. */
function correctionRecordKey(record: BudgetLineCorrectionRecord) {
  return correctionKey({
    head: record.head,
    subHead: record.sub_head,
    itemName: record.item_name,
  });
}

/** The month before a YYYY-MM period, for the prior-month comparison columns. */
function previousPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return "";
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
    planningLevel: "branch",
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
    allocationDriver: "equal_split",
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
  // A blocked GRN's "Request a budget increase" action deep-links here with
  // ?tab=topups&topupLine=<id>&branchId=<id>&period=<yyyy-mm>, pre-selecting everything
  // so the raiser doesn't have to re-find the exact line that blocked them.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<WorkspaceTab>(() => {
    const requested = searchParams.get("tab");
    return requested === "topups" ? "topups" : "plan";
  });
  const [period, setPeriod] = useState(() => searchParams.get("period") || currentPeriod());
  const [branchId, setBranchId] = useState(() => searchParams.get("branchId") || "");
  const [topupPresetLineId, setTopupPresetLineId] = useState(() => searchParams.get("topupLine") || "");
  const [lines, setLines] = useState<BranchBudgetLineInput[]>([blankLine()]);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [coverageDraft, setCoverageDraft] = useState<CoverageDraft>({});
  const [coverageSearch, setCoverageSearch] = useState("");
  const [expandedHeads, setExpandedHeads] = useState<Set<string>>(new Set());
  const [reviewRemarks, setReviewRemarks] = useState("");
  /** Reviewer's per head/sub-head correction notes, keyed by correctionKey(line). */
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  /** The table planner is the fast path and therefore the default; the card editor stays one click
   *  away for the fields the table has no room for. */
  const [plannerMode, setPlannerMode] = useState<"table" | "cards">("table");
  /** Snapshots of `lines` for Undo, and the last-saved set so "unsaved edits" counts real changes
   *  rather than every keystroke. */
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("[]");
  const [expandedGradeCostCentres, setExpandedGradeCostCentres] = useState<Set<string>>(new Set());
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saved">("idle");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const { budgetsQuery, saveBudget, submitBudget, reviewBudget, reviewerReviseBudget, deleteBudget } = useBranchBudgets({
    period,
    branchId: branchId || undefined,
  });
  const budgets = budgetsQuery.data ?? [];
  const currentBudget = budgets[0];
  const editableBudget = EDITABLE_BUDGET_STATUSES.includes(currentBudget?.status ?? "")
    ? currentBudget
    : undefined;
  // Fall back to the current budget even when it is not editable, so a reviewer can actually read the
  // lines they are approving. Every line editor is gated on canEdit, which stays false while locked,
  // so this loads the detail read-only rather than opening it for edit.
  const detailId = savedBudgetId ?? editableBudget?.id ?? currentBudget?.id ?? null;
  const detailQuery = useBranchBudgetDetail(detailId);
  // Last month's budget, for the Prev/Var columns and Copy-forward. Matched by head+sub-head NAME
  // because saveDraft replaces the line set with fresh UUIDs on every save.
  const priorPeriod = previousPeriod(period);
  const priorList = useBranchBudgets({ period: priorPeriod, branchId: branchId || undefined });
  const priorBudgetId = priorList.budgetsQuery.data?.[0]?.id ?? null;
  const priorDetail = useBranchBudgetDetail(priorBudgetId);
  const priorByKey = useMemo(() => {
    const map = new Map<string, number>();
    (priorDetail.data?.lines ?? []).forEach((l) => {
      const key = `${l.head}|${(l.sub_head ?? (l as any).subHead ?? "").toLowerCase()}`;
      map.set(key, (map.get(key) ?? 0) + Number(l.gross_amount ?? 0));
    });
    return map;
  }, [priorDetail.data]);
  const { coverageQuery, saveCoverage } = useBudgetCoverage(detailId);
  const { mastersQuery, saveHead, saveSubHead, deleteHead, deleteSubHead } =
    useFinanceExpenseMasters(Boolean(capabilities?.canManageExpenseMaster));
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
  const { costCentresQuery: activeCostCentresQuery, monthlyDriversQuery, saveMonthlyDrivers } =
    useBranchBudgetAllocations(branchId || null, period);
  const activeCostCentres = activeCostCentresQuery.data ?? [];
  const [driverDraft, setDriverDraft] = useState<Record<string, MonthlyDriverInput>>({});
  const readinessQuery = useBudgetReadiness(branchId || null, period);
  const readiness = readinessQuery.data ?? [];

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
    const detailLines = detailQuery.data.lines ?? [];
    setLines(
      detailLines.length
        ? detailLines.map(budgetLineRecordToInput)
        : [blankLine()]
    );
    setLoadedDetailId(detailQuery.data.id);
    setSavedSnapshot(JSON.stringify(detailLines.map(budgetLineRecordToInput)));
    setUndoStack([]);
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

  useEffect(() => {
    const drivers = monthlyDriversQuery.data ?? [];
    if (!drivers.length) return;
    setDriverDraft(
      Object.fromEntries(
        drivers.map((driver) => [
          driver.costCentreId,
          {
            costCentreId: driver.costCentreId,
            plannedHeadcount: driver.plannedHeadcount,
            revenueRatePerHead: driver.revenueRatePerHead,
            seatCount: driver.seatCount ?? 0,
            floorAreaSqft: driver.floorAreaSqft ?? 0,
            deviceCount: driver.deviceCount ?? 0,
            hiringVolume: driver.hiringVolume ?? 0,
            remarks: driver.remarks ?? "",
          },
        ])
      )
    );
  }, [monthlyDriversQuery.data]);

  async function saveDrivers() {
    try {
      await saveMonthlyDrivers.mutateAsync(Object.values(driverDraft));
      toast.success("Monthly drivers saved for this branch and period");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Monthly drivers could not be saved");
    }
  }

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

  // Lock on the status of the budget actually loaded in the builder. The previous form keyed off
  // "no savedBudgetId", which the detail-load effect always sets — so once reviewers began loading
  // the detail read-only, a submitted budget silently reported itself as unlocked.
  const builderStatus = detailQuery.data?.status ?? currentBudget?.status ?? "";
  const locked = Boolean(builderStatus) && !EDITABLE_BUDGET_STATUSES.includes(builderStatus);

  /** True when the signed-in user is the reviewer for the stage this budget is actually sitting at.
   *  Such a reviewer may correct the lines in place and annotate them, without the budget first
   *  having to travel back to the branch admin. */
  const canReviewCurrent = Boolean(currentBudget) && (
    builderStatus === "submitted"
      ? Boolean(capabilities?.canReviewBranchStage)
      : builderStatus === "branch_head_approved"
        ? Boolean(capabilities?.canReviewFinanceStage)
        : builderStatus === "finance_head_approved"
          ? Boolean(capabilities?.canReviewAccountsStage)
          : false
  );
  /** Monthly drivers and coverage stay with the branch admin who owns the plan; a reviewer's
   *  in-place edit is scoped to the budget lines themselves. */
  const canEditDrivers = Boolean(capabilities?.canCreate) && !locked;
  const canEdit = canEditDrivers || canReviewCurrent;

  /** Unresolved correction notes grouped by the head/sub-head/item they were raised against. */
  const openCorrectionsByKey = useMemo(() => {
    const map = new Map<string, BudgetLineCorrectionRecord[]>();
    for (const record of detailQuery.data?.corrections ?? []) {
      if (record.resolved_at) continue;
      const key = correctionRecordKey(record);
      map.set(key, [...(map.get(key) ?? []), record]);
    }
    return map;
  }, [detailQuery.data?.corrections]);

  const openCorrectionsFor = (line: BranchBudgetLineInput) =>
    openCorrectionsByKey.get(correctionKey(line)) ?? [];
  const openCorrectionCount = [...openCorrectionsByKey.values()].reduce(
    (total, group) => total + group.length,
    0
  );
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

  /** Keep the last 50 states so Undo can step back without holding the whole session. */
  function pushUndo() {
    setUndoStack((stack) => [...stack, JSON.stringify(lines)].slice(-50));
  }

  /** Lines that differ from what was last saved — a real change count, not a keystroke count. */
  const dirtyCount = useMemo(() => {
    let saved: BranchBudgetLineInput[] = [];
    try { saved = JSON.parse(savedSnapshot); } catch { saved = []; }
    const key = (l: BranchBudgetLineInput) => JSON.stringify([
      l.head, l.subHead, l.itemDescription, l.quantity, l.unitRate, l.unit,
      l.allocationDriver, l.planningLevel, l.costCentreId, l.includedCostCentreIds, l.manualAllocations,
    ]);
    const before = new Map<string, number>();
    saved.forEach((l) => before.set(key(l), (before.get(key(l)) ?? 0) + 1));
    let changed = 0;
    lines.forEach((l) => {
      const k = key(l);
      const n = before.get(k) ?? 0;
      if (n > 0) before.set(k, n - 1); else changed++;
    });
    return changed;
  }, [lines, savedSnapshot]);

  // Auto-save: 3-second debounce after any line edit, only when a draft already exists.
  useEffect(() => {
    if (!canEdit || !savedBudgetId || dirtyCount === 0 || saveBudget.isPending) return;
    setAutoSaveStatus("pending");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void save(false).then(() => setAutoSaveStatus("saved"));
      setTimeout(() => setAutoSaveStatus("idle"), 3000);
    }, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  /** Edits that reshape a line rather than nudge a number. Undo snapshots these, so one Undo steps
   *  back a whole decision instead of a single keystroke. */
  const STRUCTURAL_FIELDS = new Set([
    "allocationDriver", "planningLevel", "attributionScope", "costCentreId",
    "includedCostCentreIds", "manualAllocations", "head", "subHead", "unit",
  ]);

  function updateLine(index: number, patch: Partial<BranchBudgetLineInput>) {
    if (Object.keys(patch).some((key) => STRUCTURAL_FIELDS.has(key))) pushUndo();
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function setScope(index: number, scope: BudgetAttributionScope) {
    const line = lines[index];
    const isBranchShared = BRANCH_SHARING_METHODS.some((method) => method.value === line.allocationDriver);
    updateLine(index, {
      attributionScope: scope,
      planningLevel: scope === "branch_common" ? "branch" : "cost_centre",
      costCentreId: scope === "cost_centre" ? line.costCentreId : null,
      processId: scope === "process" ? line.processId : null,
      allocationDriver: scope === "branch_common" && !isBranchShared ? "equal_split" : line.allocationDriver,
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
      if (scope === "branch_common" && line.allocationDriver === "manual") {
        const total = (line.manualAllocations ?? []).reduce((sum, entry) => sum + Number(entry.percentage || 0), 0);
        if (Math.abs(total - 100) > 0.01) {
          throw new Error(`${label}: Manual cost-centre split must total 100% (currently ${total.toFixed(2)}%)`);
        }
      }
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
      // The save is now the baseline: nothing is "unsaved" until the next edit.
      setSavedSnapshot(JSON.stringify(lines));
      setUndoStack([]);
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

  /** Notes the reviewer has typed against individual lines, ready to travel with a Revision. */
  function collectLineCorrections(): BudgetLineCorrectionInput[] {
    return lines
      .map((line) => ({
        lineId: line.id ?? null,
        head: line.head,
        subHead: line.subHead ?? null,
        itemName: line.itemName ?? null,
        note: (correctionNotes[correctionKey(line)] ?? "").trim(),
      }))
      .filter((entry) => entry.note && entry.head?.trim());
  }

  async function review(budget: BranchBudgetSummary, decision: "approve" | "reject" | "revision") {
    try {
      if (decision !== "approve" && !reviewRemarks.trim()) throw new Error("Remarks are mandatory");
      const lineCorrections = decision === "revision" ? collectLineCorrections() : undefined;
      if (decision === "revision" && !lineCorrections?.length) {
        throw new Error(
          "Add a correction note against at least one head/sub-head on the Plan Builder tab, so the branch admin knows exactly what to fix"
        );
      }
      await reviewBudget.mutateAsync({
        id: budget.id,
        decision,
        remarks: reviewRemarks.trim() || undefined,
        lineCorrections,
      });
      toast.success(
        decision === "approve"
          ? "Budget advanced"
          : decision === "revision"
            ? `Sent back to branch admin with ${lineCorrections?.length} correction note(s)`
            : "Budget decision recorded"
      );
      setReviewRemarks("");
      setCorrectionNotes({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Budget review failed");
    }
  }

  /** Super-admin removal. The server decides between a true delete and a supersede based on
   *  whether any GRN has consumed against the budget, and says which it did. */
  async function removeBudget(budget: BranchBudgetSummary) {
    const reason = window.prompt(
      `Delete ${budget.budget_number}?

If any GRN has consumed against it, it will be closed instead of deleted so the spend history survives.

Reason:`
    );
    if (!reason?.trim()) return;
    try {
      const result = await deleteBudget.mutateAsync({ id: budget.id, reason: reason.trim() });
      toast.success(result.message);
      setSavedBudgetId(null);
      setLoadedDetailId(null);
      setLines([blankLine()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the budget");
    }
  }

  /** A reviewer correcting the lines themselves rather than sending the budget back. The budget
   *  stays at this reviewer's stage: they still have to Approve it afterwards. */
  async function saveReviewerEdit() {
    const budgetId = currentBudget?.id;
    if (!budgetId) return;
    try {
      if (!reviewRemarks.trim()) {
        throw new Error("Enter a reason for the edit in the remarks box on the Approval tab");
      }
      await reviewerReviseBudget.mutateAsync({
        id: budgetId,
        lines,
        reason: reviewRemarks.trim(),
      });
      toast.success("Budget lines corrected — approve to send it to the next stage");
      setReviewRemarks("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the correction");
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
                  {capabilities?.canCreate && <><Button onClick={() => void save(false)} disabled={saveBudget.isPending || locked}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => void save(true)} disabled={saveBudget.isPending || locked}><Send className="mr-2 h-4 w-4" />Submit to Branch Head</Button>{autoSaveStatus === "pending" && <span className="flex items-center gap-1 text-xs text-slate-300"><Loader2 className="h-3 w-3 animate-spin" />Auto-saving…</span>}{autoSaveStatus === "saved" && <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" />Saved</span>}</>}
                  {/* The stage reviewer can correct the lines in place instead of bouncing the whole
                      budget back. The budget does not move: they still have to Approve. */}
                  {canReviewCurrent && <Button onClick={() => void saveReviewerEdit()} disabled={reviewerReviseBudget.isPending}><Save className="mr-2 h-4 w-4" />Save my corrections</Button>}
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
              <TabsTrigger value="rollup"><Layers3 className="mr-2 h-4 w-4" />Cost-Centre Rollup</TabsTrigger>
              <TabsTrigger value="matrix"><Grid3x3 className="mr-2 h-4 w-4" />Grid Matrix</TabsTrigger>
              <TabsTrigger value="meters"><Gauge className="mr-2 h-4 w-4" />Meters</TabsTrigger>
              <TabsTrigger value="readiness"><AlertTriangle className="mr-2 h-4 w-4" />Exceptions & Readiness</TabsTrigger>
              <TabsTrigger value="approval"><ShieldCheck className="mr-2 h-4 w-4" />Approval & Utilization</TabsTrigger>
              <TabsTrigger value="topups"><TrendingUp className="mr-2 h-4 w-4" />Top-up Requests</TabsTrigger>
              <TabsTrigger value="master"><Settings2 className="mr-2 h-4 w-4" />Expense Master</TabsTrigger>
            </TabsList>

            <TabsContent value="plan" className="space-y-5">
              {/* Period and branch are navigation, not creation: reviewers (branch/finance/accounts head)
                  have canCreate=false, so gating these on canCreate stranded them on the current month
                  and they could never reach the budget awaiting their approval. Branch stays pinned for
                  branch-scoped roles via branchLocked, which the backend enforces independently. */}
              {/* Compacted: three tall stacked blocks became one inline row. This is a context
                  selector, not a form to fill in, so it should not occupy a card's worth of height
                  above the grid that actually does the work. */}
              <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex flex-wrap items-end gap-3 p-3 [&_input]:h-9 [&_input]:min-h-0 [&_input]:py-1 [&_select]:h-9 [&_label]:text-xs [&_label]:text-slate-500"><div className="w-40 space-y-1"><Label>Period *</Label><Input type="month" value={period} onChange={(event) => { setPeriod(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }} /></div><div className="w-56 space-y-1"><Label>{capabilities?.branchLocked ? "Assigned branch" : "Branch *"}</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:bg-slate-100" value={branchId} disabled={Boolean(capabilities?.branchLocked)} onChange={(event) => { setBranchId(event.target.value); setSavedBudgetId(null); setLoadedDetailId(null); }}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}</select></div><div className="w-32 space-y-1"><Label>Financial year</Label><Input value={financialYear(period)} readOnly /></div></CardContent></Card>
              {(() => {
                const banner = budgetStatusBanner(currentBudget?.status ?? "", currentBudget?.budget_number);
                return banner && <div className={`rounded-2xl border p-4 text-sm ${banner.tone}`}>{banner.message}</div>;
              })()}
              {/* The table planner carries the drivers as its own pinned band, so showing this card
                  as well put the same seven editable rows on screen twice. */}
              {branchId && plannerMode === "cards" && (
                <Card className="rounded-3xl border-slate-200 shadow-sm">
                  <CardHeader className="border-b border-slate-100 bg-slate-50/70"><CardTitle className="text-base">Monthly drivers — {period}</CardTitle><p className="mt-1 text-xs text-slate-500">The per-cost-centre quantities every branch-common sharing method divides by. A method throws if its own driver is missing, so fill the column for the methods this branch actually uses.</p></CardHeader>
                  <CardContent className="space-y-3 p-5">
                    {activeCostCentresQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !activeCostCentres.length ? <p className="text-sm text-slate-500">This branch has no active cost centres yet.</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">Cost centre</th><th className="py-2 pr-3">Planned headcount</th><th className="py-2 pr-3">Revenue rate / head</th><th className="py-2 pr-3">Seats</th><th className="py-2 pr-3">Floor area (sq ft)</th><th className="py-2 pr-3">Devices</th><th className="py-2 pr-3">Hiring volume</th><th className="py-2 pr-3">Calculated planned revenue</th><th className="py-2 pr-3">Grade breakdown</th></tr></thead>
                          <tbody>
                            {activeCostCentres.map((cc) => {
                              const draft = driverDraft[cc.id] ?? { costCentreId: cc.id, plannedHeadcount: 0, revenueRatePerHead: 0, remarks: "" };
                              const calculatedRevenue = Number(draft.plannedHeadcount || 0) * Number(draft.revenueRatePerHead || 0);
                              const expanded = expandedGradeCostCentres.has(cc.id);
                              return (
                                <Fragment key={cc.id}>
                                  <tr className="border-b border-slate-100 last:border-0">
                                    <td className="py-2 pr-3 font-medium text-slate-700">{cc.costCentreName}</td>
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="1" className="h-9 w-28" disabled={!canEditDrivers} value={draft.plannedHeadcount} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, plannedHeadcount: Number(event.target.value) } }))} /></td>
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="0.01" className="h-9 w-32" disabled={!canEditDrivers} value={draft.revenueRatePerHead} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, revenueRatePerHead: Number(event.target.value) } }))} /></td>
                                    {/* Drivers for the four methods enabled by migration 434. Without a column here the
                                        method could be selected but never satisfied, so it would always throw on save. */}
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="1" className="h-9 w-24" disabled={!canEditDrivers} value={draft.seatCount ?? 0} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, seatCount: Number(event.target.value) } }))} /></td>
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="1" className="h-9 w-28" disabled={!canEditDrivers} value={draft.floorAreaSqft ?? 0} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, floorAreaSqft: Number(event.target.value) } }))} /></td>
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="1" className="h-9 w-24" disabled={!canEditDrivers} value={draft.deviceCount ?? 0} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, deviceCount: Number(event.target.value) } }))} /></td>
                                    <td className="py-2 pr-3"><Input type="number" min="0" step="1" className="h-9 w-24" disabled={!canEditDrivers} value={draft.hiringVolume ?? 0} onChange={(event) => setDriverDraft((current) => ({ ...current, [cc.id]: { ...draft, hiringVolume: Number(event.target.value) } }))} /></td>
                                    <td className="py-2 pr-3 text-slate-600">{money(calculatedRevenue)}</td>
                                    <td className="py-2 pr-3">
                                      <Button type="button" size="sm" variant="ghost" onClick={() => setExpandedGradeCostCentres((current) => { const next = new Set(current); if (next.has(cc.id)) next.delete(cc.id); else next.add(cc.id); return next; })}>
                                        {expanded ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}Grades
                                      </Button>
                                    </td>
                                  </tr>
                                  {expanded && (
                                    <tr className="border-b border-slate-100 last:border-0 bg-slate-50/40">
                                      <td colSpan={5} className="p-3">
                                        <GradeBreakdownPanel branchId={branchId} costCentreId={cc.id} period={period} canEdit={canEditDrivers} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {canEditDrivers && Boolean(activeCostCentres.length) && <Button size="sm" variant="outline" disabled={saveMonthlyDrivers.isPending} onClick={() => void saveDrivers()}>{saveMonthlyDrivers.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save monthly drivers</Button>}
                  </CardContent>
                </Card>
              )}
              {/* Two ways to plan the same lines. The table is the fast path — rows are
                  head/sub-head, columns are cost centres — and the card editor stays for the
                  fields the table has no room for (vendor, justification, cost-centre scope). */}
              {branchId && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entry mode</span>
                  <div className="flex overflow-hidden rounded-lg border border-slate-300">
                    <button type="button" onClick={() => setPlannerMode("table")}
                      className={`px-3 py-1.5 text-xs font-medium ${plannerMode === "table" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                      Table planner
                    </button>
                    <button type="button" onClick={() => setPlannerMode("cards")}
                      className={`border-l border-slate-300 px-3 py-1.5 text-xs font-medium ${plannerMode === "cards" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                      Detailed line editor
                    </button>
                  </div>
                  <span className="text-xs text-slate-500">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
                </div>
              )}

              {plannerMode === "table" && branchId && !(detailQuery.isLoading && detailId) && (
                <BranchBudgetPlannerGrid
                  lines={lines}
                  masters={masters}
                  costCentres={activeCostCentres}
                  drivers={driverDraft}
                  canEdit={canEdit}
                  period={period}
                  onUpdateLine={updateLine}
                  onRemoveLine={(index) => { pushUndo(); setLines((current) => current.filter((_, i) => i !== index)); }}
                  onAddLine={(head, subHead, unit, method) => { pushUndo(); setLines((current) => [
                    ...current,
                    blankLine({
                      head, subHead, unit,
                      planningLevel: "branch",
                      allocationDriver: method,
                      itemName: subHead,
                      // The plan is non-taxable, so a new line starts that way instead of
                      // inheriting an 18% default the branch would have to clear on every row.
                      taxTreatment: "non_gst", gstRate: 0, gstType: "none", recoverableTaxPct: 0,
                      justification: `${subHead} for ${period}`,
                    }),
                  ]); }}
                  priorByKey={priorByKey}
                  priorLabel={priorPeriod ? new Date(`${priorPeriod}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }) : undefined}
                  dirtyCount={dirtyCount}
                  canUndo={undoStack.length > 0}
                  onUndo={() => setUndoStack((stack) => {
                    if (!stack.length) return stack;
                    setLines(JSON.parse(stack[stack.length - 1]));
                    return stack.slice(0, -1);
                  })}
                  onCopyForward={() => {
                    pushUndo();
                    setLines((current) => current.map((l) => {
                      const prior = priorByKey.get(`${l.head}|${(l.subHead ?? "").toLowerCase()}`) ?? 0;
                      const already = (Number(l.quantity) || 0) * (Number(l.unitRate) || 0);
                      // Only fill what is still empty — never overwrite a figure already planned.
                      return prior > 0 && already === 0 ? { ...l, quantity: 1, unitRate: prior } : l;
                    }));
                  }}
                  onSaveDrivers={() => void saveDrivers()}
                  onSaveDraft={() => void save(false)}
                  saving={saveBudget.isPending || saveMonthlyDrivers.isPending}
                  onDriverChange={(costCentreId, key, value) => setDriverDraft((current) => {
                    const existing = current[costCentreId] ?? { costCentreId, plannedHeadcount: 0, revenueRatePerHead: 0 };
                    return { ...current, [costCentreId]: { ...existing, [key]: value } };
                  })}
                />
              )}

              {plannerMode === "cards" && (detailQuery.isLoading && detailId ? <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : lines.map((line, index) => {
                const scope = scopeOf(line);
                const head = activeMasters.find((entry) => entry.headName === line.head);
                const subHeads = head?.subHeads.filter((entry) => entry.activeStatus) ?? [];
                const amount = calculateBudgetLine(line);
                const openNotes = openCorrectionsFor(line);
                return (
                  <Card key={line.id ?? index} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
                    <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 bg-slate-50/70"><div><CardTitle className="text-base">Budget line {index + 1}</CardTitle><p className="mt-1 text-xs text-slate-500">All factual, commercial, allocation and tax fields are mandatory.</p></div><Button variant="ghost" size="icon" disabled={!canEdit || lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4 text-rose-500" /></Button></CardHeader>
                    {/* Corrections a reviewer raised against this exact head/sub-head, so the branch
                        admin fixing the budget sees the instruction on the line it belongs to. */}
                    {Boolean(openNotes.length) && (
                      <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
                          <AlertTriangle className="h-3.5 w-3.5" />Correction requested
                        </p>
                        {openNotes.map((note) => (
                          <p key={note.id} className="mt-1.5 text-sm text-amber-900">
                            {note.correction_note}
                            <span className="ml-2 text-xs text-amber-700">
                              — {note.raised_by_name?.trim() || statusLabel(note.raised_by_role)}
                              {note.raised_by_name?.trim() ? ` (${statusLabel(note.raised_by_role)})` : ""}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                    {/* The reviewer at this budget's current stage annotates the lines they want
                        changed; the notes travel with the Revision decision. */}
                    {canReviewCurrent && (
                      <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-3">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Correction note for {line.head || "this head"}{line.subHead ? ` / ${line.subHead}` : ""}
                        </Label>
                        <Textarea
                          className="mt-1.5 bg-white"
                          rows={2}
                          placeholder="Leave blank if this line is fine. Anything written here is sent to the branch admin with a Revision decision."
                          value={correctionNotes[correctionKey(line)] ?? ""}
                          onChange={(event) => setCorrectionNotes((current) => ({
                            ...current,
                            [correctionKey(line)]: event.target.value,
                          }))}
                        />
                      </div>
                    )}
                    <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Attribution scope *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={scope} disabled={!canEdit} onChange={(event) => setScope(index, event.target.value as BudgetAttributionScope)}><option value="branch_common">Branch common</option><option value="cost_centre">Direct to cost centre</option><option value="process">Direct to process</option></select></Field>
                      <Field label={`Cost centre ${scope === "cost_centre" ? "*" : ""}`}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.costCentreId ?? ""} disabled={!canEdit || scope !== "cost_centre"} onChange={(event) => { const selected = costCentres.find((item) => item.id === event.target.value); updateLine(index, { attributionScope: "cost_centre", costCentreId: event.target.value || null, processId: selected?.process_id ?? null }); }}><option value="">Select cost centre</option>{costCentres.map((item) => <option key={item.id} value={item.id}>{item.cost_centre_name ?? item.name}</option>)}</select></Field>
                      <Field label={`Process ${scope === "process" ? "*" : ""}`}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.processId ?? ""} disabled={!canEdit || scope !== "process"} onChange={(event) => updateLine(index, { attributionScope: "process", processId: event.target.value || null, costCentreId: null })}><option value="">Select process</option>{processes.map((item) => <option key={item.id} value={item.id}>{item.process_name ?? item.name}</option>)}</select></Field>
                      <Field label={scope === "branch_common" ? "Sharing method *" : "Allocation driver *"}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.allocationDriver ?? ""} disabled={!canEdit} onChange={(event) => updateLine(index, { allocationDriver: event.target.value })}>{scope === "branch_common" ? BRANCH_SHARING_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>) : ALLOCATION_DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                      {/* Cost-centre scope. A branch-common line used to always hit every active
                          cost centre, so excluding one meant a manual split giving it 0%. Real
                          costs are often partial — one floor's air conditioning, two processes'
                          courier spend. Empty selection means the whole branch, preserving the
                          previous behaviour for every existing line. */}
                      {scope === "branch_common" && (
                        <Field label="Applies to cost centres" span={2}>
                          <div className="rounded-md border border-input bg-background p-2">
                            <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-500">
                              {/* A saved line derives its scope from its allocation rows, so a
                                  whole-branch line arrives as an explicit list of every cost
                                  centre. That is the same thing as "all" and must read that way. */}
                              <span>{coversAllCostCentres(line, activeCostCentres.length) ? `All ${activeCostCentres.length} cost centres` : `${line.includedCostCentreIds!.length} of ${activeCostCentres.length} selected`}</span>
                              {!coversAllCostCentres(line, activeCostCentres.length) && canEdit && (
                                <button type="button" className="text-blue-700 underline" onClick={() => updateLine(index, { includedCostCentreIds: null })}>Use all</button>
                              )}
                            </div>
                            <div className="flex max-h-28 flex-wrap gap-x-4 gap-y-1 overflow-auto">
                              {activeCostCentres.map((cc) => {
                                const selected = line.includedCostCentreIds ?? [];
                                const on = selected.length === 0 || selected.includes(cc.id);
                                return (
                                  <label key={cc.id} className="flex items-center gap-1.5 text-xs text-slate-700">
                                    <input
                                      type="checkbox"
                                      disabled={!canEdit}
                                      checked={on}
                                      onChange={(event) => {
                                        // An empty list means "all", so the first unticking has to
                                        // materialise the full set before removing one from it.
                                        const base = selected.length ? selected : activeCostCentres.map((item) => item.id);
                                        const next = event.target.checked
                                          ? [...new Set([...base, cc.id])]
                                          : base.filter((id) => id !== cc.id);
                                        updateLine(index, {
                                          includedCostCentreIds: next.length === activeCostCentres.length ? null : next,
                                        });
                                      }}
                                    />
                                    {cc.costCentreName}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </Field>
                      )}
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
                      {scope === "branch_common" && line.allocationDriver === "manual" && Boolean(activeCostCentres.length) && (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:col-span-2 xl:col-span-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual cost-centre split % (must total 100%)</p>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {activeCostCentres.map((cc) => {
                              const existing = line.manualAllocations?.find((entry) => entry.costCentreId === cc.id);
                              return (
                                <div key={cc.id} className="flex items-center gap-2">
                                  <span className="flex-1 truncate text-sm text-slate-600">{cc.costCentreName}</span>
                                  <Input type="number" min="0" max="100" step="0.01" className="h-9 w-24" disabled={!canEdit} value={existing?.percentage ?? 0} onChange={(event) => {
                                    const percentage = Number(event.target.value);
                                    const rest = (line.manualAllocations ?? []).filter((entry) => entry.costCentreId !== cc.id);
                                    updateLine(index, { manualAllocations: [...rest, { costCentreId: cc.id, percentage }] });
                                  }} />
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Total: {(line.manualAllocations ?? []).reduce((sum, entry) => sum + Number(entry.percentage || 0), 0)}%</p>
                        </div>
                      )}
                      {scope === "branch_common" && (() => {
                        const savedLine = detailQuery.data?.lines.find((record) => record.id === line.id);
                        const allocations = savedLine?.allocations;
                        if (!allocations?.length) return null;
                        return (
                          <div className="md:col-span-2 xl:col-span-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Computed cost-centre allocation (last saved)</p>
                            <div className="overflow-x-auto rounded-2xl border border-slate-200">
                              <table className="w-full min-w-[560px] text-sm">
                                <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 px-3">Cost centre</th><th className="py-2 px-3">Share %</th><th className="py-2 px-3">With tax</th><th className="py-2 px-3">P&L cost</th></tr></thead>
                                <tbody>
                                  {allocations.map((row) => (
                                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                                      <td className="py-2 px-3">{row.cost_centre_name}</td>
                                      <td className="py-2 px-3">{Number(row.allocation_percentage).toFixed(2)}%</td>
                                      <td className="py-2 px-3">{money(Number(row.gross_amount))}</td>
                                      <td className="py-2 px-3">{money(Number(row.pnl_cost_amount))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                );
              }))}
              {capabilities?.canCreate && (
                <div className="flex flex-col gap-3 sm:flex-row">
                  {plannerMode === "cards" && <Button variant="outline" className="flex-1 rounded-2xl border-dashed py-6" disabled={locked} onClick={() => setLines((current) => [...current, blankLine()])}><Plus className="mr-2 h-4 w-4" />Add budget line</Button>}
                  <Button variant="outline" className="flex-1 rounded-2xl border-dashed py-6" disabled={locked} onClick={() => setImportDialogOpen(true)}><FileSpreadsheet className="mr-2 h-4 w-4" />Import from Excel</Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="coverage" className="space-y-5">
              {!detailId ? <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><ClipboardCheck className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Save the budget draft first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div> : coverageQuery.isLoading ? <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="Completion" value={`${coverageQuery.data?.summary.completionPct ?? 0}%`} tone={coverageQuery.data?.summary.readyToSubmit ? "emerald" : "amber"} /><Metric label="All Sub-heads" value={String(coverageQuery.data?.summary.total ?? 0)} /><Metric label="Planned" value={String(coverageQuery.data?.summary.planned ?? 0)} tone="emerald" /><Metric label="Not planned" value={String(coverageQuery.data?.summary.notPlanned ?? 0)} tone="amber" /><Metric label="Not applicable" value={String(coverageQuery.data?.summary.notApplicable ?? 0)} /><Metric label="Incomplete" value={String(coverageQuery.data?.summary.incomplete ?? 0)} tone={(coverageQuery.data?.summary.incomplete ?? 0) ? "rose" : "emerald"} /></div>
                <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader className="border-b border-slate-100"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Complete Expense Catalogue</CardTitle><p className="mt-1 text-xs text-slate-500">Every active Sub-head requires a valid decision.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" value={coverageSearch} onChange={(event) => setCoverageSearch(event.target.value)} /></div>{capabilities?.canCreate && <Button onClick={() => void saveCoverageDecisions()} disabled={saveCoverage.isPending}><Save className="mr-2 h-4 w-4" />Save decisions</Button>}</div></div></CardHeader><CardContent className="space-y-3 p-4">{coverageGroups.map((group) => { const expanded = expandedHeads.has(group.id); const complete = group.items.every((item) => coverageDraft[item.expense_sub_head_id]?.status); return <div key={group.id} className="overflow-hidden rounded-2xl border border-slate-200"><button type="button" className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-left" onClick={() => setExpandedHeads((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><span className={`flex h-8 w-8 items-center justify-center rounded-full ${complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}</span><div className="flex-1"><p className="text-sm font-bold">{group.name}</p><p className="text-[10px] text-slate-500">{group.items.length} Sub-head(s)</p></div>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>{expanded && <div className="divide-y divide-slate-100">{group.items.map((item) => <CoverageDecision key={item.expense_sub_head_id} item={item} draft={coverageDraft[item.expense_sub_head_id] ?? { status: "", reason: "" }} editable={canEdit} onChange={(value) => setCoverageDraft((current) => ({ ...current, [item.expense_sub_head_id]: value }))} onAddLine={() => addFromCoverage(item)} />)}</div>}</div>; })}</CardContent></Card>
              </>}
            </TabsContent>

            <TabsContent value="rollup" className="space-y-5">
              {!detailId ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><Layers3 className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Save the budget draft first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div>
              ) : detailQuery.isLoading ? (
                <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : !detailQuery.data?.costCentreConsolidation.length ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No "Direct to cost centre" lines yet — cost-centre-first items planned separately per cost centre will roll up here automatically once added.</div>
              ) : (
                <Card className="rounded-3xl border-slate-200 shadow-sm">
                  <CardHeader className="border-b border-slate-100"><CardTitle>Cost-centre-first consolidation</CardTitle><p className="mt-1 text-xs text-slate-500">Items planned independently per cost centre (Attribution scope = "Direct to cost centre"), rolled up to a branch total. Branch fields here are derived, not editable — edit the underlying lines in Plan Builder.</p></CardHeader>
                  <CardContent className="space-y-3 p-4">
                    {detailQuery.data.costCentreConsolidation.map((group, index) => (
                      <div key={`${group.head}-${group.subHead}-${group.itemName}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                          <div>
                            <p className="text-sm font-bold">{group.itemName}</p>
                            <p className="text-[10px] text-slate-500">{group.head}{group.subHead ? ` / ${group.subHead}` : ""} · {group.costCentreCount} cost centre(s)</p>
                          </div>
                          <div className="flex items-center gap-4">
                            {!group.unitConsistent && <Badge variant="destructive" className="text-[10px]">Mixed units — verify before relying on Branch unit</Badge>}
                            <Metric label={`Branch unit (${group.unit})`} value={String(group.branchUnit)} />
                            <Metric label="Branch amount" value={money(group.branchGrossAmount)} tone="emerald" />
                            <Metric label="Branch P&L cost" value={money(group.branchPnlCostAmount)} tone="amber" />
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[520px] text-sm">
                            <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-2">Cost centre</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">With tax</th><th className="px-4 py-2">P&L cost</th></tr></thead>
                            <tbody>
                              {group.lines.map((ccLine) => (
                                <tr key={ccLine.costCentreId} className="border-b border-slate-100 last:border-0">
                                  <td className="px-4 py-2">{ccLine.costCentreName ?? ccLine.costCentreId}</td>
                                  <td className="px-4 py-2">{ccLine.quantity}</td>
                                  <td className="px-4 py-2">{money(ccLine.grossAmount)}</td>
                                  <td className="px-4 py-2">{money(ccLine.pnlCostAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="matrix" className="space-y-5">
              {!detailId ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><Grid3x3 className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Save the budget draft first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div>
              ) : detailQuery.isLoading ? (
                <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>
              ) : (
                <BranchBudgetMatrixPanel lines={detailQuery.data?.lines ?? []} costCentres={activeCostCentres} />
              )}
            </TabsContent>

            <TabsContent value="meters" className="space-y-5">
              {!branchId ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><Gauge className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Select a branch first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div>
              ) : (
                <MetersPanel branchId={branchId} costCentres={activeCostCentres} period={period} canEdit={canEdit} />
              )}
            </TabsContent>

            <TabsContent value="readiness" className="space-y-5">
              {!branchId ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-10 text-center"><AlertTriangle className="mx-auto h-10 w-10 text-blue-700" /><p className="mt-3 font-bold text-blue-950">Select a branch first</p><Button className="mt-4" onClick={() => setTab("plan")}>Open Plan Builder</Button></div>
              ) : (
                <>
                  <Card className="rounded-3xl border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                      <CardTitle className="text-base">Sharing-method readiness — {period}</CardTitle>
                      <p className="mt-1 text-xs text-slate-500">Whether each weighted sharing method has complete driver data for every active cost centre right now — checked before you pick a method, not just when you hit save.</p>
                    </CardHeader>
                    <CardContent className="space-y-3 p-5">
                      {readinessQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <div className="space-y-3">
                          {readiness.map((r) => (
                            <div key={r.method} className={`rounded-2xl border p-4 ${r.ready ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
                              <div className="flex items-center gap-2">
                                {r.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                                <p className="text-sm font-semibold text-slate-900">{r.label}</p>
                                <Badge variant="outline" className={r.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                                  {r.ready ? "Ready" : "Incomplete"}
                                </Badge>
                              </div>
                              {!r.ready && r.missingCostCentres.length > 0 && (
                                <p className="mt-2 text-xs text-slate-600">Missing for: {r.missingCostCentres.map((c) => c.name).join(", ")}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-3xl border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                      <CardTitle className="text-base">Exceptions — current budget</CardTitle>
                      <p className="mt-1 text-xs text-slate-500">Branch-common lines whose sharing method now has missing driver data, or manual splits that no longer total 100%. Read-only — nothing is blocked.</p>
                    </CardHeader>
                    <CardContent className="p-5">
                      {!detailId ? (
                        <p className="text-sm text-slate-500">Save the budget draft first to check its lines for exceptions.</p>
                      ) : detailQuery.isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : !detailQuery.data?.exceptions.length ? (
                        <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No exceptions found for this budget.</p>
                      ) : (
                        <div className="space-y-2">
                          {detailQuery.data.exceptions.map((exception) => (
                            <div key={exception.lineId} className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                              <p className="text-sm font-semibold text-rose-900">{exception.itemName}</p>
                              <p className="mt-1 text-xs text-rose-700">{exception.message}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="approval"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Approval and utilization</CardTitle></CardHeader><CardContent className="space-y-4"><Input value={reviewRemarks} onChange={(event) => setReviewRemarks(event.target.value)} placeholder="Mandatory for rejection or revision" />
              {canReviewCurrent && <p className="text-xs text-slate-500">Revision also needs a correction note against at least one head/sub-head — add those on the <span className="font-medium">Plan Builder</span> tab, where you can also correct the lines yourself and then approve.</p>}
              {Boolean(openCorrectionCount) && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">{openCorrectionCount} open correction note(s)</span> against this budget. Each one is shown on its own budget line in the Plan Builder tab.</div>}
              {budgets.map((budget) => { const available = Number(budget.gross_budget_amount) - Number(budget.reserved_amount) - Number(budget.consumed_amount); return <div key={budget.id} className="grid gap-4 rounded-2xl border border-slate-200 p-4 xl:grid-cols-[1.2fr_1fr_1fr_auto]"><div><div className="flex gap-2"><p className="font-semibold">{budget.budget_number}</p><Badge variant="outline">{statusLabel(budget.status)}</Badge></div><p className="mt-1 text-xs text-slate-500">{budget.branch_name} · {budget.period_code} · Revision {budget.revision_no}</p></div><Metric label="Gross / P&L" value={`${money(Number(budget.gross_budget_amount))} / ${money(Number(budget.pnl_budget_amount))}`} /><Metric label="Reserved / Consumed / Available" value={`${money(Number(budget.reserved_amount))} / ${money(Number(budget.consumed_amount))} / ${money(available)}`} />{canReview(budget) && <div className="flex flex-wrap justify-end gap-2"><Button size="sm" onClick={() => void review(budget, "approve")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => void review(budget, "revision")}><Settings2 className="mr-1 h-3.5 w-3.5" />Revision</Button><Button size="sm" variant="destructive" onClick={() => void review(budget, "reject")}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></div>}
                {capabilities?.roles?.includes("super_admin") && <div className="flex justify-end xl:col-span-4"><Button size="sm" variant="outline" className="border-rose-300 text-rose-700 hover:bg-rose-50" disabled={deleteBudget.isPending} onClick={() => void removeBudget(budget)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete / supersede (super admin)</Button></div>}</div>; })}{!budgets.length && <div className="py-12 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10" />No budget found.</div>}</CardContent></Card></TabsContent>

            <TabsContent value="topups">
              {branchId ? (
                <BudgetTopupPanel
                  branchId={branchId}
                  period={period}
                  canCreate
                  canReview={Boolean(capabilities?.canReviewBranchStage || capabilities?.canReviewFinanceStage)}
                  presetLineId={topupPresetLineId || null}
                  onConsumedPreset={() => setTopupPresetLineId("")}
                />
              ) : (
                <div className="py-12 text-center text-slate-500">
                  <Building2 className="mx-auto mb-3 h-10 w-10" />Select a branch first.
                </div>
              )}
            </TabsContent>

            <TabsContent value="master">
              <ExpenseMasterPanel
                masters={masters}
                canManage={Boolean(capabilities?.canManageExpenseMaster)}
                canEdit={Boolean(capabilities?.canEditExpenseMaster)}
                loading={mastersQuery.isLoading}
                busy={saveHead.isPending || saveSubHead.isPending || deleteHead.isPending || deleteSubHead.isPending}
                onSaveHead={async (payload) => { await saveHead.mutateAsync(payload); toast.success("Expense Head saved"); }}
                onSaveSubHead={async (payload) => { await saveSubHead.mutateAsync(payload); toast.success("Expense Sub-head saved"); }}
                onDeleteHead={async (head) => {
                  const subHeadNote = head.subHeads.length ? ` and its ${head.subHeads.length} sub-head(s)` : "";
                  if (!window.confirm(`Delete "${head.headName}"${subHeadNote}?\n\nIf any budget line, GRN or coverage review already uses it, it is retired (set inactive) instead of removed so the history stays readable.`)) return;
                  const result = await deleteHead.mutateAsync(head.id);
                  reportExpenseMasterDelete("Head", result);
                  setLines((prev) => prev.filter((l) => l.head !== head.headName));
                }}
                onDeleteSubHead={async (_head, item) => {
                  if (!window.confirm(`Delete sub-head "${item.subHeadName}"?\n\nIf any budget line, GRN or coverage review already uses it, it is retired (set inactive) instead of removed so the history stays readable.`)) return;
                  const result = await deleteSubHead.mutateAsync(item.id);
                  reportExpenseMasterDelete("Sub-head", result);
                  setLines((prev) => prev.filter((l) => !(l.head === _head.headName && l.subHead === item.subHeadName)));
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <BranchBudgetImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        costCentres={costCentres.map((item: any) => ({ id: item.id, code: item.cost_centre_code, name: item.cost_centre_name ?? item.name }))}
        processes={processes.map((item: any) => ({ id: item.id, code: item.process_code, name: item.process_name ?? item.name }))}
        vendors={vendors.map((item: any) => ({ id: item.id, code: item.vendor_code, name: item.vendor_name ?? item.name }))}
        onImport={(newLines) => {
          setLines((current) => [...current, ...newLines]);
          setTab("plan");
        }}
      />
    </DashboardLayout>
  );
}

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  const spanClass = span === 4 ? "md:col-span-2 xl:col-span-4" : span === 2 ? "xl:col-span-2" : "";
  return <div className={`space-y-2 ${spanClass}`}><Label>{label}</Label>{children}</div>;
}

const METER_READING_UNITS = ["kWh", "Unit", "KL", "Cu. M.", "Litre"];

function MetersPanel({
  branchId,
  costCentres,
  period,
  canEdit,
}: {
  branchId: string;
  costCentres: CostCentreOption[];
  period: string;
  canEdit: boolean;
}) {
  const { metersQuery, createMeter } = useBranchBudgetMeters(branchId);
  const meters = metersQuery.data ?? [];
  const [newMeter, setNewMeter] = useState({
    costCentreId: "",
    meterCode: "",
    meterName: "",
    location: "",
    readingUnit: "kWh",
    fixedRate: 0,
  });

  async function addMeter() {
    try {
      if (!newMeter.costCentreId) throw new Error("Cost centre is mandatory");
      if (!newMeter.meterCode.trim() || !newMeter.meterName.trim()) throw new Error("Meter code and name are mandatory");
      await createMeter.mutateAsync({
        costCentreId: newMeter.costCentreId,
        meterCode: newMeter.meterCode.trim(),
        meterName: newMeter.meterName.trim(),
        location: newMeter.location.trim() || null,
        readingUnit: newMeter.readingUnit,
        fixedRate: Number(newMeter.fixedRate),
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
      setNewMeter({ costCentreId: "", meterCode: "", meterName: "", location: "", readingUnit: "kWh", fixedRate: 0 });
      toast.success("Meter added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Meter could not be added");
    }
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70"><CardTitle className="text-base">Add meter</CardTitle><p className="mt-1 text-xs text-slate-500">Registers a utility meter against a cost centre. Its consumption feeds the "Meter-wise" sharing method for branch-common lines.</p></CardHeader>
          <CardContent className="grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Cost centre *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newMeter.costCentreId} onChange={(event) => setNewMeter((current) => ({ ...current, costCentreId: event.target.value }))}><option value="">Select cost centre</option>{costCentres.map((cc) => <option key={cc.id} value={cc.id}>{cc.costCentreName}</option>)}</select></Field>
            <Field label="Meter code *"><Input value={newMeter.meterCode} onChange={(event) => setNewMeter((current) => ({ ...current, meterCode: event.target.value }))} /></Field>
            <Field label="Meter name *"><Input value={newMeter.meterName} onChange={(event) => setNewMeter((current) => ({ ...current, meterName: event.target.value }))} /></Field>
            <Field label="Location"><Input value={newMeter.location} onChange={(event) => setNewMeter((current) => ({ ...current, location: event.target.value }))} /></Field>
            <Field label="Reading unit"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={newMeter.readingUnit} onChange={(event) => setNewMeter((current) => ({ ...current, readingUnit: event.target.value }))}>{METER_READING_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></Field>
            <Field label="Fixed rate / unit *"><Input type="number" min="0" step="0.01" value={newMeter.fixedRate} onChange={(event) => setNewMeter((current) => ({ ...current, fixedRate: Number(event.target.value) }))} /></Field>
            <div className="md:col-span-3 xl:col-span-6"><Button size="sm" disabled={createMeter.isPending} onClick={() => void addMeter()}>{createMeter.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add meter</Button></div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70"><CardTitle className="text-base">Meters and readings — {period}</CardTitle><p className="mt-1 text-xs text-slate-500">Enter opening/closing readings per meter for this period. An Estimated reading requires a method and reason; a later Actual reading is reconciled against it automatically, not overwritten.</p></CardHeader>
        <CardContent className="space-y-3 p-5">
          {metersQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !meters.length ? (
            <p className="text-sm text-slate-500">No meters registered for this branch yet.</p>
          ) : (
            <div className="space-y-3">
              {meters.map((meter) => (
                <MeterReadingRow key={meter.id} meter={meter} costCentres={costCentres} period={period} canEdit={canEdit} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MeterReadingRow({
  meter,
  costCentres,
  period,
  canEdit,
}: {
  meter: { id: string; meterCode: string; meterName: string; costCentreId: string; readingUnit: string; fixedRate: number };
  costCentres: CostCentreOption[];
  period: string;
  canEdit: boolean;
}) {
  // branchId omitted deliberately — this row only needs the saveReading mutation, and passing no
  // branchId keeps this component from re-querying the whole branch's meter list per row.
  const { saveReading } = useBranchBudgetMeters(undefined);
  const readingsQuery = useMeterReadings(meter.id, period);
  const readings = readingsQuery.data ?? [];
  const actual = readings.find((row) => row.readingType === "actual");
  const estimated = readings.find((row) => row.readingType === "estimated");
  const costCentreName = costCentres.find((cc) => cc.id === meter.costCentreId)?.costCentreName ?? meter.costCentreId;

  const [draft, setDraft] = useState({
    readingType: "actual" as "actual" | "estimated",
    openingReading: 0,
    closingReading: 0,
    estimationMethod: "",
    estimationReason: "",
  });
  const [editing, setEditing] = useState(false);

  function startEditing(existing?: typeof actual) {
    setDraft({
      readingType: existing?.readingType ?? "actual",
      openingReading: existing?.openingReading ?? 0,
      closingReading: existing?.closingReading ?? 0,
      estimationMethod: existing?.estimationMethod ?? "",
      estimationReason: existing?.estimationReason ?? "",
    });
    setEditing(true);
  }

  async function submit() {
    try {
      const result = await saveReading.mutateAsync({
        meterId: meter.id,
        periodCode: period,
        openingReading: Number(draft.openingReading),
        closingReading: Number(draft.closingReading),
        readingType: draft.readingType,
        estimationMethod: draft.readingType === "estimated" ? draft.estimationMethod : null,
        estimationReason: draft.readingType === "estimated" ? draft.estimationReason : null,
      });
      setEditing(false);
      toast.success(result.reconciliation ? "Reading saved — reconciled against the earlier estimate" : "Reading saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reading could not be saved");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-bold">{meter.meterName} <span className="font-normal text-slate-500">({meter.meterCode})</span></p>
          <p className="text-[10px] text-slate-500">{costCentreName} · {meter.readingUnit} · Rate {money(meter.fixedRate)}/unit</p>
        </div>
        {canEdit && !editing && <Button size="sm" variant="outline" onClick={() => startEditing(actual ?? estimated)}>Enter reading</Button>}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Actual</p>
          {actual ? (
            <p className="mt-1 text-sm text-slate-700">{actual.openingReading} → {actual.closingReading} = {actual.consumption} {meter.readingUnit} · {money(actual.amount)}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Not recorded yet</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Estimated</p>
          {estimated ? (
            <p className="mt-1 text-sm text-slate-700">{estimated.openingReading} → {estimated.closingReading} = {estimated.consumption} {meter.readingUnit} · {money(estimated.amount)} {estimated.reconciliationStatus === "reconciled" && <Badge variant="outline" className="ml-1 text-[10px]">Reconciled</Badge>}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Not recorded yet</p>
          )}
        </div>
      </div>
      {editing && (
        <div className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Reading type *"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.readingType} onChange={(event) => setDraft((current) => ({ ...current, readingType: event.target.value as "actual" | "estimated" }))}><option value="actual">Actual</option><option value="estimated">Estimated</option></select></Field>
          <Field label="Opening reading *"><Input type="number" min="0" step="0.0001" value={draft.openingReading} onChange={(event) => setDraft((current) => ({ ...current, openingReading: Number(event.target.value) }))} /></Field>
          <Field label="Closing reading *"><Input type="number" min="0" step="0.0001" value={draft.closingReading} onChange={(event) => setDraft((current) => ({ ...current, closingReading: Number(event.target.value) }))} /></Field>
          {draft.readingType === "estimated" && (
            <>
              <Field label="Estimation method *"><Input value={draft.estimationMethod} onChange={(event) => setDraft((current) => ({ ...current, estimationMethod: event.target.value }))} placeholder="e.g. Prior month average" /></Field>
              <Field label="Estimation reason *"><Input value={draft.estimationReason} onChange={(event) => setDraft((current) => ({ ...current, estimationReason: event.target.value }))} placeholder="e.g. Meter faulty" /></Field>
            </>
          )}
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={saveReading.isPending} onClick={() => void submit()}>{saveReading.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GradeBreakdownPanel({
  branchId,
  costCentreId,
  period,
  canEdit,
}: {
  branchId: string;
  costCentreId: string;
  period: string;
  canEdit: boolean;
}) {
  const { gradeDriversQuery, saveGradeDrivers } = useBranchBudgetGradeDrivers(branchId, costCentreId, period);
  const grades = gradeDriversQuery.data ?? [];
  const [draft, setDraft] = useState<Record<string, number>>({});

  const headcountFor = (gradeId: string, fallback: number) => draft[gradeId] ?? fallback;
  const totalHeadcount = grades.reduce((sum, g) => sum + headcountFor(g.gradeId, g.plannedHeadcount), 0);
  const totalCost = grades.reduce((sum, g) => {
    const monthlyPerHead = g.plannedHeadcount > 0 ? g.monthlyCost / g.plannedHeadcount : (g.minCtc + g.maxCtc) / 2 / 12;
    return sum + headcountFor(g.gradeId, g.plannedHeadcount) * monthlyPerHead;
  }, 0);

  async function save() {
    try {
      const drivers = grades.map((g) => ({ gradeId: g.gradeId, plannedHeadcount: headcountFor(g.gradeId, g.plannedHeadcount) }));
      await saveGradeDrivers.mutateAsync(drivers);
      setDraft({});
      toast.success("Grade drivers saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Grade drivers could not be saved");
    }
  }

  if (gradeDriversQuery.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!grades.length) return <p className="text-xs text-slate-500">No active grade bands are configured (Org Masters &gt; Grade Bands).</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-xs">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Grade</th><th className="px-3 py-2">Band</th><th className="px-3 py-2">Avg CTC/month</th><th className="px-3 py-2">Planned headcount</th><th className="px-3 py-2">Cost</th></tr></thead>
          <tbody>
            {grades.map((g) => {
              const avgMonthlyCtc = (g.minCtc + g.maxCtc) / 2 / 12;
              const headcount = headcountFor(g.gradeId, g.plannedHeadcount);
              return (
                <tr key={g.gradeId} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-slate-700">{g.gradeName}</td>
                  <td className="px-3 py-1.5 text-slate-500">{g.band ?? "-"}</td>
                  <td className="px-3 py-1.5 text-slate-600">{money(avgMonthlyCtc)}</td>
                  <td className="px-3 py-1.5"><Input type="number" min="0" step="0.5" className="h-8 w-24" disabled={!canEdit} value={headcount} onChange={(event) => setDraft((current) => ({ ...current, [g.gradeId]: Number(event.target.value) }))} /></td>
                  <td className="px-3 py-1.5 text-slate-600">{money(headcount * avgMonthlyCtc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Total: {totalHeadcount} head(s) · {money(totalCost)}/month blended cost</p>
      {canEdit && <Button type="button" size="sm" variant="outline" disabled={saveGradeDrivers.isPending} onClick={() => void save()}>{saveGradeDrivers.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save grade drivers</Button>}
    </div>
  );
}

/**
 * Say which of the two things the server did. A retire is not a failed delete — it is the only safe
 * outcome once a budget line, GRN or coverage review names the entry — so the toast has to name the
 * records that forced it, or the user just retries and sees the same "still there" result.
 */
function reportExpenseMasterDelete(label: string, result: DeleteExpenseMasterResult) {
  if (result.removed) {
    toast.success(`${label} "${result.name}" deleted`);
    return;
  }
  const used = [
    result.usage.budgetLines ? `${result.usage.budgetLines} budget line(s)` : "",
    result.usage.grns ? `${result.usage.grns} GRN(s)` : "",
    result.usage.coverageReviews ? `${result.usage.coverageReviews} coverage review(s)` : "",
  ].filter(Boolean).join(", ");
  toast.success(`${label} "${result.name}" retired`, {
    description: `${used} still reference it, so it was set inactive instead of removed. It no longer appears in the planner or any picker.`,
  });
}

type SubHeadDraft = {
  subHeadName: string;
  defaultUnit: string;
  defaultTaxTreatment: BranchBudgetLineInput["taxTreatment"];
  defaultGstRate: number;
  defaultGstType: NonNullable<BranchBudgetLineInput["gstType"]>;
  defaultRecoverableTaxPct: number;
  defaultAllocationDriver: string;
};

const TAX_TREATMENTS: BranchBudgetLineInput["taxTreatment"][] = [
  "exclusive",
  "inclusive",
  "exempt",
  "reverse_charge",
  "non_gst",
];

const NEW_SUB_HEAD: SubHeadDraft = {
  subHeadName: "",
  defaultUnit: "Unit",
  defaultTaxTreatment: "exclusive",
  defaultGstRate: 18,
  defaultGstType: "cgst_sgst",
  defaultRecoverableTaxPct: 100,
  defaultAllocationDriver: "agent_headcount",
};

const draftFromSubHead = (item: FinanceExpenseSubHead): SubHeadDraft => ({
  subHeadName: item.subHeadName,
  defaultUnit: item.defaultUnit,
  defaultTaxTreatment: item.defaultTaxTreatment,
  defaultGstRate: item.defaultGstRate,
  defaultGstType: item.defaultGstType,
  defaultRecoverableTaxPct: item.defaultRecoverableTaxPct,
  defaultAllocationDriver: item.defaultAllocationDriver ?? "agent_headcount",
});

/** The sub-head form, shared by "add under this head" and "edit this sub-head". */
function SubHeadForm({
  draft,
  saving,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: SubHeadDraft;
  saving: boolean;
  submitLabel: string;
  onChange: (next: SubHeadDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof SubHeadDraft>(key: K, value: SubHeadDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const field = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
      <Input
        className="h-9"
        value={draft.subHeadName}
        placeholder="Sub-head name"
        onChange={(event) => set("subHeadName", event.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] text-slate-500">
          Default unit
          <select className={field} value={draft.defaultUnit} onChange={(event) => set("defaultUnit", event.target.value)}>
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          Tax treatment
          <select className={field} value={draft.defaultTaxTreatment} onChange={(event) => set("defaultTaxTreatment", event.target.value as SubHeadDraft["defaultTaxTreatment"])}>
            {TAX_TREATMENTS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          GST rate
          <select className={field} value={draft.defaultGstRate} onChange={(event) => set("defaultGstRate", Number(event.target.value))}>
            {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          GST type
          <select className={field} value={draft.defaultGstType} onChange={(event) => set("defaultGstType", event.target.value as SubHeadDraft["defaultGstType"])}>
            <option value="cgst_sgst">CGST + SGST</option>
            <option value="igst">IGST</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          Recoverable GST %
          <Input className="h-9" type="number" min="0" max="100" value={draft.defaultRecoverableTaxPct}
            onChange={(event) => set("defaultRecoverableTaxPct", Number(event.target.value))} />
        </label>
        <label className="space-y-1 text-[11px] text-slate-500">
          Default sharing
          <select className={field} value={draft.defaultAllocationDriver} onChange={(event) => set("defaultAllocationDriver", event.target.value)}>
            {ALLOCATION_DRIVERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!draft.subHeadName.trim() || saving} onClick={onSubmit}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function ExpenseMasterPanel({
  masters,
  canManage,
  canEdit,
  loading,
  busy,
  onSaveHead,
  onSaveSubHead,
  onDeleteHead,
  onDeleteSubHead,
}: {
  masters: FinanceExpenseHead[];
  /** Finance Head or Super Admin: may add new heads and sub-heads. */
  canManage: boolean;
  /** Super Admin only: may rename, restore or delete what already exists. */
  canEdit: boolean;
  loading: boolean;
  busy: boolean;
  onSaveHead: (payload: SaveExpenseHeadPayload) => Promise<void>;
  onSaveSubHead: (payload: SaveExpenseSubHeadPayload) => Promise<void>;
  onDeleteHead: (head: FinanceExpenseHead) => Promise<void>;
  onDeleteSubHead: (head: FinanceExpenseHead, subHead: FinanceExpenseSubHead) => Promise<void>;
}) {
  const [headName, setHeadName] = useState("");
  const [headCode, setHeadCode] = useState("");
  const [subHead, setSubHead] = useState<SubHeadDraft & { headId: string }>({
    ...NEW_SUB_HEAD,
    headId: "",
  });
  /** Which head is being renamed inline, and the values being typed. */
  const [editingHead, setEditingHead] = useState<{ id: string; headName: string; headCode: string } | null>(null);
  /** Which sub-head is being edited inline, or which head is having one added. */
  const [editingSubHead, setEditingSubHead] = useState<{ id: string; headId: string; draft: SubHeadDraft } | null>(null);
  const [addingUnderHead, setAddingUnderHead] = useState<{ headId: string; draft: SubHeadDraft } | null>(null);

  return (
    <div className={`grid gap-5 ${canManage ? "xl:grid-cols-[0.8fr_1.2fr]" : ""}`}>
      {canManage && (
        <div className="space-y-5">
          <Card className="rounded-3xl">
            <CardHeader><CardTitle className="text-base">Add Expense Head</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input value={headName} onChange={(event) => setHeadName(event.target.value)} placeholder="Head name" />
              <Input value={headCode} onChange={(event) => setHeadCode(event.target.value)} placeholder="Head code" />
              <Button className="w-full" disabled={!headName.trim() || busy}
                onClick={async () => { await onSaveHead({ headName, headCode: headCode || undefined }); setHeadName(""); setHeadCode(""); }}>
                <Plus className="mr-2 h-4 w-4" />Save Head
              </Button>
            </CardContent>
          </Card>
          <Card className="rounded-3xl">
            <CardHeader><CardTitle className="text-base">Add Expense Sub-head</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHead.headId} onChange={(event) => setSubHead((current) => ({ ...current, headId: event.target.value }))}>
                <option value="">Select Head</option>
                {masters.map((head) => <option key={head.id} value={head.id}>{head.headName}</option>)}
              </select>
              <Input value={subHead.subHeadName} placeholder="Sub-head name"
                onChange={(event) => setSubHead((current) => ({ ...current, subHeadName: event.target.value }))} />
              <Button className="w-full" disabled={!subHead.headId || !subHead.subHeadName.trim() || busy}
                onClick={async () => { await onSaveSubHead({ ...subHead, pnlTreatment: "operating_expense" }); setSubHead((current) => ({ ...current, subHeadName: "" })); }}>
                <Plus className="mr-2 h-4 w-4" />Save Sub-head
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Current Head/Sub-head Master</CardTitle>
          <p className="text-xs text-slate-500">
            {canEdit
              ? "Super Admin: edit, add a sub-head or delete. A head or sub-head that budgets already use is retired instead of removed, so the history stays readable."
              : canManage
                ? "Finance Head: add new heads and sub-heads. Editing and deleting existing entries is Super Admin only."
                : "Read-only directory."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div> : masters.map((head) => (
            <div key={head.id} className={`rounded-2xl border p-4 ${head.activeStatus ? "border-slate-200" : "border-amber-200 bg-amber-50/40"}`}>
              {editingHead?.id === head.id ? (
                <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                  <Input className="h-9" value={editingHead.headName} placeholder="Head name"
                    onChange={(event) => setEditingHead({ ...editingHead, headName: event.target.value })} />
                  <Input className="h-9" value={editingHead.headCode} placeholder="Head code"
                    onChange={(event) => setEditingHead({ ...editingHead, headCode: event.target.value })} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!editingHead.headName.trim() || busy}
                      onClick={async () => {
                        await onSaveHead({
                          id: head.id,
                          headName: editingHead.headName,
                          headCode: editingHead.headCode || undefined,
                          description: head.description,
                          displayOrder: head.displayOrder,
                          activeStatus: head.activeStatus,
                        });
                        setEditingHead(null);
                      }}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save head
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingHead(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{head.headName}</p>
                    <p className="text-xs text-slate-500">{head.headCode}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{head.activeStatus ? "Active" : "Inactive"}</Badge>
                    {canEdit && (
                      <>
                        <Button size="sm" variant="outline" className="h-8"
                          onClick={() => { setEditingHead({ id: head.id, headName: head.headName, headCode: head.headCode }); setEditingSubHead(null); setAddingUnderHead(null); }}>
                          <Settings2 className="mr-1.5 h-3.5 w-3.5" />Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-8"
                          onClick={() => { setAddingUnderHead({ headId: head.id, draft: { ...NEW_SUB_HEAD } }); setEditingSubHead(null); setEditingHead(null); }}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />Sub-head
                        </Button>
                        {!head.activeStatus && (
                          <Button size="sm" variant="outline" className="h-8" disabled={busy}
                            onClick={() => void onSaveHead({
                              id: head.id,
                              headName: head.headName,
                              headCode: head.headCode,
                              description: head.description,
                              displayOrder: head.displayOrder,
                              activeStatus: true,
                            })}>
                            Restore
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50" disabled={busy}
                          aria-label={`Delete ${head.headName}`}
                          onClick={() => void onDeleteHead(head)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {addingUnderHead?.headId === head.id && (
                <div className="mt-3">
                  <SubHeadForm
                    draft={addingUnderHead.draft}
                    saving={busy}
                    submitLabel="Add sub-head"
                    onChange={(draft) => setAddingUnderHead({ headId: head.id, draft })}
                    onCancel={() => setAddingUnderHead(null)}
                    onSubmit={async () => {
                      await onSaveSubHead({ headId: head.id, ...addingUnderHead.draft, pnlTreatment: "operating_expense" });
                      setAddingUnderHead(null);
                    }}
                  />
                </div>
              )}

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {head.subHeads.map((item) => (
                  editingSubHead?.id === item.id ? (
                    <div key={item.id} className="md:col-span-2">
                      <SubHeadForm
                        draft={editingSubHead.draft}
                        saving={busy}
                        submitLabel="Save sub-head"
                        onChange={(draft) => setEditingSubHead({ ...editingSubHead, draft })}
                        onCancel={() => setEditingSubHead(null)}
                        onSubmit={async () => {
                          await onSaveSubHead({
                            id: item.id,
                            headId: head.id,
                            ...editingSubHead.draft,
                            pnlTreatment: item.pnlTreatment,
                            displayOrder: item.displayOrder,
                            activeStatus: item.activeStatus,
                          });
                          setEditingSubHead(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div key={item.id} className={`flex items-start justify-between gap-2 rounded-xl p-3 ${item.activeStatus ? "bg-slate-50" : "bg-amber-50"}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.subHeadName}{!item.activeStatus && <span className="ml-2 text-[10px] uppercase text-amber-700">inactive</span>}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.defaultUnit} · {item.defaultTaxTreatment.replaceAll("_", " ")} · {item.defaultGstRate}%</p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Edit ${item.subHeadName}`}
                            onClick={() => { setEditingSubHead({ id: item.id, headId: head.id, draft: draftFromSubHead(item) }); setAddingUnderHead(null); setEditingHead(null); }}>
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                          {!item.activeStatus && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy}
                              aria-label={`Restore ${item.subHeadName}`}
                              onClick={() => void onSaveSubHead({
                                id: item.id,
                                headId: head.id,
                                ...draftFromSubHead(item),
                                pnlTreatment: item.pnlTreatment,
                                displayOrder: item.displayOrder,
                                activeStatus: true,
                              })}>
                              Restore
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-700 hover:bg-rose-50" disabled={busy}
                            aria-label={`Delete ${item.subHeadName}`}
                            onClick={() => void onDeleteSubHead(head, item)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
