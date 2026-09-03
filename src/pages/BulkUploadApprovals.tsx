/**
 * Bulk Upload Approvals — the Branch Head queue.
 *
 * Everything a WFM or Super Admin uploads for leave, attendance regularization,
 * incentive or deduction lands here first. Approving is what actually deducts a leave
 * balance, corrects an attendance record or lets a deduction reach payroll, so the
 * screen is built to make the approver look at the rows before deciding rather than
 * approving a row count.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileCheck,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { BatchCostCentreReview } from "@/components/bulk-upload/BatchCostCentreReview";
import {
  pollBatchJob, isBatchJobStarted, describeProgress,
  type BatchJobStatus,
} from "@/lib/bulkBatchJob";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell } from "@/components/ui/hrms-modern";

interface PendingBatch {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  original_file_name: string | null;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  batch_status: string;
  approval_status: string | null;
  branch_id: string | null;
  branch_name: string | null;
  uploaded_by_name: string | null;
  submitted_for_approval_at: string | null;
  created_at: string;
  branch_head_approved_by: string | null;
  branch_head_approved_at: string | null;
  branch_head_remarks: string | null;
  payroll_head_approved_by: string | null;
  payroll_head_approved_at: string | null;
}

interface DecidedBatch {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  approval_status: string;
  approved_at: string | null;
  approval_remarks: string | null;
  error_summary: string | null;
  branch_name: string | null;
  last_rejected_stage: string | null;
  last_rejected_reason: string | null;
  last_rejected_at: string | null;
}

interface HistoryBatchFull extends DecidedBatch {
  original_file_name?: string | null;
  uploaded_by_name?: string | null;
  submitted_for_approval_at?: string | null;
}

interface PreviewRow {
  row_no: number;
  normalized_data: Record<string, unknown> | string | null;
  raw_data: Record<string, unknown> | string | null;
  row_status: string;
  error_messages: string[] | string | null;
  created_entity_type: string | null;
  created_entity_id: string | null;
  employee_name: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK: "Attendance Regularization",
  LEAVE_APPLICATION_BULK: "Leave Application",
  INCENTIVE_BULK: "Incentive",
  DEDUCTION_BULK: "Deduction",
};

const TYPE_COLOR: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK: "bg-teal-50 text-teal-700 border-teal-200",
  LEAVE_APPLICATION_BULK: "bg-blue-50 text-blue-700 border-blue-200",
  INCENTIVE_BULK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DEDUCTION_BULK: "bg-amber-50 text-amber-700 border-amber-200",
};

/**
 * What approving actually does, per type. Shown on the confirm step — an approver
 * deducting 400 leave balances deserves to be told that is what the button does.
 */
const PREFERRED_COLUMNS: Record<string, string[]> = {
  LEAVE_APPLICATION_BULK:              ["employee_code", "leave_code", "from_date", "to_date", "total_days", "reason"],
  ATTENDANCE_REGULARIZATION_BULK:      ["employee_code", "session_date", "requested_status", "reason", "reason_code", "dispute_type", "new_punch_in", "new_punch_out", "supporting_note"],
  INCENTIVE_BULK:                      ["employee_code", "incentive_code", "pay_month", "amount", "remarks"],
  DEDUCTION_BULK:                      ["employee_code", "deduction_type_code", "run_month", "amount", "description", "is_prorated"],
};

function sortColumns(cols: string[], typeCode: string): string[] {
  const preferred = PREFERRED_COLUMNS[typeCode] ?? [];
  return [
    ...preferred.filter((c) => cols.includes(c)),
    ...cols.filter((c) => !preferred.includes(c)),
  ];
}

const TYPE_EFFECT: Record<string, string> = {
  ATTENDANCE_REGULARIZATION_BULK:
    "Approving applies each correction to the employee's attendance record.",
  LEAVE_APPLICATION_BULK:
    "Approving DEDUCTS each employee's leave balance and marks the days as leave. This is the same deduction a manual leave approval makes.",
  INCENTIVE_BULK:
    "Approving makes these incentive amounts payable — payroll picks them up for the pay month automatically.",
  DEDUCTION_BULK:
    "Approving activates these deductions so payroll will recover them in the run month.",
};

function parseJson<T>(value: T | string | null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TypeBadge({ code }: { code: string }) {
  const label = TYPE_LABEL[code] ?? code;
  const color = TYPE_COLOR[code] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
      <Clock className="h-3 w-3" />
      {status}
    </span>
  );
}

/**
 * The two money types run a second approval, by the HO Payroll Head, before anything is
 * paid. Everything else is decided once, by the Branch Head — so the stepper and the
 * button copy have to differ by type, not be hard-coded to one chain.
 */
