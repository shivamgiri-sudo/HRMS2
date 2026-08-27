// src/components/finance/budget/BudgetTopupPanel.tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, PlusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { useBranchBudgetAllocations, type CostCentreOption } from "@/hooks/useBranchBudget";
import { toast } from "sonner";

export type BudgetTopupRequest = {
  id: string;
  budget_line_id: string;
  status: "submitted" | "branch_head_approved" | "finance_head_approved" | "rejected" | "applied";
  requested_amount: number;
  requested_quantity: number;
  reason: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  budget_number: string;
  branch_name: string | null;
  /** The month this increase applies to. A top-up carries no period of its own — it is always
   *  the parent budget header's period_code, which the list endpoint now returns. */
  period_code: string | null;
  branch_head_reviewed_by: string | null;
  finance_head_reviewed_by: string | null;
  /** Stage timestamps + notes. All four columns have existed on finance_budget_topup_request
   *  since 1061, and list() has always returned them under `t.*` — they were simply never
   *  declared here, so the row could show a single end-state Badge and nothing about the two
   *  approvals that produced it. The per-stage track reads these. */
  branch_head_reviewed_at: string | null;
  branch_head_review_note: string | null;
  finance_head_reviewed_at: string | null;
  finance_head_review_note: string | null;
  applied_at: string | null;
  /** Joined in budget-topup.service.ts list() alongside requested_by_name — the *_reviewed_by
   *  columns themselves are user_ids and must never be rendered. Null when the reviewer's
   *  user_id has no employees row. */
  branch_head_reviewed_by_name: string | null;
  finance_head_reviewed_by_name: string | null;
  /** Unit economics of the request, already selected by list() (COALESCE of the line's rate and
   *  the request's own, for a new-line request). Shown as the qty × rate sub-line under the
   *  amount so a reviewer can sanity-check the number without opening the line. */
  unit_rate: number | null;
  unit: string | null;
  rejection_reason: string | null;
  created_at: string;
  requested_by: string | null;
  /** Joined in budget-topup.service.ts list() — who actually raised this request, for display. */
  requested_by_name: string | null;
  /** Added by decorateTopup() server-side — who the request is waiting on, derived from status,
   *  never stored. Used by the Variance tab's "Top-up status" column. */
  pending_with_role: string | null;
  pending_with: string;
  is_pending: boolean;
};

/** A row from GET /pnl/budget-lines/available. The headroom column is `available_gross_amount`
 *  — that is the alias branchBudgetService.availableLines() gives it. Reading it as
 *  `available_amount` (the name vendor-expense-mapping.service.ts uses for its own, unrelated
 *  aggregate) is not a type error on an untyped JSON row: it just printed "available ₹0.00"
 *  against every line, so a fully funded budget looked like an empty one. */
type AvailableLine = {
  id: string;
  head: string;
  sub_head: string | null;
  item_name: string;
  unit_rate: number;
  available_quantity: number;
  available_gross_amount: number;
  /** Group D: availableLines() selects `l.*`, which already carries this — it was simply never
   *  declared on this type before there was a reason to read it. Every line returned for a given
   *  branch+period belongs to the same budget header, so any line in the list can stand in for
   *  "the current budget's id" when a new-line request needs one. */
  budget_id?: string;
};

/** Group D: one row of a top-up's cost-centre split. Quantity is deliberately not a field here —
 *  it is only ever derived (amount / unitRate) at submit time, in the mutation, the same way this
 *  file already derives requestedQuantity/additionalQuantity for the line as a whole. */
export type TopupSplitRow = { key: string; costCentreId: string; amount: string };

function blankSplitRow(): TopupSplitRow {
  return { key: crypto.randomUUID(), costCentreId: "", amount: "" };
}

/** A rupee or two of float slop, not exact-to-the-paisa — same tolerance style
 *  budget-topup.service.ts's own validateCostCentreSplits() applies server-side. */
export const SPLIT_AMOUNT_TOLERANCE = 1;

/**
 * Client-side fast-feedback check on a top-up's cost-centre split, mirroring (but not replacing)
 * budget-topup.service.ts's validateCostCentreSplits(): every row needs a cost centre and a
 * positive amount, no cost centre may appear twice (mirrors the DB's own
 * UNIQUE(topup_request_id, cost_centre_id)), and the rows must sum to the request's own top-level
 * amount. The server remains authoritative — this only saves a round trip on the common mistakes.
 */
export function validateTopupSplits(
  rows: TopupSplitRow[],
  requestedAmountNumber: number
): { ok: true; sum: number } | { ok: false; message: string; sum: number } {
  if (!rows.length) {
    return { ok: false, message: "Add at least one cost-centre split", sum: 0 };
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const row of rows) {
    if (!row.costCentreId) {
      return { ok: false, message: "Every split row needs a cost centre selected", sum };
    }
    if (seen.has(row.costCentreId)) {
      return { ok: false, message: "This cost centre is already in the split", sum };
    }
    seen.add(row.costCentreId);
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "Every split row needs a positive amount", sum };
    }
    sum += amount;
  }
  sum = Math.round((sum + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(requestedAmountNumber) || requestedAmountNumber <= 0) {
    return { ok: false, message: "Enter the requested amount before splitting it", sum };
  }
  if (Math.abs(sum - requestedAmountNumber) > SPLIT_AMOUNT_TOLERANCE) {
    return { ok: false, message: "Split total does not match the requested amount", sum };
  }
  return { ok: true, sum };
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

/** Tone tokens per end-state, so the row's headline badge stops being an undifferentiated grey
 *  outline across five very different outcomes. Mirrors the dashboard tone system: amber =
 *  waiting on someone, blue = mid-flight, emerald = money actually moved, rose = refused. */
const STATUS_TONE: Record<string, string> = {
  submitted: "border-amber-200 bg-amber-50 text-amber-800",
  branch_head_approved: "border-blue-200 bg-blue-50 text-blue-800",
  finance_head_approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  applied: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
};

/** "12 Aug, 3:40 pm" — short enough to sit under a three-across stage track without wrapping,
 *  and explicitly en-IN so a stage stamp never renders as a US date beside a rupee amount. */
function shortDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
}

type StageState = "done" | "current" | "rejected" | "upcoming";

type ApprovalStage = {
  key: string;
  label: string;
  state: StageState;
  who: string | null;
  at: string | null;
  note: string | null;
};

/**
 * The three real stages of a top-up, derived entirely from columns the list endpoint already
 * returns.
 *
 * There is deliberately no fourth "Applied" node. finance-workflow-role.ts documents that
 * Finance Head approval writes status='applied' in the same UPDATE that stamps
 * finance_head_reviewed_at (budget-topup.service.ts, the `SET status = 'applied', applied_at =
 * NOW()` branch of review()) — 'finance_head_approved' is a legacy resting state no service
 * writes any more. A separate Applied node would therefore always light up at the same instant
 * as Finance Head, and teach a reviewer a stage that does not exist.
 *
 * Which stage a rejection belongs to is derived, not stored: review() only ever stamps
 * branch_head_reviewed_at on an approve, so a rejected request with no branch stamp was refused
 * at the branch stage, and one with a stamp was refused by Finance.
 */
function buildApprovalStages(request: BudgetTopupRequest): ApprovalStage[] {
  const rejected = request.status === "rejected";
  const rejectedAtBranch = rejected && !request.branch_head_reviewed_at;

  return [
    {
      key: "raised",
      label: "Raised",
      state: "done",
      who: request.requested_by_name,
      at: request.created_at,
      note: null,
    },
    {
      key: "branch_head",
      label: "Branch Head",
      state: rejectedAtBranch
        ? "rejected"
        : request.branch_head_reviewed_at
          ? "done"
          : request.status === "submitted"
            ? "current"
            : "upcoming",
      who: request.branch_head_reviewed_by_name,
      at: request.branch_head_reviewed_at,
      note: rejectedAtBranch ? request.rejection_reason : request.branch_head_review_note,
    },
    {
      key: "finance_head",
      label: "Finance Head",
      state: rejected && !rejectedAtBranch
        ? "rejected"
        : request.finance_head_reviewed_at
          ? "done"
          : rejected
            ? "upcoming"
            : request.status === "branch_head_approved" || request.status === "finance_head_approved"
              ? "current"
              : "upcoming",
      who: request.finance_head_reviewed_by_name,
      at: request.finance_head_reviewed_at ?? (request.status === "applied" ? request.applied_at : null),
      note: rejected && !rejectedAtBranch ? request.rejection_reason : request.finance_head_review_note,
    },
  ];
}

const STAGE_BAR: Record<StageState, string> = {
  done: "bg-emerald-500",
  current: "bg-amber-400",
  rejected: "bg-rose-500",
  upcoming: "bg-slate-200",
};

const STAGE_TEXT: Record<StageState, string> = {
  done: "text-emerald-700",
  current: "text-amber-700",
  rejected: "text-rose-700",
  upcoming: "text-slate-400",
};

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />;
  if (state === "rejected") return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />;
  if (state === "current") return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />;
}

/**
 * The per-stage approval track that used to be missing entirely: the row carried one end-state
 * Badge, so "who has already signed this off, and who is sitting on it now" was unanswerable
 * without opening the record.
 *
 * Every stage is always rendered — an un-reached stage stays on screen greyed out rather than
 * being omitted, because the point of the control is to show the whole chain and where in it
 * this request currently sits. Ordered-list markup, not divs, so a screen reader reads it as a
 * sequence; state is carried by icon plus text, never by the colour bar alone.
 */