const TWO_STAGE_TYPES = new Set(["INCENTIVE_BULK", "DEDUCTION_BULK"]);

type Stage = "branch" | "payroll";

const STAGE_LABEL: Record<Stage, string> = {
  branch: "Branch Head",
  payroll: "Payroll Head",
};

/** Which stage is this batch waiting on? Mirrors resolveStage() on the server. */
function stageOf(batch: { approval_status: string | null }): Stage | null {
  if (batch.approval_status === "pending_branch_head") return "branch";
  if (batch.approval_status === "pending_payroll_head") return "payroll";
  return null;
}

/**
 * Where the batch is in its chain. Rendered for the two-stage types only — showing a
 * three-step tracker on a leave batch that has one approver would misdescribe it.
 */
function StageStepper({ batch }: { batch: PendingBatch }) {
  const steps = [
    { key: "upload", label: "Uploaded", done: true },
    {
      key: "branch",
      label: STAGE_LABEL.branch,
      done: Boolean(batch.branch_head_approved_at),
      active: batch.approval_status === "pending_branch_head",
    },
    {
      key: "payroll",
      label: STAGE_LABEL.payroll,
      done: Boolean(batch.payroll_head_approved_at),
      active: batch.approval_status === "pending_payroll_head",
    },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Approval progress">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="h-px w-4 bg-slate-200" />}
          <span
            className={
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold " +
              (step.done
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : step.active
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-slate-50 text-slate-400")
            }
          >
            {step.done && <CheckCircle2 className="h-3 w-3" />}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * How a decision ended, returned rather than written straight to state: load()
 * clears the error banner, so anything set before the reload would vanish before
 * the approver could read it.
 */
interface Outcome {
  notice: string;
  error?: string;
}

/** Which discard entity type a bulk-upload row's batch maps to — only these two
 *  types ever create a discardable entity; incentive/deduction rows do not. */
const DISCARD_ENTITY_TYPE: Record<string, "leave" | "regularization" | undefined> = {
  ATTENDANCE_REGULARIZATION_BULK: "regularization",
  LEAVE_APPLICATION_BULK: "leave",
};

export default function BulkUploadApprovals() {
  // canEditPage alone is not enough — a stale grant hands out buttons the API 403s
  // (the Support Command Center incident), so the stage role is checked too.
  const { isResolved, canEditPage, hasAnyRole } = useWorkforceAccess();
  const [pending, setPending] = useState<PendingBatch[]>([]);
  const [history, setHistory] = useState<DecidedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Search / branch / date-range filters — apply to both the pending queue and
  // recent decisions, client-side over what's already loaded (a branch head's
  // queue is dozens of batches, not thousands — a server round trip per keystroke
  // would be the wrong tool here).
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const branchOptions = useMemo(() => {
    const names = new Set<string>();
    for (const b of pending) if (b.branch_name) names.add(b.branch_name);
    for (const b of history) if (b.branch_name) names.add(b.branch_name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [pending, history]);

  const inDateRange = useCallback(
    (iso: string | null) => {
      if (!iso) return !dateFrom && !dateTo;
      const day = iso.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    },
    [dateFrom, dateTo],
  );

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pending.filter((b) => {
      if (branchFilter && b.branch_name !== branchFilter) return false;
      if (!inDateRange(b.submitted_for_approval_at ?? b.created_at)) return false;
      if (!q) return true;
      return (
        b.upload_batch_no.toLowerCase().includes(q) ||
        (b.uploaded_by_name ?? "").toLowerCase().includes(q) ||
        (b.original_file_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [pending, search, branchFilter, inDateRange]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((b) => {
      if (branchFilter && b.branch_name !== branchFilter) return false;
      if (!inDateRange(b.approved_at)) return false;
      if (!q) return true;
      return (
        b.upload_batch_no.toLowerCase().includes(q) ||
        (b.error_summary ?? "").toLowerCase().includes(q)
      );
    });
  }, [history, search, branchFilter, inDateRange]);

  const hasActiveFilters = Boolean(search || branchFilter || dateFrom || dateTo);
  const clearFilters = useCallback(() => {
    setSearch(""); setBranchFilter(""); setDateFrom(""); setDateTo("");
  }, []);

  const [openBatch, setOpenBatch] = useState<PendingBatch | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  // Live progress of a decision running on the server. The request that started it
  // returned immediately; this is what the approver watches instead of a spinner
  // that used to end in a 502.
  const [decisionProgress, setDecisionProgress] = useState<BatchJobStatus | null>(null);

  /**
   * Which stage the open batch is on, and whether this user owns that stage.
   *
   * The server decides this too — assertCanApprove re-checks the role, the branch scope
   * and both separation-of-duties rules — so this only governs whether the buttons are
   * offered. Gating on canEditPage alone is what handed 24 users buttons the API refused.
   */
  const openStage = openBatch ? stageOf(openBatch) : null;
  const canDecideOpenBatch =
    isResolved &&
    Boolean(openStage) &&
    canEditPage("BULK_UPLOAD_APPROVALS") &&
    (hasAnyRole("super_admin") ||
      (openStage === "payroll" ? hasAnyRole("payroll_head") : hasAnyRole("branch_head")));

  const [openHistoryBatch, setOpenHistoryBatch] = useState<HistoryBatchFull | null>(null);
  const [historyRows, setHistoryRows] = useState<PreviewRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Discarding rows out of an approved batch — the "reverse it through that
  // batch" path. Selection is keyed by created_entity_id (what the discard API
  // actually needs), not row_no.
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [discardReason, setDiscardReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardOutcome, setDiscardOutcome] = useState<
    { entityId: string; success: boolean; message: string }[] | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, h] = await Promise.all([
        hrmsApi.get<{ success: boolean; data?: PendingBatch[]; message?: string }>(
          "/api/bulk-upload/approvals/pending",
        ),
        hrmsApi.get<{ success: boolean; data?: DecidedBatch[] }>(
          "/api/bulk-upload/approvals/history",
        ),
      ]);
      if (!p.success) throw new Error(p.message || "Could not load the approval queue.");
      setPending(p.data ?? []);
      setHistory(h.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the approval queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPreview = useCallback(async (batch: PendingBatch) => {
    setOpenBatch(batch);
    setDecisionProgress(null);
    setRemarks("");
    setPreviewRows([]);
    setPreviewLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data?: PreviewRow[]; message?: string }>(
        `/api/bulk-upload/approvals/batches/${batch.id}/preview`,
      );
      if (!res.success) throw new Error(res.message || "Could not load the batch rows.");
      setPreviewRows(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the batch rows.");
      setOpenBatch(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const openHistoryPreview = useCallback(async (batch: HistoryBatchFull) => {
    setOpenHistoryBatch(batch);
    setHistoryRows([]);
    setHistoryLoading(true);
    setSelectedEntityIds(new Set());
    setDiscardReason("");
    setDiscardOutcome(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data?: PreviewRow[]; message?: string }>(
        `/api/bulk-upload/approvals/batches/${batch.id}/preview`,
      );
      if (!res.success) throw new Error(res.message || "Could not load the batch rows.");
      setHistoryRows(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load batch detail.");
      setOpenHistoryBatch(null);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /**
   * Wait out a decision that is running on the server and report how it ended.
   *
   * Shared by decide() and by the resume path below, because a batch found already
   * 'approving' (the approver reloaded the page, or a previous attempt hit the old
   * 502) has to be followed in exactly the same way.
   */
  const trackDecision = useCallback(
    async (batchId: string, decision: "approve" | "reject"): Promise<Outcome> => {
      const final = await pollBatchJob(
        `/api/bulk-upload/approvals/batches/${batchId}/job-status`,
        { onProgress: setDecisionProgress },
      );

      if (final.phase === "failed") {
        throw new Error(final.error ?? final.message ?? `Could not ${decision} this batch.`);
      }

      const result = final.result as
        | { message?: string; failed?: number; errors?: string[] }
        | undefined;
      const failed = result?.failed ?? final.progress?.failed ?? 0;
      const summary =
        result?.message ??
        final.message ??
        `Batch ${final.approval_status ?? `${decision}d`}.`;

      if (failed > 0) {
        const firstErrors = (result?.errors ?? final.errors ?? []).slice(0, 3).join(" | ");
        return { notice: summary, error: firstErrors ? `${summary} First errors: ${firstErrors}` : summary };
      }
      return { notice: summary };
    },
    [],
  );

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      if (!openBatch) return;
      if (decision === "reject" && remarks.trim().length < 10) {
        setError("A rejection needs a remark of at least 10 characters — it is what the uploader has to act on.");
        return;
      }
      const effect = TYPE_EFFECT[openBatch.upload_type_code] ?? "";
      const confirmText =
        decision === "approve"
          ? `Approve ${openBatch.upload_batch_no} (${openBatch.imported_rows} row(s))?\n\n${effect}\n\nOnce approved these records are locked and cannot be discarded.`
          : `Reject ${openBatch.upload_batch_no}? The staged rows will be cancelled and nothing will be applied.`;
      if (!window.confirm(confirmText)) return;

      const batchId = openBatch.id;
      setDeciding(decision);
      setError("");
      setDecisionProgress(null);
      try {
        // The server no longer applies the rows inside this request. It validates,
        // claims the batch, answers 202 and keeps working — which is what stopped a
        // large batch from dying on nginx's 60s proxy timeout with a 502 while the
        // approval was in fact running fine. The outcome is collected by polling.
        const res = await hrmsApi.post<{
          success: boolean;
          processing?: boolean;
          total_rows?: number | null;
          approval_status?: string;
          applied?: number;
          failed?: number;
          errors?: string[];
          message?: string;
        }>(
          `/api/bulk-upload/approvals/batches/${batchId}/${decision}`,
          { remarks: remarks.trim() },
          60000,
        );

        let outcome: Outcome;
        if (isBatchJobStarted(res)) {
          setDecisionProgress({
            phase: "running",
            progress: {
              total: res.total_rows ?? null,
              processed: 0,
              succeeded: 0,
              failed: 0,
            },
          });
          outcome = await trackDecision(batchId, decision);
        } else {
          // An API that has not been updated yet still answers synchronously.
          // isBatchJobStarted is a type predicate, so this branch narrows `res` to
          // Exclude<…, BatchJobStarted>, which collapses to `never` — the 202 shape is a
          // structural subset of the synchronous one. Read the sync body off its own alias.
          const sync = res as { failed?: number; errors?: string[]; message?: string };
          outcome = {
            notice: sync.message ?? `Batch ${decision}d.`,
            error:
              sync.message && sync.failed
                ? `${sync.message} First errors: ${(sync.errors ?? []).slice(0, 3).join(" | ")}`
                : undefined,
          };
        }
        setOpenBatch(null);
        // Reload first — load() resets the error banner, so the outcome is written
        // after it or it would be wiped before anyone read it.
        await load();
        setNotice(outcome.notice);
        if (outcome.error) setError(outcome.error);
      } catch (err) {
        const message = err instanceof Error ? err.message : `Could not ${decision} this batch.`;
        await load();
        setError(message);
      } finally {
        setDeciding(null);
        setDecisionProgress(null);
      }
    },
    [openBatch, remarks, load, trackDecision],
  );

  /**
   * Follow a decision that was already running when this page loaded.
   *
   * Before the work was moved off the request, a batch cut off by the proxy timeout
   * stayed claimed as 'approving' with nothing watching it, and the approver's only
   * evidence was the 502. Now the queue picks it back up and reports how it ends,
   * whether this browser started it or not.
   */
  useEffect(() => {
    const inFlight = pending.find((b) => b.batch_status === "approving");
    if (!inFlight || deciding) return;

    let cancelled = false;
    void (async () => {
      try {
        const final = await pollBatchJob(
          `/api/bulk-upload/approvals/batches/${inFlight.id}/job-status`,
          { intervalMs: 5000 },
        );
        if (cancelled) return;
        if (final.phase !== "running") {
          setNotice(
            final.message ??
              `Batch ${inFlight.upload_batch_no} finished (${final.approval_status ?? final.phase}).`,
          );
          await load();
        }
      } catch {
        // A batch someone else is deciding is not this screen's error to report.
      }
    })();
    return () => { cancelled = true; };
  }, [pending, deciding, load]);

  const previewColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const row of previewRows.slice(0, 50)) {
      const data = parseJson<Record<string, unknown>>(row.normalized_data) ??
        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
      for (const key of Object.keys(data)) cols.add(key);
    }
    return sortColumns([...cols], openBatch?.upload_type_code ?? "");
  }, [previewRows, openBatch]);

  const historyPreviewColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const row of historyRows.slice(0, 50)) {
      const data = parseJson<Record<string, unknown>>(row.normalized_data) ??
        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
      for (const key of Object.keys(data)) cols.add(key);
    }
    return sortColumns([...cols], openHistoryBatch?.upload_type_code ?? "");
  }, [historyRows, openHistoryBatch]);

  /** Whether this batch's TYPE and OUTCOME even admit discarding a row out of it.
   *  Incentive/deduction rows never create a leave/regularization entity, so
   *  there is nothing here for the discard API to act on; a rejected batch
   *  never applied anything either. */
  const discardEntityType = openHistoryBatch
    ? DISCARD_ENTITY_TYPE[openHistoryBatch.upload_type_code]
    : undefined;
  const batchDiscardable =
    Boolean(discardEntityType) &&
    (openHistoryBatch?.approval_status === "approved" ||
      openHistoryBatch?.approval_status === "partially_applied");

  const toggleRowSelection = (entityId: string) => {
    setSelectedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const selectableEntityIds = useMemo(
    () =>
      batchDiscardable
        ? historyRows
            .filter((r) => r.row_status === "imported" && r.created_entity_id)
            .map((r) => r.created_entity_id as string)
        : [],
    [historyRows, batchDiscardable],
  );

  const toggleSelectAll = () => {
    setSelectedEntityIds((prev) =>
      prev.size === selectableEntityIds.length ? new Set() : new Set(selectableEntityIds),
    );
  };

  /** Re-fetches this batch's rows without resetting selection/outcome state —
   *  unlike openHistoryPreview, which is also the "open a different batch" path
   *  and rightly clears all of that. Used only after a discard, so the outcome
   *  banner and the trimmed selection survive the refresh. */
  const refreshHistoryRows = useCallback(async (batch: HistoryBatchFull) => {
    setHistoryLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data?: PreviewRow[]; message?: string }>(
        `/api/bulk-upload/approvals/batches/${batch.id}/preview`,
      );
      if (res.success) setHistoryRows(res.data ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const discardSelectedRows = useCallback(async () => {
    if (!openHistoryBatch || !discardEntityType || selectedEntityIds.size === 0) return;
    if (discardReason.trim().length < 10) {
      setError("A reason of at least 10 characters is required — it becomes the permanent record of why this was reversed.");
      return;
    }
    setDiscarding(true);
    setError("");
    setDiscardOutcome(null);
    try {
      const res = await hrmsApi.post<{
        success: boolean;
        data: { entityId: string; success: boolean; message: string }[];
        message: string;
      }>(`/api/discard/batch/${openHistoryBatch.id}/rows`, {
        entityType: discardEntityType,
        entityIds: [...selectedEntityIds],
        reason: discardReason.trim(),
      });
      setDiscardOutcome(res.data);
      setNotice(res.message);
      const succeededIds = new Set(res.data.filter((r) => r.success).map((r) => r.entityId));
      setSelectedEntityIds((prev) => new Set([...prev].filter((id) => !succeededIds.has(id))));
      setDiscardReason("");
      // Re-fetch this batch's rows so a discarded row's status reflects reality
      // rather than the stale "imported" it showed before this call — without
      // wiping the outcome banner or trimmed selection this just set.
      await refreshHistoryRows(openHistoryBatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard the selected rows.");
    } finally {
      setDiscarding(false);
    }
  }, [openHistoryBatch, discardEntityType, selectedEntityIds, discardReason, refreshHistoryRows]);

  return (
    <DashboardLayout>
    <HrmsModernShell
      eyebrow="Workforce Operations"
      title="Bulk Upload Approvals"
      description="Leave, attendance regularization, incentive and deduction batches uploaded by WFM or a Super Admin. Nothing in a pending batch has been applied — approving is what deducts a leave balance, corrects an attendance record or releases a deduction to payroll."
      icon={<FileCheck className="h-6 w-6" />}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:shadow-md cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      {/* Alerts */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
          {notice}
        </div>
      )}

      {/* Filters — apply to both the pending queue and recent decisions below */}
      <section className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px] text-xs font-semibold text-slate-600">
            Search
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Batch number, uploader, file name…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </label>
          <label className="min-w-[180px] text-xs font-semibold text-slate-600">
            Branch
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">All branches</option>
              {branchOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Pending approvals section */}
      <section className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Awaiting Your Approval</h2>
              <p className="text-xs text-slate-500">
                {filteredPending.length} batch{filteredPending.length !== 1 ? "es" : ""} pending
                {hasActiveFilters && filteredPending.length !== pending.length ? ` (of ${pending.length})` : ""}
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            <span className="ml-3 text-sm text-slate-500">Loading…</span>
          </div>
        ) : filteredPending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 mb-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-slate-700">{pending.length === 0 ? "All clear" : "No batches match your filters"}</p>
            <p className="text-xs text-slate-500 mt-1">
              {pending.length === 0 ? "Nothing is waiting for your approval." : "Try clearing a filter above."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Batch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Branch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Uploaded By</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 text-right">Rows</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Submitted</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPending.map((batch) => (
                  <tr
                    key={batch.id}
                    className="transition-colors duration-150 hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => void openPreview(batch)}
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-800">{batch.upload_batch_no}</p>
                      {batch.original_file_name && (
                        <p className="text-xs text-slate-400 truncate max-w-[180px]">{batch.original_file_name}</p>
                      )}
                      {batch.batch_status === "approving" && (
                        // A batch mid-decision used to look identical to an untouched one,
                        // so the only way to discover it was to click Approve and get a
                        // bare 409. Say so on the row instead.
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Being decided now
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <TypeBadge code={batch.upload_type_code} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{batch.branch_name ?? "—"}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{batch.uploaded_by_name ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-semibold text-slate-800">{batch.imported_rows}</span>
                      {batch.error_rows > 0 && (
                        <span className="ml-1 text-xs text-amber-600 font-medium">+{batch.error_rows} err</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {formatDateTime(batch.submitted_for_approval_at ?? batch.created_at)}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => void openPreview(batch)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 hover:shadow-sm cursor-pointer"
                      >
                        Review rows
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent decisions section */}
      <section className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Recent Decisions</h2>
            <p className="text-xs text-slate-500">
              {filteredHistory.length} decision{filteredHistory.length !== 1 ? "s" : ""} recorded
              {hasActiveFilters && filteredHistory.length !== history.length ? ` (of ${history.length})` : ""}
            </p>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-slate-500">{history.length === 0 ? "No decisions yet." : "No decisions match your filters."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Batch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Outcome</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Branch</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Decided</th>
                  <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredHistory.map((batch) => (
                  <tr
                    key={batch.id}
                    className="transition-colors duration-150 hover:bg-indigo-50/40 cursor-pointer"
                    onClick={() => void openHistoryPreview(batch as HistoryBatchFull)}
                  >
                    <td className="px-5 py-3 font-semibold text-slate-800">{batch.upload_batch_no}</td>
                    <td className="px-5 py-3">
                      <TypeBadge code={batch.upload_type_code} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={batch.approval_status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{batch.branch_name ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(batch.approved_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600 max-w-[240px] truncate">{batch.error_summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Preview / decision drawer */}
      {openBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget && deciding === null) setOpenBatch(null); }}
        >
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200/80">
            {/* Drawer header with gradient accent */}
            <div className="relative overflow-hidden rounded-t-2xl">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-blue-500 to-cyan-500" />
              <div className="flex items-start justify-between px-6 py-4 pt-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                    <FileCheck className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900">{openBatch.upload_batch_no}</h3>
                      <TypeBadge code={openBatch.upload_type_code} />
                    </div>
                    <p className="mt-1 max-w-3xl text-xs text-slate-500 leading-relaxed">
                      {TYPE_EFFECT[openBatch.upload_type_code]}
                    </p>
                    {TWO_STAGE_TYPES.has(openBatch.upload_type_code) && (
                      <div className="mt-2.5">
                        <StageStepper batch={openBatch} />
                        {openStage === "branch" && (
                          <p className="mt-1.5 text-[11px] leading-relaxed text-blue-700">
                            Approving here does not pay anything. The batch moves to the{" "}
                            {STAGE_LABEL.payroll} for final approval.
                          </p>
                        )}
                        {openStage === "payroll" && (
                          <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-700">
                            Final approval. These amounts enter the payroll run for the month as
                            soon as you approve.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenBatch(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Preview — cost-centre-wise for the two money types, flat rows otherwise */}
            <div className="flex-1 overflow-auto border-t border-slate-100 px-6 py-4">
              {TWO_STAGE_TYPES.has(openBatch.upload_type_code) ? (
                <BatchCostCentreReview
                  batchId={openBatch.id}
                  batchNo={openBatch.upload_batch_no}
                  canDiscard={canDecideOpenBatch}
                  stageLabel={openStage ? STAGE_LABEL[openStage] : "Approver"}
                  onChanged={() => { void load(); }}
                />
              ) : previewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
                  <span className="ml-3 text-sm text-slate-500">Loading rows…</span>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 rounded-lg">
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">#</th>
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">Employee</th>
                      {previewColumns.map((c) => (
                        <th key={c} className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">{c}</th>
                      ))}
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((row) => {
                      const data =
                        parseJson<Record<string, unknown>>(row.normalized_data) ??
                        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
                      const errs = parseJson<string[]>(row.error_messages);
                      return (
                        <tr
                          key={row.row_no}
                          className={row.row_status === "error" ? "bg-rose-50/60" : "hover:bg-slate-50/60"}
                        >
                          <td className="px-3 py-2 font-medium text-slate-400">{row.row_no}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                            {row.employee_name ?? <span className="text-slate-400">—</span>}
                          </td>
                          {previewColumns.map((c) => (
                            <td key={c} className="px-3 py-2 text-slate-700">
                              {String(data[c] ?? "")}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {row.row_status === "error" ? (
                              <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                                <XCircle className="h-3 w-3 shrink-0" />
                                {Array.isArray(errs) ? errs[0] : "Rejected"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 className="h-3 w-3" />
                                staged
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Decision footer */}
            <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-6 py-4 rounded-b-2xl">
              <label className="block text-xs font-semibold text-slate-700">
                Remarks
                <span className="font-normal text-slate-400 ml-1">
                  (required to reject; recorded on the batch and in the audit log either way)
                </span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  placeholder="Verified against the branch attendance register for August 2026"
                />
              </label>
              {deciding && (() => {
                // Two genuinely different states, and they must not look the same. Once the
                // server reports a row count the bar is a real measure; before that it is a
                // placeholder, and claiming "15%" to a screen reader would be a lie. So the
                // determinate case carries aria-valuenow and the indeterminate case omits it,
                // which is exactly what the ARIA progressbar role uses to tell them apart.
                const progress = decisionProgress?.progress;
                const verb = deciding === "approve" ? "Applying" : "Rejecting";
                const label = describeProgress(progress, verb);
                const failedRows = progress?.failed ?? 0;
                const percent =
                  progress?.total && progress.processed !== null
                    ? Math.min(100, Math.round(((progress.processed ?? 0) / progress.total) * 100))
                    : null;
                return (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    {/* Polite, not assertive: this updates every couple of seconds and must
                        not interrupt an approver who is still reading the row list. */}
                    <p className="text-xs font-semibold text-indigo-900" aria-live="polite">
                      {label}
                    </p>
                    {failedRows > 0 && (
                      <span className="text-xs font-semibold text-rose-600">
                        {failedRows} failed
                      </span>
                    )}
                  </div>
                  <div
                    role="progressbar"
                    aria-label={verb}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    {...(percent !== null ? { "aria-valuenow": percent } : {})}
                    aria-valuetext={label}
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-100"
                  >
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-500 motion-reduce:transition-none"
                      style={{ width: `${percent ?? 15}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-indigo-700/80">
                    This runs on the server one row at a time. You can leave this page open —
                    if you close it, the batch keeps processing and the queue will show the result.
                  </p>
                </div>
                );
              })()}
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {/* This sentence used to end on "will be " with nothing after it —
                    * a dangling fragment under the approve button. Say what actually
                    * happens, which now differs by stage. */}
                  {openBatch.imported_rows} row{openBatch.imported_rows !== 1 ? "s" : ""}{" "}
                  {TWO_STAGE_TYPES.has(openBatch.upload_type_code) && openStage === "branch"
                    ? "will be held for Payroll Head approval."
                    : "will be applied."}{" "}
                  {openBatch.error_rows > 0 && (
                    <span className="text-amber-600">(+{openBatch.error_rows} skipped errors)</span>
                  )}
                </p>
                <div className="flex gap-2">
                  {!canDecideOpenBatch && isResolved && (
                    <p className="self-center pr-2 text-[11px] font-medium text-slate-400">
                      {openStage
                        ? `Waiting on the ${STAGE_LABEL[openStage]} — you can review but not decide.`
                        : "This batch has already been decided."}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => setOpenBatch(null)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                  >
                    Cancel
                  </button>
                  {canDecideOpenBatch && (
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide("reject")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:opacity-60 cursor-pointer"
                  >
                    <XCircle className="h-4 w-4" />
                    {deciding === "reject" ? "Rejecting…" : "Discard whole batch"}
                  </button>
                  )}
                  {canDecideOpenBatch && (
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide("approve")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)] transition-all duration-200 hover:bg-emerald-700 hover:shadow-[0_4px_16px_rgba(16,185,129,0.4)] disabled:opacity-60 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {deciding === "approve"
                      ? "Working…"
                      : TWO_STAGE_TYPES.has(openBatch.upload_type_code) && openStage === "branch"
                        ? `Approve & send to ${STAGE_LABEL.payroll}`
                        : `Approve ${openBatch.imported_rows} row(s)`}
                  </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* History detail drawer */}
      {openHistoryBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200/80">
            <div className="relative overflow-hidden rounded-t-2xl">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-500 via-slate-400 to-slate-300" />
              <div className="flex items-start justify-between px-6 py-4 pt-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <FileCheck className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900">{openHistoryBatch.upload_batch_no}</h3>
                      <TypeBadge code={openHistoryBatch.upload_type_code} />
                      <StatusBadge status={openHistoryBatch.approval_status} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {openHistoryBatch.branch_name ?? "—"} · Decided {formatDateTime(openHistoryBatch.approved_at)}
                    </p>
                    {openHistoryBatch.approval_remarks && (
                      <p className="mt-1 text-xs text-slate-600 italic">"{openHistoryBatch.approval_remarks}"</p>
                    )}
                    {openHistoryBatch.error_summary && (
                      <p className="mt-1 text-xs text-amber-700">{openHistoryBatch.error_summary}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenHistoryBatch(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto border-t border-slate-100 px-6 py-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
                  <span className="ml-3 text-sm text-slate-500">Loading rows…</span>
                </div>
              ) : historyRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No row data available.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 rounded-lg">
                      {batchDiscardable && (
                        <th className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectableEntityIds.length > 0 && selectedEntityIds.size === selectableEntityIds.length}
                            onChange={toggleSelectAll}
                            disabled={selectableEntityIds.length === 0}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 accent-indigo-600 disabled:cursor-not-allowed"
                            aria-label="Select all discardable rows"
                          />
                        </th>
                      )}
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">#</th>
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">Employee</th>
                      {historyPreviewColumns.map((c) => (
                        <th key={c} className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">{c}</th>
                      ))}
                      <th className="px-3 py-2 font-bold uppercase tracking-wide text-slate-500">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyRows.map((row) => {
                      const data =
                        parseJson<Record<string, unknown>>(row.normalized_data) ??
                        parseJson<Record<string, unknown>>(row.raw_data) ?? {};
                      const errs = parseJson<string[]>(row.error_messages);
                      const isApplied = row.row_status === "imported";
                      const isErr = row.row_status === "error";
                      const entityId = row.created_entity_id;
                      const rowOutcome = entityId ? discardOutcome?.find((o) => o.entityId === entityId) : undefined;
                      const isSelectable = batchDiscardable && isApplied && Boolean(entityId) && !rowOutcome?.success;
                      return (
                        <tr
                          key={row.row_no}
                          className={
                            rowOutcome?.success
                              ? "bg-slate-100/60"
                              : isErr ? "bg-rose-50/60" : isApplied ? "bg-emerald-50/30" : "hover:bg-slate-50/60"
                          }
                        >
                          {batchDiscardable && (
                            <td className="px-3 py-2">
                              {isSelectable && entityId && (
                                <input
                                  type="checkbox"
                                  checked={selectedEntityIds.has(entityId)}
                                  onChange={() => toggleRowSelection(entityId)}
                                  className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 accent-indigo-600"
                                  aria-label={`Select row ${row.row_no}`}
                                />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 font-medium text-slate-400">{row.row_no}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                            {row.employee_name ?? <span className="text-slate-400">—</span>}
                          </td>
                          {historyPreviewColumns.map((c) => (
                            <td key={c} className="px-3 py-2 text-slate-700">
                              {String(data[c] ?? "")}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {rowOutcome ? (
                              rowOutcome.success ? (
                                <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                                  <Trash2 className="h-3 w-3" />
                                  discarded
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-600 font-medium" title={rowOutcome.message}>
                                  <XCircle className="h-3 w-3 shrink-0" />
                                  {rowOutcome.message}
                                </span>
                              )
                            ) : isApplied ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 className="h-3 w-3" />
                                applied
                              </span>
                            ) : isErr ? (
                              <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                                <XCircle className="h-3 w-3 shrink-0" />
                                {Array.isArray(errs) ? errs[0] : "failed"}
                              </span>
                            ) : (
                              <span className="text-slate-400">{row.row_status}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Discard-from-batch panel — only for a batch that actually applied
                leave/regularization rows. "Reverse it through that batch," made real. */}
            {batchDiscardable && (
              <div className="space-y-3 border-t border-slate-100 bg-amber-50/50 px-6 py-4">
                <label className="block text-xs font-semibold text-slate-700">
                  Reason for reversal <span className="text-rose-500">*</span>
                  <span className="font-normal text-slate-400 ml-1">(at least 10 characters — this is the permanent record)</span>
                  <textarea
                    value={discardReason}
                    onChange={(e) => setDiscardReason(e.target.value)}
                    rows={2}
                    disabled={discarding}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:opacity-60"
                    placeholder="Why are these rows being reversed?"
                  />
                </label>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    {selectedEntityIds.size > 0
                      ? `${selectedEntityIds.size} row(s) selected for reversal.`
                      : "Select one or more applied rows above to reverse them."}
                  </p>
                  <button
                    type="button"
                    disabled={discarding || selectedEntityIds.size === 0}
                    onClick={() => void discardSelectedRows()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    {discarding ? "Discarding…" : `Discard ${selectedEntityIds.size || ""} selected`}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50/60 px-6 py-3 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setOpenHistoryBatch(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </HrmsModernShell>
    </DashboardLayout>
  );
}