function ApprovalTrack({ stages }: { stages: ApprovalStage[] }) {
  return (
    <ol className="flex items-stretch gap-2" aria-label="Approval progress">
      {stages.map((stage) => {
        const stamp = shortDateTime(stage.at);
        const detail =
          stage.state === "upcoming"
            ? "Not yet reached"
            : stage.state === "current"
              ? "Awaiting decision"
              : [stage.who, stamp].filter(Boolean).join(" \u00b7 ")
                || (stage.state === "rejected" ? "Rejected" : "Approved");
        return (
          <li key={stage.key} className="min-w-0 flex-1">
            <div className={cn("h-1 rounded-full transition-colors duration-200", STAGE_BAR[stage.state])} />
            <div className="mt-1.5 flex items-center gap-1">
              <StageIcon state={stage.state} />
              <span className={cn("truncate text-[10px] font-bold uppercase tracking-wide", STAGE_TEXT[stage.state])}>
                {stage.label}
              </span>
            </div>
            {/* title= carries the untruncated value for a long reviewer name. The reviewer's
                remark is never hidden here — it is printed in full beneath the track. */}
            <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500" title={detail}>
              {detail}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Group D: the split editor shared by both "Request a budget increase" (new + existing line) and
 *  "Direct budget increase". A top-up split only ever needs {costCentreId, amount} per row — no
 *  percentage reconciliation against 100%, no per-cost-centre budget-line matching — unlike
 *  BudgetLinkedGrnForm's own CostCentreSplitEditor, which this deliberately does not reuse (that
 *  one is tightly coupled to that file's bespoke GrnCard/GrnSelect primitives and its own
 *  percentage-based reconciliation; this file uses its own plain shadcn primitives throughout). */
function CostCentreSplitEditor({
  rows,
  onChange,
  costCentreOptions,
  costCentresLoading,
  requestedAmountNumber,
}: {
  rows: TopupSplitRow[];
  onChange: (rows: TopupSplitRow[]) => void;
  costCentreOptions: CostCentreOption[];
  costCentresLoading: boolean;
  requestedAmountNumber: number;
}) {
  const validation = validateTopupSplits(rows, requestedAmountNumber);
  const usedCostCentreIds = new Set(rows.map((row) => row.costCentreId).filter(Boolean));

  const updateRow = (key: string, patch: Partial<TopupSplitRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeRow = (key: string) => onChange(rows.length > 1 ? rows.filter((row) => row.key !== key) : rows);
  const addRow = () => onChange([...rows, blankSplitRow()]);

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <Label className="text-xs">Cost-centre split *</Label>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <Select value={row.costCentreId} onValueChange={(value) => updateRow(row.key, { costCentreId: value })}>
              <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Select cost centre" /></SelectTrigger>
              <SelectContent>
                {costCentreOptions.map((cc) => (
                  <SelectItem
                    key={cc.id}
                    value={cc.id}
                    disabled={usedCostCentreIds.has(cc.id) && row.costCentreId !== cc.id}
                  >
                    {cc.costCentreName}{cc.processName ? ` · ${cc.processName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              className="h-9 w-32"
              placeholder="Amount"
              value={row.amount}
              onChange={(event) => updateRow(row.key, { amount: event.target.value })}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              disabled={rows.length === 1}
              title={rows.length === 1 ? "At least one cost-centre split is required" : "Remove this split"}
              onClick={() => removeRow(row.key)}
            >
              <XCircle className="h-4 w-4 text-slate-400" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={addRow}>
        <PlusCircle className="mr-1 h-3.5 w-3.5" />Add cost centre
      </Button>
      {!costCentresLoading && !costCentreOptions.length && (
        <p className="text-xs text-amber-700">No cost centres found for this branch.</p>
      )}
      <p className={cn("text-xs font-medium", validation.ok ? "text-emerald-700" : "text-amber-700")}>
        Split total: {money(validation.sum)} / {money(requestedAmountNumber)} needed
        {!validation.ok && ` — ${validation.message}`}
      </p>
    </div>
  );
}

/**
 * "Request a budget increase" queue + create dialog. A blocked GRN's error toast can deep-link
 * here with a pre-selected budgetLineId; the queue itself lists every request for the current
 * branch so branch_head/finance_head can act on it in the same place they already review budgets.
 */
export function BudgetTopupPanel({
  branchId,
  period,
  canCreate,
  canReviewBranchStage,
  canReviewFinanceStage,
  canDirectTopup,
  presetLineId,
  onConsumedPreset,
  currentUserId,
  presetNewLineHead,
  presetNewLineSubHead,
  currentBudgetId,
}: {
  branchId: string;
  period: string;
  canCreate: boolean;
  /** Review authority is per-stage, not one flag. The backend derives the reviewer role from
   *  the row's own status (resolveFinanceStageRole, workflow "grn"), so a single canReview
   *  boolean offered a finance_head an Approve button on a 'submitted' row that could only
   *  ever come back "The current grn stage requires the branch_head role". Same shape as
   *  canReview() for budgets in BranchBudgetManagementWorkspace. */
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
  /** Finance Head (+ super_admin) only — lets them increase a line's amount immediately,
   *  bypassing the branch_head -> finance_head request/review chain below (owner decision,
   *  2026-08-21). Sourced from capabilities.canDirectTopup, same shape as every other
   *  capability flag in this module. */
  canDirectTopup?: boolean;
  presetLineId?: string | null;
  onConsumedPreset?: () => void;
  /** Current user's ID — used to disable the Approve button when the viewer is the submitter
   *  (maker-checker enforcement mirrors the backend check in budget-topup.service.ts). */
  currentUserId?: string | null;
  /** Group D deep-link readiness: mirrors presetLineId's shape for the "no line exists yet"
   *  case a blocked GRN can also produce (see BranchBudgetManagementWorkspace's ?newLineHead=/
   *  ?newLineSubHead= params). Nothing sends these yet — Group A, not built — this only makes
   *  the panel ready to receive them. */
  presetNewLineHead?: string | null;
  presetNewLineSubHead?: string | null;
  /** The branch+period's current budget id, sourced from the parent workspace's own
   *  useBranchBudgets() query (BranchBudgetManagementWorkspace's `currentBudget`). Needed for a
   *  new-line request when `lines` is empty — exactly the situation that motivates new-line mode
   *  in the first place, so there is no AvailableLine row to read budget_id off. */
  currentBudgetId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(Boolean(presetLineId || presetNewLineHead));
  const [createMode, setCreateMode] = useState<"existing" | "new">(presetNewLineHead ? "new" : "existing");
  const [selectedLineId, setSelectedLineId] = useState(presetLineId ?? "");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [createSplitRows, setCreateSplitRows] = useState<TopupSplitRow[]>(() => [blankSplitRow()]);
  const [newLineHead, setNewLineHead] = useState(presetNewLineHead ?? "");
  const [newLineSubHead, setNewLineSubHead] = useState(presetNewLineSubHead ?? "");
  const [newLineUnit, setNewLineUnit] = useState("");
  const [newLineUnitRate, setNewLineUnitRate] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [directOpen, setDirectOpen] = useState(false);
  const [directLineId, setDirectLineId] = useState("");
  const [directAmount, setDirectAmount] = useState("");
  const [directReason, setDirectReason] = useState("");
  const [directSplitRows, setDirectSplitRows] = useState<TopupSplitRow[]>(() => [blankSplitRow()]);

  const listQuery = useQuery({
    // period is part of the key AND the request. It was omitted from both, so the panel showed
    // every top-up request the branch had ever raised while the rest of the workspace was scoped
    // to one month — the tab silently disagreed with the period shown above it. The endpoint has
    // always accepted a period filter (process-pnl.routes.ts /pnl/budget-topups); only the client
    // failed to send it.
    queryKey: ["budget-topups", branchId, period],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (period) params.set("period", period);
      const response = await hrmsApi.get<{ success: boolean; data: BudgetTopupRequest[] }>(
        `/api/finance/pnl/budget-topups?${params}`
      );
      return response.data ?? [];
    },
    enabled: Boolean(branchId),
  });
  const requests = listQuery.data ?? [];

  const linesQuery = useQuery({
    queryKey: ["budget-lines-available-for-topup", branchId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: AvailableLine[] }>(
        `/api/finance/pnl/budget-lines/available?branchId=${branchId}&period=${period}`
      );
      return response.data ?? [];
    },
    enabled: (createOpen || directOpen) && Boolean(branchId),
  });
  const lines = linesQuery.data ?? [];

  // Group D: cost-centre picker for the split editor, both dialogs. useBranchBudgetAllocations
  // is the existing, already-fetched-elsewhere query for this — no new endpoint, no duplicate
  // query key, per the brief.
  const { costCentresQuery } = useBranchBudgetAllocations(branchId, period);
  const costCentreOptions = costCentresQuery.data ?? [];

  // Expense master for HEAD/SUB-HEAD dropdowns in "Request new head/sub-head" mode
  const expenseMasterQuery = useQuery({
    queryKey: ["expense-masters-all"],
    queryFn: () => hrmsApi.get<any>("/api/finance/expense-masters"),
    staleTime: 10 * 60 * 1000,
    enabled: createOpen && createMode === "new",
  });
  type ExpenseHead = { headName?: string; subHeads?: Array<{ subHeadName?: string }> };
  const expenseMasterHeads = useMemo<string[]>(() => {
    const list = (expenseMasterQuery.data?.data ?? expenseMasterQuery.data ?? []) as ExpenseHead[];
    return list.map((h) => String(h.headName ?? "")).filter(Boolean);
  }, [expenseMasterQuery.data]);
  const expenseMasterSubHeads = useMemo<string[]>(() => {
    const list = (expenseMasterQuery.data?.data ?? expenseMasterQuery.data ?? []) as ExpenseHead[];
    const headEntry = list.find((h) => h.headName === newLineHead);
    return (headEntry?.subHeads ?? []).map((sh) => String(sh.subHeadName ?? "")).filter(Boolean);
  }, [expenseMasterQuery.data, newLineHead]);

  const requestedAmountNumber = Number(requestedAmount) || 0;
  const directAmountNumber = Number(directAmount) || 0;

  /** Every line returned for this branch+period shares one budget header (availableLines() scopes
   *  on branchId/period), so any line's budget_id stands in for "the current budget's id". Falls
   *  back to the parent workspace's own currentBudgetId when no line exists yet at all — exactly
   *  the case that motivates new-line mode. */
  const budgetIdForNewLine = lines[0]?.budget_id ?? currentBudgetId ?? null;

  const resetCreateDialogState = () => {
    setSelectedLineId("");
    setRequestedAmount("");
    setReason("");
    setCreateMode("existing");
    setCreateSplitRows([blankSplitRow()]);
    setNewLineHead("");
    setNewLineSubHead("");
    setNewLineUnit("");
    setNewLineUnitRate("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(requestedAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount");

      if (createMode === "new") {
        if (!newLineHead.trim() || !newLineSubHead.trim() || !newLineUnit.trim()) {
          throw new Error("Head, sub-head and unit are required to request a new budget line");
        }
        const unitRate = Number(newLineUnitRate);
        if (!(unitRate > 0)) {
          throw new Error("Enter a positive unit rate");
        }
        if (!budgetIdForNewLine) {
          throw new Error(
            `No budget was found for this branch in ${period || "the selected period"} — a budget must exist `
              + "before a new line can be requested against it."
          );
        }
        const splitCheck = validateTopupSplits(createSplitRows, amount);
        if (!splitCheck.ok) throw new Error(splitCheck.message);
        const costCentreSplits = createSplitRows.map((row) => ({
          costCentreId: row.costCentreId,
          amount: Number(row.amount),
          quantity: Number(row.amount) / unitRate,
        }));
        return hrmsApi.post("/api/finance/pnl/budget-topups", {
          isNewLine: true,
          budgetId: budgetIdForNewLine,
          head: newLineHead.trim(),
          subHead: newLineSubHead.trim(),
          unit: newLineUnit.trim(),
          unitRate,
          requestedAmount: amount,
          requestedQuantity: amount / unitRate,
          reason,
          costCentreSplits,
        });
      }

      if (!selectedLineId) throw new Error("Pick a budget line");
      const line = lines.find((l) => l.id === selectedLineId);
      // A quantity of 0 is still not a safe fallback — it makes the requested unit ceiling
      // meaningless — though it is no longer a blocking one: as of 2026-08-27 a GRN is gated on
      // money alone and the unit count never refuses (see budget-consumption.service.ts's
      // file-level banner). availableLines() filters on available_gross_amount only, so a line
      // with money left is always in `lines`; a missing preset line now means the line really has
      // no rupees left.
      if (!line) {
        throw new Error(
          "Select a budget line from the list. The line this request came from is no longer "
            + "offered because it has no headroom left at all — pick the line you need increased."
        );
      }
      if (!(line.unit_rate > 0)) {
        throw new Error("This budget line has no unit rate, so an increase cannot be sized in units.");
      }
      const requestedQuantity = amount / line.unit_rate;
      const splitCheck = validateTopupSplits(createSplitRows, amount);
      if (!splitCheck.ok) throw new Error(splitCheck.message);
      const costCentreSplits = createSplitRows.map((row) => ({
        costCentreId: row.costCentreId,
        amount: Number(row.amount),
        quantity: Number(row.amount) / line.unit_rate,
      }));
      return hrmsApi.post("/api/finance/pnl/budget-topups", {
        budgetLineId: selectedLineId,
        requestedAmount: amount,
        requestedQuantity,
        reason,
        costCentreSplits,
      });
    },
    onSuccess: () => {
      toast.success("Top-up request submitted for branch_head review");
      setCreateOpen(false);
      resetCreateDialogState();
      onConsumedPreset?.();
      queryClient.invalidateQueries({ queryKey: ["budget-topups"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to submit top-up request"),
  });

  const directApplyMutation = useMutation({
    mutationFn: async () => {
      if (!directLineId) throw new Error("Pick a budget line");
      const amount = Number(directAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount");
      const line = lines.find((l) => l.id === directLineId);
      if (!line) {
        throw new Error("Select a budget line from the list.");
      }
      if (!(line.unit_rate > 0)) {
        throw new Error("This budget line has no unit rate, so an increase cannot be sized in units.");
      }
      if (!directReason.trim()) throw new Error("A reason is required");
      const splitCheck = validateTopupSplits(directSplitRows, amount);
      if (!splitCheck.ok) throw new Error(splitCheck.message);
      const additionalQuantity = amount / line.unit_rate;
      const costCentreSplits = directSplitRows.map((row) => ({
        costCentreId: row.costCentreId,
        amount: Number(row.amount),
        quantity: Number(row.amount) / line.unit_rate,
      }));
      return hrmsApi.post(`/api/finance/pnl/budget-lines/${directLineId}/direct-topup`, {
        additionalQuantity,
        reason: directReason.trim(),
        costCentreSplits,
      });
    },
    onSuccess: () => {
      toast.success("Budget increased immediately — no further approval needed");
      setDirectOpen(false);
      setDirectLineId("");
      setDirectAmount("");
      setDirectReason("");
      setDirectSplitRows([blankSplitRow()]);
      // Same invalidation set as a completed review — a direct increase moves gross_amount
      // exactly the way an approved top-up does, so every cached headroom figure is now stale.
      queryClient.invalidateQueries({ queryKey: ["budget-topups"] });
      queryClient.invalidateQueries({ queryKey: ["branch-budget-detail"] });
      queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
      queryClient.invalidateQueries({ queryKey: ["budget-lines-available-for-topup"] });
      queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to apply the direct increase"),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approve" | "reject" }) => {
      return hrmsApi.post(`/api/finance/pnl/budget-topups/${id}/review`, {
        decision,
        remarks: reviewNotes[id]?.trim() || undefined,
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === "approve" ? "Top-up advanced" : "Top-up rejected");
      queryClient.invalidateQueries({ queryKey: ["budget-topups"] });
      // A finance_head approval does not just move a status: it runs
      // UPDATE finance_budget_line SET gross_amount = gross_amount + ?, quantity = quantity + ?
      // (budget-topup.service.ts). Every cached view of that line is now wrong — including the
      // GRN form's own headroom, which is what the raiser came here to unblock. Invalidating
      // only the queue and the budget detail left them still reading the pre-top-up ceiling
      // until a hard refresh, so the GRN stayed blocked by a number that had already changed.
      queryClient.invalidateQueries({ queryKey: ["branch-budget-detail"] });
      queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
      queryClient.invalidateQueries({ queryKey: ["budget-lines-available-for-topup"] });
      queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
    },
    onError: (error: Error) => toast.error(error.message || "Review failed"),
  });

  const canReviewRow = (request: BudgetTopupRequest) =>
    (request.status === "submitted" && canReviewBranchStage) ||
    (request.status === "branch_head_approved" && canReviewFinanceStage);

  /** Maker-checker: budget-topup.service.ts review() refuses BOTH decisions when the actor is the
   *  submitter, and it does so before the decision is even inspected. Only Approve was disabled
   *  here, so Reject stayed live on a request it could never act on — and because that refusal
   *  used to throw without a statusCode, pressing it returned an anonymous "quote reference …"
   *  500 instead of the reason. Both buttons now reflect the one rule the backend enforces. */
  const isOwnRequest = (request: BudgetTopupRequest) =>
    Boolean(currentUserId && request.requested_by && currentUserId === request.requested_by);

  const MAKER_CHECKER_HINT = "You submitted this request — a different reviewer must approve or reject it";

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        {/* The month is the single most important fact about a top-up — it says which budget
            gets bigger — and it appeared nowhere on this panel. It was only ever implied by the
            workspace period picker in the strip above, which a reviewer scrolling a queue is not
            looking at. Named here, and again on every row, because the queue is also reachable
            deep-linked from a blocked GRN with a period the reviewer did not choose. */}
        <CardTitle>Budget top-up requests{period ? ` — ${period}` : ""}</CardTitle>
        <div className="flex gap-2">
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusCircle className="mr-1 h-3.5 w-3.5" />Request increase
            </Button>
          )}
          {canDirectTopup && (
            <Button size="sm" variant="outline" onClick={() => setDirectOpen(true)}>
              <PlusCircle className="mr-1 h-3.5 w-3.5" />Direct increase (Finance Head)
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!requests.length && (
          <p className="py-8 text-center text-sm text-slate-500">
            No top-up requests for this branch yet.
          </p>
        )}
        {requests.map((request) => {
          /* Everything the row needs to answer "how much, and where is it stuck?" without the
             reviewer opening the record. Both were previously absent or buried: the amount was
             the tail clause of a grey run-on caption, and per-stage approval was not shown at
             all -- one end-state Badge stood in for a two-stage chain. */
          const stages = buildApprovalStages(request);
          const unitRate = Number(request.unit_rate ?? 0);
          const quantity = Number(request.requested_quantity ?? 0);
          /* Verified against live data 2026-08-27: 5 of the 7 top-ups on record carry a
             FRACTIONAL requested_quantity, because create() derives it as amount/unit_rate and
             most requests are for a rupee figure that is not a whole multiple of the line rate
             (e.g. ₹1,000 against a ₹15,000/Seat line -> 0.0667). Gating on quantity !== 1 let
             every one of those through and printed "0.0667 Seat × ₹15,000.00", which is
             arithmetically true and useless to a reviewer. Only show the derivation when the
             quantity reads as a real count. */
          const showUnitEconomics = unitRate > 0 && quantity >= 1;
          /* The remark the current end-state actually rests on. review() has captured approval
             notes since migration 1061 and nothing in the UI has ever read them back. */
          const decisionNote =
            request.status === "rejected"
              ? request.rejection_reason
              : request.finance_head_review_note ?? request.branch_head_review_note;
          const decisionNoteLabel = request.status === "rejected" ? "Rejected" : "Reviewer remark";

          return (
            <div
              key={request.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 transition-shadow duration-200 hover:shadow-md"
            >
              {/* Two columns from lg up, stacked below it. The right column is what fills the
                  dead space this row used to leave at every width above a phone: the amount,
                  then the approval chain, then the review controls that were previously the
                  only thing over there -- and only for the one reviewer who could act. */}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{request.head}{request.sub_head ? ` · ${request.sub_head}` : ""}</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-semibold",
                        STATUS_TONE[request.status] ?? "border-slate-200 bg-slate-50 text-slate-700"
                      )}
                    >
                      {statusLabel(request.status)}
                    </Badge>
                    {/* Pendency is the one thing a queue exists to surface. decorateTopup() has
                        always computed it server-side and no caller rendered it on this row. */}
                    {request.is_pending && request.pending_with && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Clock className="h-3 w-3" aria-hidden />
                        With {request.pending_with}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {request.item_name} · {request.budget_number}
                    {request.period_code ? ` · ${request.period_code} budget` : ""}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">{request.reason}</p>
                  {decisionNote && (
                    <p
                      className={cn(
                        "mt-2 rounded-lg border px-2.5 py-1.5 text-xs",
                        request.status === "rejected"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      )}
                    >
                      <span className="font-semibold">{decisionNoteLabel}:</span> {decisionNote}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3 lg:border-l lg:border-slate-100 lg:pl-4">
                  {/* The amount is the decision being asked for. It was the last clause of an
                      11px grey caption, indistinguishable from the budget number beside it. */}
                  <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700/70">
                      Requested increase
                    </p>
                    <p className="text-xl font-bold leading-tight tabular-nums text-blue-900">
                      {money(request.requested_amount)}
                    </p>
                    {showUnitEconomics && (
                      <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                        {quantity.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                        {request.unit ? ` ${request.unit}` : ""} × {money(unitRate)}
                      </p>
                    )}
                  </div>

                  <ApprovalTrack stages={stages} />

                  {canReviewRow(request) && (
                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                      <Input
                        placeholder="Remarks (required to reject)"
                        className="h-8 w-full text-xs"
                        disabled={isOwnRequest(request)}
                        value={reviewNotes[request.id] ?? ""}
                        onChange={(event) => setReviewNotes((prev) => ({ ...prev, [request.id]: event.target.value }))}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          // P0P1-4: prevent self-approval -- mirror backend maker-checker.
                          disabled={reviewMutation.isPending || isOwnRequest(request)}
                          title={isOwnRequest(request) ? MAKER_CHECKER_HINT : undefined}
                          onClick={() => reviewMutation.mutate({ id: request.id, decision: "approve" })}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          disabled={reviewMutation.isPending || isOwnRequest(request)}
                          title={isOwnRequest(request) ? MAKER_CHECKER_HINT : undefined}
                          onClick={() => reviewMutation.mutate({ id: request.id, decision: "reject" })}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                        </Button>
                      </div>
                      {/* A disabled button explains itself only on hover, and not at all on
                          touch. Say who the request is actually waiting for, so the raiser
                          chases the right person instead of assuming the screen is broken. */}
                      {isOwnRequest(request) && (
                        <p className="text-xs text-amber-700">
                          You raised this request, so you cannot review it. It is waiting for{" "}
                          {request.status === "submitted" ? "another Branch Head" : "the Finance Head"}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            resetCreateDialogState();
            onConsumedPreset?.();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request a budget increase</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Which month is being increased is decided by the workspace period, not by anything
                in this dialog — the line picker only offers lines from that month. Stating it
                makes an implicit choice explicit before someone submits against the wrong one. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Increasing the <strong>{period || "selected"}</strong> budget. Change the month in the
              strip above the tabs to top up a different period.
            </div>
            {/* Group D: existing-line vs brand-new-head/sub-head. A small segmented toggle rather
                than GRN's GrnSegmented, which is tied to that file's own bespoke styling — this
                matches its visual convention (a pill of two mutually-exclusive buttons) using this
                file's own Button primitive. */}
            <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <Button
                type="button"
                size="sm"
                variant={createMode === "existing" ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setCreateMode("existing")}
              >
                Existing budget line
              </Button>
              <Button
                type="button"
                size="sm"
                variant={createMode === "new" ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setCreateMode("new")}
              >
                Request new head/sub-head
              </Button>
            </div>
            {createMode === "existing" ? (
              <div>
                <Label className="text-xs">Budget line *</Label>
                <Select value={selectedLineId} onValueChange={setSelectedLineId} disabled={!linesQuery.isLoading && !lines.length}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select a budget line" /></SelectTrigger>
                  <SelectContent>
                    {lines.map((line) => (
                      <SelectItem key={line.id} value={line.id}>
                        {line.head}{line.sub_head ? ` · ${line.sub_head}` : ""} — {line.item_name} (available {money(line.available_gross_amount)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* The old copy asserted one cause ("hasn't reached that stage yet") for what are
                    two quite different situations, and was simply wrong in the second: a fully
                    approved budget whose lines are all spent to zero also returns nothing here,
                    because availableLines() filters on available_gross_amount > 0. (It filtered
                    on available_quantity too until 2026-08-27, which additionally hid lines that
                    still had money — see budget-consumption.service.ts's banner.) Telling someone
                    their budget is unapproved when it is approved and exhausted sends them to the
                    wrong person. */}
                {!linesQuery.isLoading && !lines.length && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    No budget line with remaining headroom for {period}. Either this branch's budget for
                    this period has not completed Branch Head and Finance Head approval,
                    or it is approved and every line is already fully committed. The Approval &amp;
                    Utilization tab shows which of the two it is — or use "Request new head/sub-head"
                    above if this is genuinely a brand-new line.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Head *</Label>
                  <Select value={newLineHead} onValueChange={(value) => { setNewLineHead(value); setNewLineSubHead(""); }}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select head" /></SelectTrigger>
                    <SelectContent>
                      {expenseMasterHeads.map((head) => (
                        <SelectItem key={head} value={head}>{head}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sub-head *</Label>
                  <Select value={newLineSubHead} onValueChange={setNewLineSubHead} disabled={!newLineHead}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={newLineHead ? "Select sub-head" : "Select head first"} /></SelectTrigger>
                    <SelectContent>
                      {expenseMasterSubHeads.map((subHead) => (
                        <SelectItem key={subHead} value={subHead}>{subHead}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unit *</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. Nos, Hours, Amount"
                    value={newLineUnit}
                    onChange={(event) => setNewLineUnit(event.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit rate *</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="mt-1 h-9"
                    value={newLineUnitRate}
                    onChange={(event) => setNewLineUnitRate(event.target.value)}
                  />
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Additional amount needed *</Label>
              <Input
                type="number"
                inputMode="decimal"
                className="mt-1 h-9"
                value={requestedAmount}
                onChange={(event) => setRequestedAmount(event.target.value)}
              />
            </div>
            <CostCentreSplitEditor
              rows={createSplitRows}
              onChange={setCreateSplitRows}
              costCentreOptions={costCentreOptions}
              costCentresLoading={costCentresQuery.isLoading}
              requestedAmountNumber={requestedAmountNumber}
            />
            <div>
              <Label className="text-xs">Reason *</Label>
              <Textarea
                className="mt-1 min-h-[72px]"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this head/sub-head needs more than what was approved"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !validateTopupSplits(createSplitRows, requestedAmountNumber).ok}
              onClick={() => createMutation.mutate()}
            >
              Submit for branch_head review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finance Head direct increase — applies immediately, no branch_head/finance_head review
          chain. Same line picker/amount/reason shape as the request dialog above, deliberately
          kept separate (not a shared dialog) so the two very different consequences — "raises a
          request" vs. "changes the budget right now" — are never one accidental click apart. */}
      <Dialog
        open={directOpen}
        onOpenChange={(open) => {
          setDirectOpen(open);
          if (!open) setDirectSplitRows([blankSplitRow()]);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Direct budget increase — Finance Head</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This applies immediately — the <strong>{period || "selected"}</strong> budget line's
              approved amount changes as soon as you submit. No branch_head or finance_head review
              follows; it appears in the queue above as already applied.
            </div>
            <div>
              <Label className="text-xs">Budget line *</Label>
              <Select value={directLineId} onValueChange={setDirectLineId} disabled={!linesQuery.isLoading && !lines.length}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select a budget line" /></SelectTrigger>
                <SelectContent>
                  {lines.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {line.head}{line.sub_head ? ` · ${line.sub_head}` : ""} — {line.item_name} (available {money(line.available_gross_amount)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Additional amount *</Label>
              <Input
                type="number"
                inputMode="decimal"
                className="mt-1 h-9"
                value={directAmount}
                onChange={(event) => setDirectAmount(event.target.value)}
              />
            </div>
            <CostCentreSplitEditor
              rows={directSplitRows}
              onChange={setDirectSplitRows}
              costCentreOptions={costCentreOptions}
              costCentresLoading={costCentresQuery.isLoading}
              requestedAmountNumber={directAmountNumber}
            />
            <div>
              <Label className="text-xs">Reason *</Label>
              <Textarea
                className="mt-1 min-h-[72px]"
                value={directReason}
                onChange={(event) => setDirectReason(event.target.value)}
                placeholder="Why this head/sub-head's approved budget is being increased directly"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDirectOpen(false)}>Cancel</Button>
            <Button
              disabled={directApplyMutation.isPending || !validateTopupSplits(directSplitRows, directAmountNumber).ok}
              onClick={() => directApplyMutation.mutate()}
            >
              Apply immediately
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
